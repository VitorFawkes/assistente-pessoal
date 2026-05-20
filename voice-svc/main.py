"""voice-svc — fingerprinting de speakers com SpeechBrain ECAPA-TDNN.

Endpoints:
  GET  /health             liveness + info do modelo
  POST /identify           {meeting_id} → match speakers contra base, grava em speaker_labels_proposed
  POST /enroll             {meeting_id, mapping: {letter: pessoa_id}} → INSERT em voice_samples
  DEL  /samples/{id}       soft delete

Pressupõe:
  - meetings.segments preenchido (mac-agent diarize)
  - DATABASE_URL aponta pro Postgres (tabelas pessoas/voice_samples — 0004/0005)
  - Áudio é BAIXADO via HTTP do frontend (`FRONTEND_INTERNAL_URL/api/audio/{id}`),
    não lido de mount compartilhado — easypanel cria volume separado por service.
"""
from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from audio import (
    Turn,
    distinct_speakers,
    extract_segment_to_wav,
    group_turns,
    parse_segments,
    pick_representative_turns,
)
from db import (
    close_pool,
    get_meeting,
    get_pessoa,
    has_active_sample,
    insert_voice_sample,
    invalidate_other_pessoa_samples,
    is_valid_uuid,
    open_pool,
    reassign_sample,
    search_top_k,
    soft_delete_sample,
    update_speaker_labels_proposed,
)
from embedding import (
    EMBED_DIM,
    average_embeddings,
    encode_wav,
    load_encoder,
    reject_outliers,
)

AUDIO_BASE = os.environ.get("AUDIO_BASE", "/audios")  # fallback se houver mount; primário é HTTP
FRONTEND_INTERNAL_URL = os.environ.get(
    "FRONTEND_INTERNAL_URL", "http://n8n_assistente-frontend:3000"
)
TURN_MAX_SECONDS = float(os.environ.get("TURN_MAX_SECONDS", "30"))  # cap por turno embedado
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.60"))
HIGH_CONFIDENCE = float(os.environ.get("HIGH_CONFIDENCE", "0.80"))
MARGIN_THRESHOLD = float(os.environ.get("MARGIN_THRESHOLD", "0.08"))
TOP_K = int(os.environ.get("TOP_K", "5"))
OUTLIER_MIN_SIMILARITY = float(os.environ.get("OUTLIER_MIN_SIMILARITY", "0.5"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("voice-svc")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("opening Postgres pool…")
    open_pool()
    log.info("loading SpeechBrain ECAPA-TDNN encoder…")
    app.state.encoder = load_encoder()
    log.info("voice-svc ready (embedding dim=%d)", EMBED_DIM)
    try:
        yield
    finally:
        close_pool()


app = FastAPI(title="voice-svc", lifespan=lifespan)


# ─── modelos de request ──────────────────────────────────────────────


class IdentifyReq(BaseModel):
    meeting_id: str = Field(..., min_length=36, max_length=36)


class EnrollReq(BaseModel):
    meeting_id: str = Field(..., min_length=36, max_length=36)
    mapping: dict[str, str] = Field(..., description="letter → pessoa_id (uuid)")


# ─── helpers ─────────────────────────────────────────────────────────


def _resolve_audio(meeting_id: str, audio_path: str, tmpdir: str) -> str:
    """Garante que o áudio source esteja disponível em disco local.

    Estratégia:
      1. Se o mount /audios estiver compartilhado e o arquivo existir lá → usa direto.
      2. Senão, baixa via HTTP do frontend (GET /api/audio/{meeting_id}).
         Funciona mesmo quando o easypanel cria volumes separados por service.
    """
    # Tenta mount local primeiro
    local = audio_path if audio_path.startswith("/") else os.path.join(AUDIO_BASE, audio_path)
    if os.path.exists(local):
        return local

    # Fallback HTTP — baixa pro tmpdir
    log.info("audio %s não está em mount local, baixando do frontend…", meeting_id)
    url = f"{FRONTEND_INTERNAL_URL}/api/audio/{meeting_id}"
    dst = os.path.join(tmpdir, f"{meeting_id}.audio")
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dst, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
    except Exception as e:
        raise HTTPException(
            502, f"falha ao baixar áudio do frontend ({url}): {e}"
        ) from e
    log.info("audio baixado: %s (%d bytes)", dst, os.path.getsize(dst))
    return dst


def _embed_turn(
    encoder, source_audio: str, turn: Turn, tmpdir: str
) -> tuple[np.ndarray, float, str]:
    """Extrai trecho do turno (cap em TURN_MAX_SECONDS) e devolve (embedding, duration, range_str)."""
    end = min(turn.end, turn.start + TURN_MAX_SECONDS)
    duration = end - turn.start
    wav_path = os.path.join(tmpdir, f"turn_{turn.speaker}_{turn.start:.2f}.wav")
    extract_segment_to_wav(source_audio, turn.start, end, wav_path)
    vec = encode_wav(encoder, wav_path)
    range_str = f"{turn.start:.2f}-{end:.2f}"
    return vec, duration, range_str


# ─── endpoints ───────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": "speechbrain/spkrec-ecapa-voxceleb",
        "embed_dim": EMBED_DIM,
        "thresholds": {
            "confidence": CONFIDENCE_THRESHOLD,
            "high_confidence": HIGH_CONFIDENCE,
            "margin": MARGIN_THRESHOLD,
            "top_k": TOP_K,
        },
    }


@app.get("/clip")
def clip(meeting_id: str, start: float, end: float) -> FileResponse:
    """Corta um trecho do áudio source e retorna MP3 64kbps mono — pequeno o
    bastante pra player web carregar instantâneo. Útil pra previews de amostras.
    """
    if not is_valid_uuid(meeting_id):
        raise HTTPException(400, "meeting_id inválido")
    if start < 0 or end <= start or (end - start) > 120:
        raise HTTPException(400, "range inválido (start>=0, end>start, max 120s)")

    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(404, "meeting não encontrada")

    # Diretório persistente (não tmpdir context) — FileResponse precisa do arquivo
    # ainda existir quando o Starlette streamar. Cleanup periódico fica fora de escopo.
    cache_dir = "/tmp/voice-svc-clips"
    os.makedirs(cache_dir, exist_ok=True)
    out_path = os.path.join(cache_dir, f"{meeting_id}_{start:.2f}_{end:.2f}.mp3")

    if not os.path.exists(out_path):
        # Resolve audio source (mount local OU download HTTP do frontend)
        with tempfile.TemporaryDirectory(prefix="voice-svc-clip-") as tmpdir:
            audio_src = _resolve_audio(meeting_id, meeting["audio_path"], tmpdir)
            duration = end - start
            import subprocess
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
                "-i", audio_src,
                "-ac", "1", "-ar", "22050", "-b:a", "64k",
                "-f", "mp3", out_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise HTTPException(500, f"ffmpeg falhou: {proc.stderr.strip()[:200]}")

    return FileResponse(
        out_path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/debug/fs")
def debug_fs() -> dict[str, Any]:
    """Diagnóstico do mount /audios — quem somos, o que enxergamos."""
    import pwd
    info: dict[str, Any] = {
        "audio_base": AUDIO_BASE,
        "exists": os.path.exists(AUDIO_BASE),
        "is_dir": os.path.isdir(AUDIO_BASE),
        "uid": os.getuid(),
        "gid": os.getgid(),
    }
    try:
        info["user"] = pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        info["user"] = "?"
    if info["exists"]:
        try:
            st = os.stat(AUDIO_BASE)
            info["mode"] = oct(st.st_mode & 0o7777)
            info["owner_uid"] = st.st_uid
            info["owner_gid"] = st.st_gid
            info["readable"] = os.access(AUDIO_BASE, os.R_OK)
        except Exception as e:
            info["stat_error"] = str(e)
        try:
            files = os.listdir(AUDIO_BASE)
            info["file_count"] = len(files)
            info["sample_files"] = files[:10]
        except Exception as e:
            info["listdir_error"] = str(e)
    return info


@app.post("/identify")
def identify(req: IdentifyReq) -> dict[str, Any]:
    if not is_valid_uuid(req.meeting_id):
        raise HTTPException(400, "meeting_id inválido")

    meeting = get_meeting(req.meeting_id)
    if not meeting:
        raise HTTPException(404, "meeting não encontrada")

    raw_segments = meeting.get("segments")
    if not raw_segments:
        log.info("meeting %s sem segments — nada a identificar", req.meeting_id)
        return {"labels": {}, "reason": "no_segments"}

    segments = parse_segments(raw_segments)
    turns = group_turns(segments)
    speakers = distinct_speakers(turns)

    labels: dict[str, Any] = {}

    with tempfile.TemporaryDirectory(prefix="voice-svc-") as tmpdir:
        audio_src = _resolve_audio(req.meeting_id, meeting["audio_path"], tmpdir)
        for letter in speakers:
            picked = pick_representative_turns(turns, letter)
            if not picked:
                log.info("speaker %s sem turnos válidos (>=3s)", letter)
                continue

            vectors: list[np.ndarray] = []
            for t in picked:
                try:
                    vec, _, _ = _embed_turn(app.state.encoder, audio_src, t, tmpdir)
                    vectors.append(vec)
                except Exception as e:
                    log.warning("falha ao embeddar turno %s [%.2f-%.2f]: %s", letter, t.start, t.end, e)

            if not vectors:
                continue

            query_vec = average_embeddings(vectors)
            matches = search_top_k(query_vec, k=TOP_K)

            if not matches:
                # base vazia — cold start
                labels[letter] = None
                continue

            top1 = matches[0]
            sim_top1 = 1.0 - float(top1["distance"])

            # top2 referente a OUTRA pessoa (matches pode ter várias amostras da mesma pessoa)
            top2_diff = next(
                (m for m in matches[1:] if m["pessoa_id"] != top1["pessoa_id"]),
                None,
            )
            sim_top2 = 1.0 - float(top2_diff["distance"]) if top2_diff else 0.0
            margin = sim_top1 - sim_top2

            if sim_top1 < CONFIDENCE_THRESHOLD or margin < MARGIN_THRESHOLD:
                log.info(
                    "speaker %s: top1=%.3f margin=%.3f abaixo do threshold — sem proposta",
                    letter,
                    sim_top1,
                    margin,
                )
                continue

            labels[letter] = {
                "pessoa_id": str(top1["pessoa_id"]),
                "nome": top1["nome"],
                "confidence": round(sim_top1, 3),
                "sample_count": int(top1["sample_count"]),
                "margin": round(margin, 3),
            }

    update_speaker_labels_proposed(req.meeting_id, labels)
    log.info("meeting %s: proposed %s", req.meeting_id, list(labels.keys()))
    return {"labels": labels}


@app.post("/enroll")
def enroll(req: EnrollReq) -> dict[str, Any]:
    if not is_valid_uuid(req.meeting_id):
        raise HTTPException(400, "meeting_id inválido")

    meeting = get_meeting(req.meeting_id)
    if not meeting:
        raise HTTPException(404, "meeting não encontrada")

    raw_segments = meeting.get("segments")
    if not raw_segments:
        raise HTTPException(400, "meeting sem segments — nada a enroll")

    # valida pessoa_ids
    pessoas_cache: dict[str, dict] = {}
    for letter, pid in req.mapping.items():
        if not is_valid_uuid(pid):
            raise HTTPException(400, f"pessoa_id inválido pra speaker {letter}: {pid}")
        p = get_pessoa(pid)
        if not p:
            raise HTTPException(404, f"pessoa_id {pid} não encontrada")
        pessoas_cache[letter] = p

    segments = parse_segments(raw_segments)
    turns = group_turns(segments)

    enrolled: dict[str, int] = {}

    with tempfile.TemporaryDirectory(prefix="voice-svc-") as tmpdir:
        audio_src = _resolve_audio(req.meeting_id, meeting["audio_path"], tmpdir)
        for letter, pessoa_id in req.mapping.items():
            # Correção: se essa (meeting, letter) já tinha amostras de OUTRA pessoa
            # (rotulação errada anterior), invalida ANTES de inserir as novas.
            # Evita poluir a base com falsos positivos quando o user corrige.
            n_invalidated = invalidate_other_pessoa_samples(
                req.meeting_id, letter, pessoa_id
            )
            if n_invalidated > 0:
                log.info(
                    "speaker %s: invalidou %d amostra(s) de pessoa anterior antes de re-enroll pra %s",
                    letter,
                    n_invalidated,
                    pessoa_id,
                )

            # Idempotência: já existe amostra ativa dessa (meeting, letter, pessoa)? Skip.
            if has_active_sample(req.meeting_id, letter, pessoa_id):
                log.info(
                    "speaker %s já enrolado pra pessoa %s — pulando",
                    letter,
                    pessoa_id,
                )
                enrolled[letter] = 0
                continue

            picked = pick_representative_turns(turns, letter)
            if not picked:
                log.info("speaker %s sem turnos válidos — pulando enroll", letter)
                enrolled[letter] = 0
                continue

            # Etapa 1: embeda TODOS os trechos do speaker
            embedded: list[tuple[np.ndarray, float, str]] = []
            for t in picked:
                try:
                    vec, duration, range_str = _embed_turn(
                        app.state.encoder, audio_src, t, tmpdir
                    )
                    embedded.append((vec, duration, range_str))
                except Exception as e:
                    log.warning(
                        "falha ao embeddar turno %s [%.2f-%.2f]: %s",
                        letter,
                        t.start,
                        t.end,
                        e,
                    )

            if not embedded:
                enrolled[letter] = 0
                continue

            # Etapa 2: outlier rejection — diarize às vezes mistura vozes
            # diferentes sob o mesmo speaker letter. Filtra trechos que destoam
            # dos outros (sim média < OUTLIER_MIN_SIMILARITY).
            vectors_only = [e[0] for e in embedded]
            keep_idx = reject_outliers(vectors_only, OUTLIER_MIN_SIMILARITY)
            kept = [embedded[i] for i in keep_idx]
            n_rejected = len(embedded) - len(kept)
            if n_rejected > 0:
                log.info(
                    "speaker %s: rejeitei %d/%d trecho(s) como outlier (provável diarização mista)",
                    letter,
                    n_rejected,
                    len(embedded),
                )

            # Etapa 3: INSERT só os trechos consistentes
            count = 0
            for vec, duration, range_str in kept:
                try:
                    insert_voice_sample(
                        pessoa_id=pessoa_id,
                        embedding=vec,
                        source_meeting_id=req.meeting_id,
                        source_speaker_letter=letter,
                        source_segment_range=range_str,
                        duration_seconds=duration,
                    )
                    count += 1
                except Exception as e:
                    log.warning("falha ao inserir voice_sample %s: %s", range_str, e)

            enrolled[letter] = count
            log.info(
                "enrolled %s amostra(s) pra pessoa %s (%s) — speaker %s (%d rejeitadas)",
                count,
                pessoas_cache[letter]["nome"],
                pessoa_id,
                letter,
                n_rejected,
            )

    return {"enrolled": enrolled}


@app.delete("/samples/{sample_id}")
def delete_sample(sample_id: str) -> dict[str, Any]:
    if not is_valid_uuid(sample_id):
        raise HTTPException(400, "sample_id inválido")
    ok = soft_delete_sample(sample_id)
    if not ok:
        raise HTTPException(404, "sample não encontrada (ou já deletada)")
    return {"ok": True, "deleted": sample_id}


class ReassignReq(BaseModel):
    pessoa_id: str = Field(..., min_length=36, max_length=36)


@app.patch("/samples/{sample_id}")
def patch_sample(sample_id: str, req: ReassignReq) -> dict[str, Any]:
    """Move uma amostra pra outra pessoa (correção de rotulagem)."""
    if not is_valid_uuid(sample_id):
        raise HTTPException(400, "sample_id inválido")
    if not is_valid_uuid(req.pessoa_id):
        raise HTTPException(400, "pessoa_id inválido")
    p = get_pessoa(req.pessoa_id)
    if not p:
        raise HTTPException(404, f"pessoa_id {req.pessoa_id} não encontrada")
    ok = reassign_sample(sample_id, req.pessoa_id)
    if not ok:
        raise HTTPException(404, "sample não encontrada (ou já deletada)")
    return {"ok": True, "sample_id": sample_id, "pessoa_id": req.pessoa_id, "nome": p["nome"]}

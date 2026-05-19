"""voice-svc — fingerprinting de speakers com SpeechBrain ECAPA-TDNN + pgvector.

Endpoints:
  GET  /health             liveness + info do modelo
  POST /identify           {meeting_id} → match speakers contra base, grava em speaker_labels_proposed
  POST /enroll             {meeting_id, mapping: {letter: pessoa_id}} → INSERT em voice_samples
  DEL  /samples/{id}       soft delete

Pressupõe:
  - meetings.segments preenchido (mac-agent diarize)
  - DATABASE_URL aponta pro Postgres com pgvector + tabelas pessoas/voice_samples (0004, 0005)
  - Volume montado em AUDIO_BASE (default /audios) com os mp3 originais
"""
from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
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
    is_valid_uuid,
    open_pool,
    search_top_k,
    soft_delete_sample,
    update_speaker_labels_proposed,
)
from embedding import EMBED_DIM, average_embeddings, encode_wav, load_encoder

AUDIO_BASE = os.environ.get("AUDIO_BASE", "/audios")
TURN_MAX_SECONDS = float(os.environ.get("TURN_MAX_SECONDS", "30"))  # cap por turno embedado
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.60"))
HIGH_CONFIDENCE = float(os.environ.get("HIGH_CONFIDENCE", "0.80"))
MARGIN_THRESHOLD = float(os.environ.get("MARGIN_THRESHOLD", "0.08"))
TOP_K = int(os.environ.get("TOP_K", "5"))

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


def _resolve_audio_path(audio_path: str) -> str:
    """audio_path no DB é absoluto (ex: /audios/2026/05/uuid.mp3). Se relativo, prefixa AUDIO_BASE."""
    if audio_path.startswith("/"):
        return audio_path
    return os.path.join(AUDIO_BASE, audio_path)


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

    audio_src = _resolve_audio_path(meeting["audio_path"])
    if not os.path.exists(audio_src):
        raise HTTPException(404, f"audio não encontrado: {audio_src}")

    segments = parse_segments(raw_segments)
    turns = group_turns(segments)
    speakers = distinct_speakers(turns)

    labels: dict[str, Any] = {}

    with tempfile.TemporaryDirectory(prefix="voice-svc-") as tmpdir:
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

    audio_src = _resolve_audio_path(meeting["audio_path"])
    if not os.path.exists(audio_src):
        raise HTTPException(404, f"audio não encontrado: {audio_src}")

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
        for letter, pessoa_id in req.mapping.items():
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

            count = 0
            for t in picked:
                try:
                    vec, duration, range_str = _embed_turn(
                        app.state.encoder, audio_src, t, tmpdir
                    )
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
                    log.warning(
                        "falha ao enroll turno %s [%.2f-%.2f]: %s",
                        letter,
                        t.start,
                        t.end,
                        e,
                    )

            enrolled[letter] = count
            log.info(
                "enrolled %s amostra(s) pra pessoa %s (%s) — speaker %s",
                count,
                pessoas_cache[letter]["nome"],
                pessoa_id,
                letter,
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

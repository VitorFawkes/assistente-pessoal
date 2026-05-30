"""ingest-svc — FastAPI endpoint que recebe upload do app iOS, transcreve e repassa pro n8n.

Substitui o trabalho do mac-agent (audio-watcher.sh + transcribe.sh) pra usuários
que não têm o Mac do Vitor. Contrato pro n8n é idêntico ao do mac-agent — workflow
"Acoes - Audio Ingest" não precisa mudar.

Modelo de processamento (desacoplado):
  POST /upload grava o áudio cru em disco DURÁVEL (JOBS_DIR), responde 202 na hora
  e processa em background. Assim gravações longas (dia inteiro) não estouram o
  timeout do cliente (app iOS tem timeoutIntervalForResource baixo) nem causam
  re-upload/duplicação. O ffmpeg é bloqueante (subprocess) — roda em thread via
  asyncio.to_thread pra não travar o event loop do worker único.

Durabilidade: cru + sidecar .json ficam em JOBS_DIR até o n8n confirmar. Em erro,
movem pra JOBS_DIR/failed/ (visível, recuperável). No startup, jobs órfãos (ex:
container reiniciado no meio) são re-enfileirados — nada se perde silenciosamente.

Endpoints:
  GET  /health         → liveness
  POST /upload         → recebe áudio cru, enfileira, responde 202
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from n8n_client import N8N_WEBHOOK_URL, post_to_n8n
from transcribe import (
    ASSEMBLYAI_API_KEY,
    SPEECH_MODELS,
    AudioTooLongError,
    cleanup_compressed,
    transcribe,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("ingest-svc")

INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
INTERNAL_SVC_TOKEN = os.environ.get("INTERNAL_SVC_TOKEN", "")
FRONTEND_INTERNAL_URL = os.environ.get("FRONTEND_INTERNAL_URL", "").rstrip("/")
# 1.5GB default — cobre ~24h de m4a cru a 64kbps com margem. Bytes são gravados
# em streaming de 1MB (não vão pra RAM).
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(1610612736)))  # 1.5GB
# Disco durável pros jobs (cru + sidecar). Em prod, montar volume persistente aqui.
JOBS_DIR = os.environ.get("JOBS_DIR", "/data/jobs")
FAILED_DIR = os.path.join(JOBS_DIR, "failed")
# Quantos jobs pesados (ffmpeg + transcrição) rodam ao mesmo tempo. 1 = serializa
# (seguro em 1 vCPU / 1GB RAM). Limite real só com --workers 1 (semaphore é por processo).
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "1"))

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
ALLOWED_EXTENSIONS = {"m4a", "mp3", "wav", "aac", "flac", "ogg", "mp4"}

# Semaphore criado no lifespan (precisa do event loop ativo).
_job_sem: asyncio.Semaphore | None = None
# Mantém refs das tasks em voo pra evitar GC prematuro (asyncio.create_task).
_inflight: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _job_sem
    os.makedirs(JOBS_DIR, exist_ok=True)
    os.makedirs(FAILED_DIR, exist_ok=True)
    _job_sem = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
    # Re-enfileira jobs órfãos sem bloquear o startup.
    asyncio.create_task(_sweep_orphans())
    yield


app = FastAPI(title="ingest-svc", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "config": {
            "n8n_configured": bool(N8N_WEBHOOK_URL),
            "assemblyai_configured": bool(ASSEMBLYAI_API_KEY),
            "auth_configured": bool(INGEST_TOKEN),
            "bearer_configured": bool(INTERNAL_SVC_TOKEN and FRONTEND_INTERNAL_URL),
            "speech_models": SPEECH_MODELS,
            "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
            "jobs_dir": JOBS_DIR,
            "max_concurrent_jobs": MAX_CONCURRENT_JOBS,
        },
    }


async def _resolve_bearer_user(token: str) -> str | None:
    """Chama frontend /api/internal/validate-session e retorna user_id ou None."""
    if not (INTERNAL_SVC_TOKEN and FRONTEND_INTERNAL_URL):
        log.warning("Bearer recebido mas INTERNAL_SVC_TOKEN/FRONTEND_INTERNAL_URL não configurados")
        return None
    url = f"{FRONTEND_INTERNAL_URL}/api/internal/validate-session"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                url,
                params={"token": token},
                headers={"X-Internal-Token": INTERNAL_SVC_TOKEN},
            )
    except httpx.HTTPError as e:
        log.error("validate-session network error: %s", e)
        return None
    if r.status_code != 200:
        return None
    data = r.json()
    user_id = data.get("user_id", "")
    return user_id if UUID_RE.match(user_id) else None


async def authenticated_user(req: Request) -> str:
    """FastAPI dependency — roda ANTES de body parsing.

    Auth path 1 (app iOS): Authorization: Bearer <session_id>
      → valida via /api/internal/validate-session, extrai user_id automaticamente
    Auth path 2 (mac-agent, legado): X-Auth: <INGEST_TOKEN> + X-User-Id: <uuid>
      → mantém compat
    """
    authz = req.headers.get("authorization", "")
    if authz.startswith("Bearer "):
        token = authz[len("Bearer ") :].strip()
        user_id = await _resolve_bearer_user(token)
        if user_id:
            return user_id
        raise HTTPException(401, "invalid bearer token")

    # Fallback legado (mac-agent)
    auth = req.headers.get("x-auth", "")
    if not INGEST_TOKEN or auth != INGEST_TOKEN:
        raise HTTPException(401, "unauthorized")
    user_id = req.headers.get("x-user-id", "")
    if not UUID_RE.match(user_id):
        raise HTTPException(400, "X-User-Id header obrigatório (UUID)")
    return user_id


def _derive_meeting_type(filename: str) -> str:
    """Replica derive_meeting_type do audio-watcher.sh."""
    name = filename.lower()
    if name.startswith(("online -", "online_")):
        return "online"
    if name.startswith(("mic -", "mic_")):
        return "presencial"
    return "desconhecido"


def _safe_ext(filename: str) -> str:
    """Pega extensão (sem ponto, lowercase). Retorna 'm4a' se inválida."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "m4a"
    return ext if ext in ALLOWED_EXTENSIONS else "m4a"


# ─── Jobs (disco durável) ────────────────────────────────────────────

def _raw_path(job_id: str, ext: str) -> str:
    return os.path.join(JOBS_DIR, f"{job_id}.{ext}")


def _meta_path(job_id: str) -> str:
    return os.path.join(JOBS_DIR, f"{job_id}.json")


def _move_to_failed(job_id: str, ext: str, reason: str) -> None:
    """Move cru + sidecar pra failed/ (best-effort). Nunca some silenciosamente."""
    for src in (_raw_path(job_id, ext), _meta_path(job_id)):
        if os.path.exists(src):
            try:
                shutil.move(src, os.path.join(FAILED_DIR, os.path.basename(src)))
            except OSError as e:
                log.error("falha ao mover %s pra failed/: %s", src, e)
    log.error("job %s movido pra failed/ — motivo: %s", job_id, reason)


def _cleanup_job(job_id: str, ext: str) -> None:
    """Remove cru + sidecar após sucesso (best-effort)."""
    for p in (_raw_path(job_id, ext), _meta_path(job_id)):
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError as e:
            log.warning("cleanup job %s falhou em %s: %s", job_id, p, e)


def _process_job_sync(job_id: str, meta: dict[str, Any]) -> None:
    """Trabalho pesado (ffmpeg bloqueante + transcrição + POST n8n). Roda em thread.

    Usa asyncio.run pra orquestrar as partes async (transcribe/post_to_n8n) num
    event loop próprio da thread — não toca o loop principal do worker.
    """
    ext = meta["ext"]
    raw = _raw_path(job_id, ext)
    if not os.path.exists(raw):
        log.error("job %s: cru sumiu antes do processamento (%s)", job_id, raw)
        return

    async def _run() -> None:
        workdir = tempfile.mkdtemp(prefix=f"ingest-{job_id}-")
        try:
            result = await transcribe(raw, workdir)
            try:
                http_code, body = await post_to_n8n(
                    auth_token=INGEST_TOKEN,
                    user_id=meta["user_id"],
                    source=meta["source"],
                    meeting_type=meta["meeting_type"],
                    original_filename=meta["original_filename"],
                    recorded_at=meta["recorded_at"],
                    audio_path=result.compressed_path,
                    duration_seconds=result.duration_seconds,
                    silent=result.silent,
                    n_chunks=result.n_chunks,
                    transcription=result.text,
                    segments=result.segments,
                )
            finally:
                await cleanup_compressed(result)

            if 200 <= http_code < 300:
                log.info("job %s OK (n8n http=%d duration=%ds silent=%s)",
                         job_id, http_code, result.duration_seconds, result.silent)
                _cleanup_job(job_id, ext)
            else:
                log.error("job %s: n8n rejeitou http=%d body=%s", job_id, http_code, body)
                _move_to_failed(job_id, ext, f"n8n http={http_code}")
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    try:
        asyncio.run(_run())
    except AudioTooLongError as e:
        _move_to_failed(job_id, ext, str(e))
    except Exception as e:  # noqa: BLE001 — qualquer falha preserva o cru
        log.exception("job %s falhou: %s", job_id, e)
        _move_to_failed(job_id, ext, f"exception: {e}")


async def _job_runner(job_id: str, meta: dict[str, Any]) -> None:
    """Wrapper async: respeita o semaphore e despacha o trabalho pesado pra thread."""
    assert _job_sem is not None
    async with _job_sem:
        await asyncio.to_thread(_process_job_sync, job_id, meta)


def _schedule_job(job_id: str, meta: dict[str, Any]) -> None:
    task = asyncio.create_task(_job_runner(job_id, meta))
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)


async def _sweep_orphans() -> None:
    """No startup, re-enfileira jobs com sidecar (upload completo, não processado).

    Áudio sem sidecar = upload incompleto (crash antes de gravar a meta) → failed/.
    """
    try:
        entries = os.listdir(JOBS_DIR)
    except OSError as e:
        log.error("sweep: não consegui listar %s: %s", JOBS_DIR, e)
        return

    metas = {f[:-5] for f in entries if f.endswith(".json")}  # job_ids com sidecar
    audios = {f.rsplit(".", 1)[0]: f for f in entries
              if "." in f and not f.endswith(".json") and os.path.isfile(os.path.join(JOBS_DIR, f))}

    requeued = 0
    for job_id in metas:
        try:
            with open(_meta_path(job_id)) as fh:
                meta = json.load(fh)
            if not os.path.exists(_raw_path(job_id, meta["ext"])):
                log.warning("sweep: sidecar %s sem áudio — descartando", job_id)
                try:
                    os.remove(_meta_path(job_id))
                except OSError:
                    pass
                continue
            _schedule_job(job_id, meta)
            requeued += 1
        except (OSError, json.JSONDecodeError, KeyError) as e:
            # Sidecar corrompido/incompleto: quarentena (sidecar + qualquer áudio
            # com esse job_id) pra não re-falhar em todo restart.
            log.error("sweep: sidecar %s inválido (%s) — quarentena", job_id, e)
            for fname in entries:
                if fname == f"{job_id}.json" or (
                    fname.startswith(f"{job_id}.") and not fname.endswith(".json")
                ):
                    src = os.path.join(JOBS_DIR, fname)
                    try:
                        shutil.move(src, os.path.join(FAILED_DIR, fname))
                    except OSError as move_err:
                        log.error("sweep: falha ao mover %s pra failed/: %s", src, move_err)

    # Áudios órfãos sem sidecar (upload incompleto) → failed/ pra visibilidade.
    for job_id, fname in audios.items():
        if job_id not in metas:
            ext = fname.rsplit(".", 1)[-1]
            _move_to_failed(job_id, ext, "upload incompleto (sem sidecar no startup)")

    if requeued:
        log.info("sweep: %d job(s) órfão(s) re-enfileirado(s)", requeued)


@app.post("/upload")
async def upload(
    user_id: str = Depends(authenticated_user),
    audio: UploadFile = File(...),
    recorded_at: str = Form(...),
    original_filename: str = Form(...),
    source: str = Form("ios-app"),
    meeting_type: str | None = Form(None),
) -> JSONResponse:
    """Recebe áudio cru, grava em disco durável, responde 202 e processa em background.

    Form fields:
      audio: arquivo (.m4a/.mp3/.wav/...)
      recorded_at: ISO 8601 (ex: 2026-05-23T14:30:00Z)
      original_filename: nome do arquivo (usado pra derivar meeting_type e logging)
      source: opcional, default "ios-app"
      meeting_type: opcional, default derivado de original_filename
    """
    ext = _safe_ext(original_filename)
    derived_meeting_type = meeting_type or _derive_meeting_type(original_filename)
    job_id = str(uuid.uuid4())
    raw_path = _raw_path(job_id, ext)

    try:
        # 1. Grava upload em disco durável com guard de tamanho (streaming 1MB).
        bytes_written = 0
        with open(raw_path, "wb") as f:
            while True:
                chunk = await audio.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"upload excede {MAX_UPLOAD_BYTES} bytes")
                f.write(chunk)

        if bytes_written == 0:
            raise HTTPException(400, "audio vazio")

        # 2. Sidecar com metadata (escrito DEPOIS do áudio completo — sweep usa isso
        # como marca de "upload completo").
        meta = {
            "user_id": user_id,
            "source": source,
            "meeting_type": derived_meeting_type,
            "original_filename": original_filename,
            "recorded_at": recorded_at,
            "ext": ext,
        }
        with open(_meta_path(job_id), "w") as fh:
            json.dump(meta, fh)

        log.info("upload aceito job=%s user=%s file=%s bytes=%d source=%s",
                 job_id, user_id, original_filename, bytes_written, source)

        # 3. Enfileira processamento e responde na hora.
        _schedule_job(job_id, meta)
        return JSONResponse(
            {"ok": True, "job_id": job_id, "bytes": bytes_written},
            status_code=202,
        )

    except HTTPException:
        # Upload rejeitado — limpa o cru parcial.
        _cleanup_job(job_id, ext)
        raise
    except Exception as e:
        log.exception("upload falhou job=%s user=%s file=%s", job_id, user_id, original_filename)
        _cleanup_job(job_id, ext)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

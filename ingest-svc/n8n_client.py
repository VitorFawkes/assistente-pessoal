"""Cliente HTTP pro webhook n8n acoes-audio-ingest.

Replica fielmente o contrato do mac-agent/audio-watcher.sh:243-261 — headers e fields
multipart idênticos. Qualquer mudança aqui DEVE bater com o que o workflow espera.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("ingest-svc.n8n")

N8N_WEBHOOK_URL = os.environ.get("N8N_WEBHOOK_URL", "")
N8N_TIMEOUT_SECONDS = float(os.environ.get("N8N_TIMEOUT_SECONDS", "300"))


async def post_to_n8n(
    *,
    auth_token: str,
    user_id: str,
    source: str,
    meeting_type: str,
    original_filename: str,
    recorded_at: str,
    audio_path: str,
    duration_seconds: int,
    silent: bool,
    n_chunks: int,
    transcription: str,
    segments: list[dict[str, Any]],
) -> tuple[int, str]:
    """POST multipart pro webhook n8n. Retorna (http_code, body_snippet).

    Levanta httpx.HTTPError em caso de problema de transporte.
    """
    if not N8N_WEBHOOK_URL:
        raise RuntimeError("N8N_WEBHOOK_URL não definida")
    if not os.path.exists(audio_path):
        raise RuntimeError(f"audio_path não existe: {audio_path}")

    audio_size = os.path.getsize(audio_path)
    silent_str = "true" if silent else "false"
    segments_json = json.dumps(segments, separators=(",", ":"))

    headers = {
        "X-Auth": auth_token,
        "X-User-Id": user_id,
        "X-Source": source,
        "X-Meeting-Type": meeting_type,
        "X-Original-Filename": original_filename,
        "X-Recorded-At": recorded_at,
        "X-Audio-Size": str(audio_size),
        "X-Duration-Seconds": str(duration_seconds),
        "X-Silent": silent_str,
        "X-N-Chunks": str(n_chunks),
    }

    with open(audio_path, "rb") as f:
        files = {
            "audio": (original_filename, f, "audio/mpeg"),
        }
        data = {
            "transcription": transcription,
            "duration_seconds": str(duration_seconds),
            "silent": silent_str,
            "segments": segments_json,
        }
        async with httpx.AsyncClient(timeout=N8N_TIMEOUT_SECONDS) as client:
            resp = await client.post(N8N_WEBHOOK_URL, headers=headers, data=data, files=files)

    body_snippet = resp.text[:400] if resp.text else ""
    log.info("n8n POST http=%d size=%d duration=%ds silent=%s chunks=%d file=%s",
             resp.status_code, audio_size, duration_seconds, silent_str, n_chunks, original_filename)
    return resp.status_code, body_snippet

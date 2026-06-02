"""Porting fiel do mac-agent/transcribe.sh pra Python.

Pipeline (AssemblyAI Universal-2 / Universal-3-Pro):
  1. ffmpeg volumedetect → mean_volume
  2. ffprobe → duração do original
  3. Se silent (mean_volume <= SILENCE_GATE_DB): comprime e retorna sem chamar API
  4. Senão: comprime + silenceremove
  5. Upload pro AssemblyAI (/v2/upload)
  6. Solicita transcrição com diarização (/v2/transcript)
  7. Polling até status=completed
  8. Converte utterances [{speaker, start_ms, end_ms, text}] → segments {speaker, start_s, end_s, text}

Sem chunking: AssemblyAI single-shot até 10h, diarização global consistente.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("ingest-svc.transcribe")

# Mesmas constantes do mac-agent/transcribe.sh
SILENCE_GATE_DB = -50.0
SILENCEREMOVE_DB = "-50dB"  # paridade com mac-agent (era -30dB aqui — divergência corrigida)
SILENCEREMOVE_MIN = "2"
BITRATE = "48k"
SAMPLE_RATE = 16000

# Garantia defensiva: o AssemblyAI rejeita áudio > 10h (single-shot). Medimos a
# duração do compressed (pós-silenceremove — o que de fato sobe pra API), não do
# original. Assim uma gravação de dia inteiro mayoritariamente silenciosa, que
# encolhe pra poucas horas, passa normal. 35880s = 9h58m (margem sob 36000s).
MAX_AUDIO_SECONDS = int(os.environ.get("MAX_AUDIO_SECONDS", "35880"))

# Split por gap de silêncio no áudio CRU (antes do silenceremove): silêncio
# >= GAP_SECONDS separa reuniões distintas num upload longo. Threshold
# 3min — gap entre reuniões é silêncio real; pausa dentro tem ruído (a UI é a
# rede). Ilhas < MIN_MEETING_SECONDS são descartadas (ruído curto).
GAP_SECONDS = int(os.environ.get("GAP_SECONDS", "180"))
MIN_MEETING_SECONDS = int(os.environ.get("MIN_MEETING_SECONDS", "60"))

ASSEMBLYAI_BASE = "https://api.assemblyai.com"
ASSEMBLYAI_API_KEY = os.environ.get("ASSEMBLYAI_API_KEY", "")

# Lista de fallback ordenada. AssemblyAI tenta o primeiro; se indisponível
# ou conta sem acesso, cai pro próximo. Universal-3-Pro é mais accurate
# pra PT-BR (otimizado especificamente); Universal-2 é fallback estável.
_default_models = ["universal-3-pro", "universal-2"]
try:
    SPEECH_MODELS = json.loads(os.environ.get("SPEECH_MODELS_JSON", json.dumps(_default_models)))
    if not isinstance(SPEECH_MODELS, list) or not all(isinstance(m, str) for m in SPEECH_MODELS):
        raise ValueError("SPEECH_MODELS_JSON deve ser lista de strings")
except (json.JSONDecodeError, ValueError) as e:
    log.warning("SPEECH_MODELS_JSON inválido (%s) — usando default %s", e, _default_models)
    SPEECH_MODELS = _default_models

POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "8"))        # seg entre polls
POLL_MAX_SECONDS = float(os.environ.get("POLL_MAX_SECONDS", "3600"))  # 60min total (12x margem p/ caso 10h; RTF real ~0.008x)

# Segments com speaker que NÃO é A-Z puro são filtrados — defesa contra
# futuras mudanças do modelo (mesmo guard do mac-agent/transcribe.sh).
VALID_SPEAKER_RE = re.compile(r"^[A-Z]+$")


class AudioTooLongError(RuntimeError):
    """Áudio (pós-silenceremove) excede MAX_AUDIO_SECONDS — AssemblyAI rejeitaria.

    Levantada ANTES de chamar a API. O chamador deve tratar como falha
    recuperável (preservar o cru, não travar a meeting em 'analyzing').
    """

    def __init__(self, compressed_seconds: int) -> None:
        self.compressed_seconds = compressed_seconds
        super().__init__(
            f"áudio pós-silenceremove tem {compressed_seconds}s "
            f"(> limite {MAX_AUDIO_SECONDS}s ≈ 10h) — AssemblyAI rejeita"
        )


@dataclass
class TranscribeResult:
    text: str
    duration_seconds: int
    silent: bool
    n_chunks: int  # mantido por compatibilidade com contrato n8n; sempre 0 ou 1
    compressed_path: str
    segments: list[dict[str, Any]]


def _run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    """Roda subprocess com captura de stderr/stdout."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(cmd[:3])}... → {proc.stderr.strip()[:400]}"
        )
    return proc


def _detect_mean_volume(input_path: str) -> float:
    """ffmpeg volumedetect → mean_volume em dB. Retorna 0 se não encontrar."""
    proc = _run(
        ["ffmpeg", "-i", input_path, "-af", "volumedetect", "-vn", "-f", "null", "-"],
        check=False,
    )
    match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?)", proc.stderr)
    if not match:
        log.warning("volumedetect não retornou mean_volume — assumindo 0dB (não silent)")
        return 0.0
    return float(match.group(1))


def _detect_duration(input_path: str) -> int:
    """ffprobe → duração em segundos (int)."""
    proc = _run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            input_path,
        ],
        check=False,
    )
    try:
        return int(round(float(proc.stdout.strip())))
    except (ValueError, AttributeError):
        log.warning("ffprobe não retornou duração válida — assumindo 0")
        return 0


def _compress_silent(input_path: str, out_path: str) -> None:
    """Compress sem silenceremove (usado quando áudio é silent total)."""
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path,
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-b:a", BITRATE,
        out_path,
    ])


def _compress_with_silenceremove(input_path: str, out_path: str) -> None:
    """Compress + silenceremove (mesmos params do mac-agent/transcribe.sh)."""
    af = (
        f"silenceremove=stop_periods=-1:"
        f"stop_duration={SILENCEREMOVE_MIN}:"
        f"stop_threshold={SILENCEREMOVE_DB}"
    )
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path,
        "-af", af,
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-b:a", BITRATE,
        out_path,
    ])


def _filter_utterances(utterances: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filtra utterances com speaker A-Z puro, converte start/end ms→s."""
    out: list[dict[str, Any]] = []
    for u in utterances or []:
        speaker = str(u.get("speaker", ""))
        if not VALID_SPEAKER_RE.match(speaker):
            continue
        out.append({
            "speaker": speaker,
            "start": float(u.get("start", 0)) / 1000.0,
            "end": float(u.get("end", 0)) / 1000.0,
            "text": str(u.get("text", "")),
        })
    return out


async def _aai_upload(client: httpx.AsyncClient, file_path: str) -> str:
    """POST /v2/upload com body binary → retorna upload_url."""
    with open(file_path, "rb") as f:
        resp = await client.post(
            f"{ASSEMBLYAI_BASE}/v2/upload",
            headers={
                "Authorization": ASSEMBLYAI_API_KEY,
                "Content-Type": "application/octet-stream",
            },
            content=f.read(),
            timeout=httpx.Timeout(connect=10.0, read=600.0, write=600.0, pool=10.0),
        )
    if resp.status_code != 200:
        raise RuntimeError(f"AssemblyAI upload {resp.status_code}: {resp.text[:400]}")
    upload_url = resp.json().get("upload_url", "")
    if not upload_url:
        raise RuntimeError(f"AssemblyAI upload sem upload_url: {resp.text[:400]}")
    return upload_url


async def _aai_request_transcript(client: httpx.AsyncClient, upload_url: str) -> str:
    """POST /v2/transcript com speaker_labels + speech_models → retorna transcript_id."""
    body = {
        "audio_url": upload_url,
        "language_code": "pt",
        "speaker_labels": True,
        "speech_models": SPEECH_MODELS,
    }
    resp = await client.post(
        f"{ASSEMBLYAI_BASE}/v2/transcript",
        headers={
            "Authorization": ASSEMBLYAI_API_KEY,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30.0,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"AssemblyAI request {resp.status_code}: {resp.text[:400]}")
    transcript_id = resp.json().get("id", "")
    if not transcript_id:
        raise RuntimeError(f"AssemblyAI request sem id: {resp.text[:400]}")
    return transcript_id


async def _aai_poll(client: httpx.AsyncClient, transcript_id: str) -> dict[str, Any]:
    """Polling GET /v2/transcript/<id> até status=completed. Retorna payload final."""
    start = asyncio.get_event_loop().time()
    while True:
        resp = await client.get(
            f"{ASSEMBLYAI_BASE}/v2/transcript/{transcript_id}",
            headers={"Authorization": ASSEMBLYAI_API_KEY},
            timeout=30.0,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"AssemblyAI poll {resp.status_code}: {resp.text[:400]}")
        payload = resp.json()
        status = payload.get("status", "unknown")
        elapsed = asyncio.get_event_loop().time() - start

        if status == "completed":
            log.info("AssemblyAI completed em %.1fs", elapsed)
            return payload
        if status == "error":
            raise RuntimeError(f"AssemblyAI error: {payload.get('error', 'unknown')}")
        if status not in ("queued", "processing"):
            raise RuntimeError(f"AssemblyAI status inesperado: {status} — payload={str(payload)[:300]}")

        if elapsed > POLL_MAX_SECONDS:
            raise RuntimeError(f"AssemblyAI polling timeout após {POLL_MAX_SECONDS}s (último={status})")

        log.info("AssemblyAI status=%s (elapsed=%.1fs)", status, elapsed)
        await asyncio.sleep(POLL_INTERVAL)


async def transcribe(input_path: str, workdir: str) -> TranscribeResult:
    """Pipeline completo. workdir é um tmpdir já criado (chamador deleta depois)."""
    if not ASSEMBLYAI_API_KEY:
        raise RuntimeError("ASSEMBLYAI_API_KEY não definida")
    if not os.path.exists(input_path):
        raise RuntimeError(f"input não existe: {input_path}")

    duration = _detect_duration(input_path)
    mean_vol = _detect_mean_volume(input_path)
    log.info("mean_volume=%.2fdB duration=%ds (silent_gate=%.1fdB)", mean_vol, duration, SILENCE_GATE_DB)

    compressed_path = os.path.join(workdir, "compressed.mp3")

    # 1. Silent total — pula API
    if mean_vol <= SILENCE_GATE_DB:
        log.info("SILENT — pulando AssemblyAI API")
        _compress_silent(input_path, compressed_path)
        return TranscribeResult(
            text="",
            duration_seconds=duration,
            silent=True,
            n_chunks=0,
            compressed_path=compressed_path,
            segments=[],
        )

    # 2. Comprime + silenceremove
    log.info("comprimindo com silenceremove")
    _compress_with_silenceremove(input_path, compressed_path)
    comp_size = os.path.getsize(compressed_path)

    # 2b. Guard ≤10h — medido no COMPRESSED (o que sobe pro AssemblyAI), não no
    # original. Gravação de dia inteiro mayoritariamente silenciosa encolhe pra
    # poucas horas e passa; só barra quem realmente tem >~10h de som.
    compressed_duration = _detect_duration(compressed_path)
    log.info(
        "compressed_size=%dB original_duration=%ds compressed_duration=%ds models=%s",
        comp_size, duration, compressed_duration, SPEECH_MODELS,
    )
    if compressed_duration > MAX_AUDIO_SECONDS:
        raise AudioTooLongError(compressed_duration)

    # 3. AssemblyAI: upload + request + polling
    async with httpx.AsyncClient() as client:
        log.info("upload pra AssemblyAI (%dB)", comp_size)
        upload_url = await _aai_upload(client, compressed_path)
        log.info("upload OK")

        log.info("solicitando transcrição (models=%s, speaker_labels=true, lang=pt)", SPEECH_MODELS)
        transcript_id = await _aai_request_transcript(client, upload_url)
        log.info("transcript_id=%s", transcript_id)

        payload = await _aai_poll(client, transcript_id)

    text = str(payload.get("text", ""))
    segments = _filter_utterances(payload.get("utterances", []) or [])
    n_speakers = len({s["speaker"] for s in segments})
    log.info("saída: %d turnos, %d speakers distintos, %d chars", len(segments), n_speakers, len(text))

    return TranscribeResult(
        text=text,
        duration_seconds=duration,
        silent=False,
        n_chunks=1,
        compressed_path=compressed_path,
        segments=segments,
    )


def _detect_meeting_segments(input_path: str) -> list[tuple[float, float]]:
    """Detecta reuniões distintas por gap de silêncio no áudio CRU.

    Retorna lista de (start, end) em segundos. 1 elemento = arquivo inteiro
    (sem gaps grandes — caminho normal). Espelha mac-agent/audio-watcher.sh.
    """
    dur = _detect_duration(input_path)
    if dur <= 0:
        return [(0.0, 0.0)]
    # Curto demais pra conter 2 reuniões + um gap → não vale a varredura.
    if dur < GAP_SECONDS + 2 * MIN_MEETING_SECONDS:
        return [(0.0, float(dur))]
    proc = _run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", input_path,
         "-af", f"silencedetect=noise=-50dB:d={GAP_SECONDS}", "-f", "null", "-"],
        check=False,
    )
    # silencedetect loga no stderr.
    events = re.findall(r"silence_(start|end):\s*([0-9.]+)", proc.stderr)
    islands: list[tuple[float, float]] = []
    cur = 0.0
    for kind, val in events:
        v = float(val)
        if kind == "start":
            if v - cur >= MIN_MEETING_SECONDS:
                islands.append((cur, v))
        else:  # end
            cur = v
    if dur - cur >= MIN_MEETING_SECONDS:
        islands.append((cur, float(dur)))
    return islands if islands else [(0.0, float(dur))]


async def transcribe_segments(input_path: str, workdir: str) -> list[TranscribeResult]:
    """Igual a transcribe(), mas separa reuniões distintas (gap de silêncio).

    1 segmento → [transcribe(arquivo inteiro)] (comportamento idêntico ao de antes).
    N segmentos → recorta cada reunião e transcreve isolada (diarização por reunião).
    Segmentos vazios/too-long são pulados (lista pode ter < N itens).
    """
    segs = _detect_meeting_segments(input_path)
    if len(segs) <= 1:
        return [await transcribe(input_path, workdir)]

    log.info("SPLIT: %d reuniões detectadas (gap>=%ds)", len(segs), GAP_SECONDS)
    results: list[TranscribeResult] = []
    for i, (start, end) in enumerate(segs, 1):
        clip = os.path.join(workdir, f"seg_{i}.mp3")
        _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(start), "-to", str(end), "-i", input_path,
            "-ar", str(SAMPLE_RATE), "-ac", "1", "-b:a", BITRATE, clip,
        ])
        sub = os.path.join(workdir, f"seg_{i}_work")
        os.makedirs(sub, exist_ok=True)
        try:
            results.append(await transcribe(clip, sub))
        except AudioTooLongError as e:
            log.warning("segmento %d (%ds) too long — pulando: %s", i, int(end - start), e)
        finally:
            try:
                os.remove(clip)
            except OSError:
                pass
    return results


async def cleanup_compressed(result: TranscribeResult) -> None:
    """Best-effort cleanup do compressed_path."""
    try:
        if os.path.exists(result.compressed_path):
            os.remove(result.compressed_path)
    except OSError as e:
        log.warning("cleanup falhou: %s", e)

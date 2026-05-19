"""Manipulação de áudio: extração de trechos via ffmpeg + agrupamento de turnos."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class Segment:
    speaker: str
    start: float
    end: float
    text: str


@dataclass
class Turn:
    speaker: str
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def parse_segments(raw: list[dict]) -> list[Segment]:
    out: list[Segment] = []
    for s in raw or []:
        try:
            out.append(
                Segment(
                    speaker=str(s["speaker"]),
                    start=float(s["start"]),
                    end=float(s["end"]),
                    text=str(s.get("text", "")),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def group_turns(segments: list[Segment]) -> list[Turn]:
    """Agrupa segments contíguos do mesmo speaker em turnos. Espelha groupTurns do frontend."""
    turns: list[Turn] = []
    for s in segments:
        if turns and turns[-1].speaker == s.speaker:
            turns[-1].end = s.end
        else:
            turns.append(Turn(speaker=s.speaker, start=s.start, end=s.end))
    return turns


def pick_representative_turns(
    turns: list[Turn],
    speaker: str,
    *,
    min_duration: float = 3.0,
    max_total: float = 30.0,
    max_turns: int = 5,
) -> list[Turn]:
    """Pra um speaker, escolhe os turnos mais longos somando até ~max_total segundos.

    Filtra turnos curtos (< min_duration) e limita a max_turns pra evitar embeddings demais.
    """
    candidates = [t for t in turns if t.speaker == speaker and t.duration >= min_duration]
    candidates.sort(key=lambda t: t.duration, reverse=True)

    picked: list[Turn] = []
    total = 0.0
    for t in candidates:
        if len(picked) >= max_turns:
            break
        if total >= max_total:
            break
        picked.append(t)
        total += t.duration
    return picked


def distinct_speakers(turns: list[Turn]) -> list[str]:
    seen: list[str] = []
    for t in turns:
        if t.speaker not in seen:
            seen.append(t.speaker)
    return seen


def extract_segment_to_wav(
    src_path: str,
    start: float,
    end: float,
    dst_path: str,
    sample_rate: int = 16000,
) -> None:
    """Extrai [start, end) do áudio source pra WAV mono 16kHz (formato esperado pelo ECAPA)."""
    duration = max(0.1, end - start)
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        src_path,
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "wav",
        dst_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou ({proc.returncode}): {proc.stderr.strip()}")

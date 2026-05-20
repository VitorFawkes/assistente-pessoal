"""Embedding de voz via SpeechBrain ECAPA-TDNN."""
from __future__ import annotations

import os

import numpy as np
import torch
import torchaudio
from speechbrain.inference.speaker import EncoderClassifier

MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_CACHE = os.environ.get("SB_MODEL_CACHE", "/app/model_cache")
EMBED_DIM = 192
SAMPLE_RATE = 16000


def load_encoder() -> EncoderClassifier:
    return EncoderClassifier.from_hparams(
        source=MODEL_SOURCE,
        savedir=MODEL_CACHE,
        run_opts={"device": "cpu"},
    )


def encode_wav(encoder: EncoderClassifier, wav_path: str) -> np.ndarray:
    """Lê WAV mono 16kHz e devolve embedding L2-normalizado (192,) em float32."""
    waveform, sr = torchaudio.load(wav_path)
    if sr != SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sr, SAMPLE_RATE)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    # SpeechBrain espera batch — (1, samples)
    with torch.no_grad():
        emb = encoder.encode_batch(waveform)  # (1, 1, 192)
    vec = emb.squeeze().detach().cpu().numpy().astype(np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    if vec.shape != (EMBED_DIM,):
        raise RuntimeError(f"embedding dim inesperada: {vec.shape}, esperado ({EMBED_DIM},)")
    return vec


def average_embeddings(vectors: list[np.ndarray]) -> np.ndarray:
    """Média + L2 norm — usado pra consolidar vários trechos do mesmo speaker num único vetor."""
    if not vectors:
        raise ValueError("vectors vazio")
    avg = np.mean(np.stack(vectors), axis=0).astype(np.float32)
    norm = float(np.linalg.norm(avg))
    if norm > 0:
        avg = avg / norm
    return avg


def reject_outliers(vectors: list[np.ndarray], min_similarity: float = 0.5) -> list[int]:
    """Detecta outliers num conjunto de embeddings que DEVERIAM ser da mesma pessoa.

    Necessário porque diarização (gpt-4o-transcribe-diarize) às vezes mistura
    vozes diferentes sob a mesma letter — quando o usuário rotula "Speaker A
    = Vitor", parte dos trechos pode ser outra pessoa misturada.

    Estratégia: pra cada trecho, calcula similaridade média com os outros.
    Trechos com sim média < min_similarity são considerados outliers e
    rejeitados. Vetores já estão L2-normalizados, então cosine = dot product.

    Retorna lista de índices dos vetores a MANTER (rejeitando outliers).
    Se há ≤ 2 vetores, mantém todos (não há base estatística pra rejeitar).
    """
    if len(vectors) <= 2:
        return list(range(len(vectors)))

    embs = np.stack(vectors).astype(np.float32)
    sim_matrix = embs @ embs.T  # (n, n), diagonal = 1.0
    n = len(vectors)

    # Pra cada trecho, similaridade média com os OUTROS (excluindo diagonal)
    np.fill_diagonal(sim_matrix, np.nan)
    avg_sims = np.nanmean(sim_matrix, axis=1)

    keep = [i for i in range(n) if avg_sims[i] >= min_similarity]
    # Se rejeitar todos por algum bug, mantém pelo menos o que tem sim média mais alta
    if not keep:
        keep = [int(np.nanargmax(avg_sims))]
    return keep

"""Postgres helpers — psycopg3 + busca cosine em Python.

═════════════════════════════════════════════════════════════════════
⚠️  ATENÇÃO: SEM pgvector  ⚠️
═════════════════════════════════════════════════════════════════════
voice_samples.embedding é REAL[] (não vector(192)) porque a imagem
postgres atual não tem pgvector instalado. Detalhes em
/AGENTS.md (raiz) e db/0005_voice_samples.sql.

search_top_k abaixo carrega TODAS as amostras ativas e calcula cosine
no Python via numpy. Funciona até ~10k amostras sem dor.
═════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ["DATABASE_URL"]

# Single-user; pool pequeno basta. min=1 mantém uma conexão warm.
_pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=4,
    kwargs={"row_factory": dict_row},
    open=False,
)


def open_pool() -> None:
    _pool.open()
    # warm-up
    with _pool.connection() as c:
        c.execute("SELECT 1")


def close_pool() -> None:
    _pool.close()


@contextmanager
def conn() -> Iterator[psycopg.Connection]:
    with _pool.connection() as c:
        yield c


# ─── domain queries ──────────────────────────────────────────────────


def get_meeting(meeting_id: str) -> dict | None:
    with conn() as c:
        row = c.execute(
            "SELECT id, audio_path, segments, speaker_pessoas FROM meetings WHERE id = %s",
            (meeting_id,),
        ).fetchone()
    return row


def get_pessoa(pessoa_id: str) -> dict | None:
    with conn() as c:
        row = c.execute(
            "SELECT id, nome FROM pessoas WHERE id = %s",
            (pessoa_id,),
        ).fetchone()
    return row


def insert_voice_sample(
    *,
    pessoa_id: str,
    embedding: np.ndarray,
    source_meeting_id: str,
    source_speaker_letter: str,
    source_segment_range: str,
    duration_seconds: float,
) -> str:
    # psycopg3 serializa list[float] como REAL[] nativamente
    embedding_list = embedding.astype(np.float32).tolist()
    with conn() as c:
        row = c.execute(
            """
            INSERT INTO voice_samples (
              pessoa_id, embedding,
              source_meeting_id, source_speaker_letter,
              source_segment_range, duration_seconds
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                pessoa_id,
                embedding_list,
                source_meeting_id,
                source_speaker_letter,
                source_segment_range,
                duration_seconds,
            ),
        ).fetchone()
        c.commit()
    return str(row["id"])


def search_top_k(query_embedding: np.ndarray, k: int = 5) -> list[dict]:
    """Top-K vizinhos por cosine distance — feito em Python pois não temos pgvector.

    Retorna [{pessoa_id, nome, distance, sample_count}] ordenado por distance ASC
    (mais próximo primeiro). Distance ∈ [0, 2]; 0 = idêntico.

    Performance: SELECT all active + numpy. Linear na quantidade de amostras
    ativas. Adequado pra single-user até ~10k amostras.
    """
    with conn() as c:
        rows = c.execute(
            """
            SELECT vs.pessoa_id, p.nome, vs.embedding
            FROM voice_samples vs
            JOIN pessoas p ON p.id = vs.pessoa_id
            WHERE vs.soft_deleted_at IS NULL
            """
        ).fetchall()

    if not rows:
        return []

    # Embeddings → matrix (n, 192). psycopg devolve list[float] pra REAL[].
    embs = np.array([r["embedding"] for r in rows], dtype=np.float32)
    q = query_embedding.astype(np.float32)

    # Vetores estão L2-normalizados, então cosine_similarity = dot product.
    # cosine_distance = 1 - cosine_similarity.
    sims = embs @ q
    distances = 1.0 - sims

    # Top-K por menor distância
    if len(distances) <= k:
        top_idx = np.argsort(distances)
    else:
        part = np.argpartition(distances, k)[:k]
        top_idx = part[np.argsort(distances[part])]

    # Contagem por pessoa pra exibir sample_count
    pessoa_counts: dict[str, int] = {}
    for r in rows:
        pid = str(r["pessoa_id"])
        pessoa_counts[pid] = pessoa_counts.get(pid, 0) + 1

    return [
        {
            "pessoa_id": rows[i]["pessoa_id"],
            "nome": rows[i]["nome"],
            "distance": float(distances[i]),
            "sample_count": pessoa_counts[str(rows[i]["pessoa_id"])],
        }
        for i in top_idx
    ]


def update_speaker_labels_proposed(meeting_id: str, proposed: dict) -> None:
    with conn() as c:
        c.execute(
            "UPDATE meetings SET speaker_labels_proposed = %s::jsonb WHERE id = %s",
            (json.dumps(proposed), meeting_id),
        )
        c.commit()


def has_active_sample(meeting_id: str, letter: str, pessoa_id: str) -> bool:
    """Já existe amostra ativa pra essa (meeting, letter, pessoa)? Usado pra idempotência do enroll."""
    with conn() as c:
        row = c.execute(
            """
            SELECT 1 FROM voice_samples
            WHERE source_meeting_id = %s
              AND source_speaker_letter = %s
              AND pessoa_id = %s
              AND soft_deleted_at IS NULL
            LIMIT 1
            """,
            (meeting_id, letter, pessoa_id),
        ).fetchone()
    return row is not None


def soft_delete_sample(sample_id: str) -> bool:
    with conn() as c:
        row = c.execute(
            """
            UPDATE voice_samples
            SET soft_deleted_at = now()
            WHERE id = %s AND soft_deleted_at IS NULL
            RETURNING id
            """,
            (sample_id,),
        ).fetchone()
        c.commit()
    return row is not None


def is_valid_uuid(s: str) -> bool:
    try:
        UUID(s)
        return True
    except (ValueError, TypeError):
        return False

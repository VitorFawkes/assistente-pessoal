"""Postgres helpers — psycopg3 + pgvector."""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

import numpy as np
import psycopg
from pgvector.psycopg import register_vector
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


def _configure(conn: psycopg.Connection) -> None:
    register_vector(conn)


def open_pool() -> None:
    _pool.open()
    # configura cada nova conexão no pool
    _pool.configure = _configure  # type: ignore[attr-defined]
    # warm-up: faz uma conn ser criada já configurada
    with _pool.connection() as c:
        _configure(c)


def close_pool() -> None:
    _pool.close()


@contextmanager
def conn() -> Iterator[psycopg.Connection]:
    with _pool.connection() as c:
        _configure(c)
        yield c


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
                embedding,
                source_meeting_id,
                source_speaker_letter,
                source_segment_range,
                duration_seconds,
            ),
        ).fetchone()
        c.commit()
    return str(row["id"])


def search_top_k(embedding: np.ndarray, k: int = 5) -> list[dict]:
    """Top-K vizinhos por cosine distance. Retorna {pessoa_id, nome, distance, sample_count}.

    sample_count = total de amostras ativas daquela pessoa (pra UI mostrar "12 amostras").
    """
    with conn() as c:
        rows = c.execute(
            """
            WITH nearest AS (
              SELECT pessoa_id, embedding <=> %s AS distance
              FROM voice_samples
              WHERE soft_deleted_at IS NULL
              ORDER BY embedding <=> %s
              LIMIT %s
            )
            SELECT n.pessoa_id, p.nome, n.distance,
                   (SELECT count(*)::int FROM voice_samples vs
                    WHERE vs.pessoa_id = n.pessoa_id AND vs.soft_deleted_at IS NULL) AS sample_count
            FROM nearest n
            JOIN pessoas p ON p.id = n.pessoa_id
            ORDER BY n.distance ASC
            """,
            (embedding, embedding, k),
        ).fetchall()
    return rows


def update_speaker_labels_proposed(meeting_id: str, proposed: dict) -> None:
    import json

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

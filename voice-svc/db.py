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

═════════════════════════════════════════════════════════════════════
MULTI-TENANT (v2): voice-svc roda com role `app_writer` (BYPASSRLS).
Todas as funções recebem user_id explícito e filtram por user_id nas
queries — defesa em profundidade. Inserts incluem user_id.
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

# Single-process; pool pequeno basta. min=1 mantém uma conexão warm.
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


# ─── domain queries (todas escopadas por user_id) ────────────────────


def get_meeting(meeting_id: str, user_id: str) -> dict | None:
    with conn() as c:
        row = c.execute(
            """
            SELECT id, audio_path, segments, speaker_pessoas
            FROM meetings
            WHERE id = %s AND user_id = %s
            """,
            (meeting_id, user_id),
        ).fetchone()
    return row


def get_pessoa(pessoa_id: str, user_id: str) -> dict | None:
    with conn() as c:
        row = c.execute(
            "SELECT id, nome FROM pessoas WHERE id = %s AND user_id = %s",
            (pessoa_id, user_id),
        ).fetchone()
    return row


def insert_voice_sample(
    *,
    user_id: str,
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
              user_id, pessoa_id, embedding,
              source_meeting_id, source_speaker_letter,
              source_segment_range, duration_seconds
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                user_id,
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


def search_top_k(query_embedding: np.ndarray, user_id: str, k: int = 5) -> list[dict]:
    """Top-K vizinhos por cosine distance, escopados ao user.

    Retorna [{pessoa_id, nome, distance, sample_count}] ordenado por distance ASC
    (mais próximo primeiro). Distance ∈ [0, 2]; 0 = idêntico.
    """
    with conn() as c:
        rows = c.execute(
            """
            SELECT vs.pessoa_id, p.nome, vs.embedding
            FROM voice_samples vs
            JOIN pessoas p ON p.id = vs.pessoa_id
            WHERE vs.user_id = %s AND vs.soft_deleted_at IS NULL
            """,
            (user_id,),
        ).fetchall()

    if not rows:
        return []

    embs = np.array([r["embedding"] for r in rows], dtype=np.float32)
    q = query_embedding.astype(np.float32)

    # Vetores estão L2-normalizados, então cosine_similarity = dot product.
    sims = embs @ q
    distances = 1.0 - sims

    if len(distances) <= k:
        top_idx = np.argsort(distances)
    else:
        part = np.argpartition(distances, k)[:k]
        top_idx = part[np.argsort(distances[part])]

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


def update_speaker_labels_proposed(meeting_id: str, user_id: str, proposed: dict) -> None:
    with conn() as c:
        c.execute(
            """
            UPDATE meetings
               SET speaker_labels_proposed = %s::jsonb
             WHERE id = %s AND user_id = %s
            """,
            (json.dumps(proposed), meeting_id, user_id),
        )
        c.commit()


def invalidate_other_pessoa_samples(
    meeting_id: str, user_id: str, letter: str, current_pessoa_id: str
) -> int:
    """Quando o usuário corrige uma rotulação, soft-delete as amostras antigas
    da MESMA (meeting, letter) que pertenciam a OUTRA pessoa. Escopado ao user.
    """
    with conn() as c:
        row = c.execute(
            """
            UPDATE voice_samples
               SET soft_deleted_at = now()
             WHERE source_meeting_id = %s
               AND user_id = %s
               AND source_speaker_letter = %s
               AND pessoa_id <> %s
               AND soft_deleted_at IS NULL
            RETURNING id
            """,
            (meeting_id, user_id, letter, current_pessoa_id),
        ).fetchall()
        c.commit()
    return len(row)


def has_active_sample(meeting_id: str, user_id: str, letter: str, pessoa_id: str) -> bool:
    """Já existe amostra ativa pra essa (user, meeting, letter, pessoa)?"""
    with conn() as c:
        row = c.execute(
            """
            SELECT 1 FROM voice_samples
            WHERE source_meeting_id = %s
              AND user_id = %s
              AND source_speaker_letter = %s
              AND pessoa_id = %s
              AND soft_deleted_at IS NULL
            LIMIT 1
            """,
            (meeting_id, user_id, letter, pessoa_id),
        ).fetchone()
    return row is not None


def reassign_sample(sample_id: str, user_id: str, new_pessoa_id: str) -> dict | None:
    """Reatribui uma amostra ativa pra outra pessoa do mesmo user."""
    with conn() as c:
        row = c.execute(
            """
            UPDATE voice_samples
               SET pessoa_id = %s
             WHERE id = %s AND user_id = %s AND soft_deleted_at IS NULL
            RETURNING id, source_meeting_id, source_speaker_letter
            """,
            (new_pessoa_id, sample_id, user_id),
        ).fetchone()
        c.commit()
    return row


def recompute_meeting_speaker_for_letter(
    meeting_id: str, user_id: str, letter: str
) -> dict | None:
    """Recomputa speaker_labels[letter] e speaker_pessoas[letter] com base na
    pessoa majoritária das amostras ativas de (user, meeting, letter).
    """
    with conn() as c:
        majority = c.execute(
            """
            SELECT vs.pessoa_id, p.nome, count(*)::int AS n
            FROM voice_samples vs
            JOIN pessoas p ON p.id = vs.pessoa_id
            WHERE vs.source_meeting_id = %s
              AND vs.user_id = %s
              AND vs.source_speaker_letter = %s
              AND vs.soft_deleted_at IS NULL
            GROUP BY vs.pessoa_id, p.nome
            ORDER BY n DESC, p.nome ASC
            LIMIT 1
            """,
            (meeting_id, user_id, letter),
        ).fetchone()

        if not majority:
            return None

        pessoa_id = str(majority["pessoa_id"])
        nome = majority["nome"]

        c.execute(
            """
            UPDATE meetings
               SET speaker_labels = jsonb_set(coalesce(speaker_labels, '{}'::jsonb), %s, to_jsonb(%s::text), true),
                   speaker_pessoas = jsonb_set(coalesce(speaker_pessoas, '{}'::jsonb), %s, to_jsonb(%s::text), true)
             WHERE id = %s AND user_id = %s
            """,
            (
                "{" + letter + "}",
                nome,
                "{" + letter + "}",
                pessoa_id,
                meeting_id,
                user_id,
            ),
        )
        c.commit()
    return {"pessoa_id": pessoa_id, "nome": nome}


def soft_delete_sample(sample_id: str, user_id: str) -> bool:
    with conn() as c:
        row = c.execute(
            """
            UPDATE voice_samples
            SET soft_deleted_at = now()
            WHERE id = %s AND user_id = %s AND soft_deleted_at IS NULL
            RETURNING id
            """,
            (sample_id, user_id),
        ).fetchone()
        c.commit()
    return row is not None


def is_valid_uuid(s: str) -> bool:
    try:
        UUID(s)
        return True
    except (ValueError, TypeError):
        return False

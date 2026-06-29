import { withTenant, query } from "./db";
import { PoolClient } from "pg";
import { TAREFA_SELECT, type Tarefa, type TarefaPessoa } from "./queries";
import { randomBytes } from "node:crypto";

// ─── Tipos de Domínio ──────────────────────────────────────────────────

export type Quadro = {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type QuadroConvidado = {
  id: string;
  quadro_id: string;
  nome: string;
  token: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type QuadroComContagem = Quadro & {
  n_tarefas: number;
  n_convidados: number;
};

// Retorno de resolver_quadro_token (função SQL SECURITY DEFINER)
export type AcessoConvidado = {
  quadroId: string;
  ownerId: string;
  quadroNome: string;
  convidadoId: string;
  convidadoNome: string;
};

// Eventos auditados com atribuição de convidado
export type TarefaEvento = {
  id: string;
  tarefa_id: string;
  evento: string;
  quadro_convidado_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// Item de atividade auditada (com nomes de convidados e tarefas)
export type AtividadeItem = {
  id: string;
  criado_em: string;
  evento: string;
  tarefa_titulo: string;
  tarefa_id: string;
  convidado_nome: string | null;
  convidado_id: string | null;
};

// ─── quadrosFor(userId) — Factory ────────────────────────────────────

/**
 * Factory que retorna helpers pra CRUD de quadros do usuário.
 * Todas as queries rodam dentro de withTenant(userId, ...) — RLS filtra ao user_id.
 */
export function quadrosFor(userId: string) {
  return {
    /**
     * Lista quadros não-arquivados com contagem de tarefas e convidados.
     */
    list: async (): Promise<QuadroComContagem[]> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<QuadroComContagem>(
          `SELECT
             q.*,
             (SELECT COUNT(*)::int FROM quadro_tarefas WHERE quadro_id = q.id) AS n_tarefas,
             (SELECT COUNT(*)::int FROM quadro_convidados WHERE quadro_id = q.id AND revoked_at IS NULL) AS n_convidados
           FROM quadros q
           WHERE archived_at IS NULL
           ORDER BY q.created_at DESC`,
        );
        return r.rows;
      });
    },

    /**
     * Carrega um quadro específico (sem contagem).
     */
    get: async (id: string): Promise<Quadro | null> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<Quadro>(
          `SELECT * FROM quadros WHERE id = $1`,
          [id],
        );
        return r.rows[0] ?? null;
      });
    },

    /**
     * Cria um novo quadro. Retorna a linha inserida.
     */
    criar: async (nome: string, descricao?: string): Promise<Quadro> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<Quadro>(
          `INSERT INTO quadros (user_id, nome, descricao)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [userId, nome, descricao || null],
        );
        return r.rows[0]!;
      });
    },

    /**
     * Atualiza nome e/ou descrição. Retorna a linha atualizada ou null se não encontrado.
     */
    atualizar: async (
      id: string,
      nome?: string | null,
      descricao?: string | null,
    ): Promise<Quadro | null> => {
      return withTenant(userId, async (c) => {
        const updates: string[] = [];
        const values: unknown[] = [id];
        let idx = 2;

        if (nome !== undefined) {
          updates.push(`nome = $${idx++}`);
          values.push(nome);
        }
        if (descricao !== undefined) {
          updates.push(`descricao = $${idx++}`);
          values.push(descricao || null);
        }

        if (updates.length === 0) return null;

        updates.push("updated_at = now()");

        const r = await c.query<Quadro>(
          `UPDATE quadros SET ${updates.join(", ")}
           WHERE id = $1
           RETURNING *`,
          values,
        );
        return r.rows[0] ?? null;
      });
    },

    /**
     * Arquiva um quadro (soft delete via archived_at).
     */
    arquivar: async (id: string): Promise<void> => {
      return withTenant(userId, async (c) => {
        await c.query(
          `UPDATE quadros SET archived_at = now() WHERE id = $1`,
          [id],
        );
      });
    },

    /**
     * Lista tarefas do quadro, serializadas (área + pessoas) via TAREFA_SELECT
     * pra renderizar nos cards (TaskRow).
     */
    tarefas: async (quadroId: string): Promise<Tarefa[]> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<Tarefa>(
          `${TAREFA_SELECT}
           JOIN quadro_tarefas qt ON qt.tarefa_id = t.id
           WHERE qt.quadro_id = $1
           ORDER BY qt.ordem NULLS LAST, t.created_at DESC`,
          [quadroId],
        );
        return r.rows;
      });
    },

    /**
     * Tarefas candidatas a entrar no quadro: abertas/em andamento do dono que
     * ainda NÃO estão neste quadro. Pra o picker "adicionar existentes".
     * `q` filtra por título/descrição/owner (opcional).
     */
    candidatas: async (quadroId: string, q?: string): Promise<Tarefa[]> => {
      return withTenant(userId, async (c) => {
        const like = q && q.trim() ? `%${q.trim()}%` : null;
        const r = await c.query<Tarefa>(
          `${TAREFA_SELECT}
           WHERE t.status IN ('aberta','em_andamento')
             AND NOT EXISTS (
               SELECT 1 FROM quadro_tarefas qt
               WHERE qt.quadro_id = $1 AND qt.tarefa_id = t.id
             )
             AND ($2::text IS NULL OR t.titulo ILIKE $2 OR t.descricao ILIKE $2 OR t.owner ILIKE $2)
           ORDER BY t.created_at DESC
           LIMIT 500`,
          [quadroId, like],
        );
        return r.rows;
      });
    },

    /**
     * Adiciona múltiplas tarefas ao quadro (INSERT com conflict ignorado).
     * Retorna contadores: adicionadas (novas) e duplicadas (já existiam).
     */
    adicionarTarefas: async (
      quadroId: string,
      tarefaIds: string[],
    ): Promise<{ adicionadas: number; duplicadas: number }> => {
      return withTenant(userId, async (c) => {
        if (tarefaIds.length === 0) return { adicionadas: 0, duplicadas: 0 };

        // Insert com ON CONFLICT ignorado, contando os inseridos
        const r = await c.query<{ count: number }>(
          `WITH inserted AS (
             INSERT INTO quadro_tarefas (quadro_id, tarefa_id)
             SELECT $1, unnest($2::uuid[])
             ON CONFLICT (quadro_id, tarefa_id) DO NOTHING
             RETURNING tarefa_id
           )
           SELECT COUNT(*)::int as count FROM inserted`,
          [quadroId, tarefaIds],
        );
        const adicionadas = r.rows[0]?.count ?? 0;
        const duplicadas = tarefaIds.length - adicionadas;

        return { adicionadas, duplicadas };
      });
    },

    /**
     * Remove uma tarefa do quadro.
     */
    removerTarefa: async (quadroId: string, tarefaId: string): Promise<void> => {
      return withTenant(userId, async (c) => {
        await c.query(
          `DELETE FROM quadro_tarefas WHERE quadro_id = $1 AND tarefa_id = $2`,
          [quadroId, tarefaId],
        );
      });
    },

    /**
     * Lista convidados ativos (não revogados) do quadro.
     */
    convidados: async (quadroId: string): Promise<QuadroConvidado[]> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<QuadroConvidado>(
          `SELECT * FROM quadro_convidados
           WHERE quadro_id = $1 AND revoked_at IS NULL
           ORDER BY created_at DESC`,
          [quadroId],
        );
        return r.rows;
      });
    },

    /**
     * Cria um novo convidado com token único (base64url de 128 bits).
     * Retorna { id, nome, token, link }.
     */
    criarConvidado: async (
      quadroId: string,
      nome: string,
    ): Promise<{ id: string; nome: string; token: string; link: string }> => {
      return withTenant(userId, async (c) => {
        const token = randomBytes(16).toString("base64url");
        const r = await c.query<{ id: string }>(
          `INSERT INTO quadro_convidados (quadro_id, nome, token)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [quadroId, nome, token],
        );
        const id = r.rows[0]?.id!;

        // Construir link: base_url + /q/[token]
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        const link = `${baseUrl}/q/${token}`;

        return { id, nome, token, link };
      });
    },

    /**
     * Revoga um convidado (soft delete via revoked_at).
     * Invalida o token imediatamente.
     */
    revogarConvidado: async (
      quadroId: string,
      convidadoId: string,
    ): Promise<void> => {
      return withTenant(userId, async (c) => {
        await c.query(
          `UPDATE quadro_convidados
           SET revoked_at = now()
           WHERE id = $1 AND quadro_id = $2`,
          [convidadoId, quadroId],
        );
      });
    },

    /**
     * Lista atividade auditada do quadro:
     * - SELECT FROM tarefa_eventos
     * - LEFT JOIN quadro_convidados (pra nome do convidado)
     * - LEFT JOIN tarefas (pra título)
     * - Filtra por tarefas que pertencem ao quadro
     * - ORDER BY created_at DESC
     */
    atividade: async (quadroId: string, limit = 50): Promise<AtividadeItem[]> => {
      return withTenant(userId, async (c) => {
        const r = await c.query<AtividadeItem>(
          `SELECT
             te.id,
             to_char(te.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
             te.evento,
             t.titulo AS tarefa_titulo,
             t.id AS tarefa_id,
             qc.nome AS convidado_nome,
             qc.id AS convidado_id
           FROM tarefa_eventos te
           LEFT JOIN quadro_convidados qc ON qc.id = te.quadro_convidado_id
           LEFT JOIN tarefas t ON t.id = te.tarefa_id
           WHERE EXISTS (
             SELECT 1 FROM quadro_tarefas qt
             WHERE qt.quadro_id = $1 AND qt.tarefa_id = te.tarefa_id
           )
           ORDER BY te.created_at DESC
           LIMIT $2`,
          [quadroId, limit],
        );
        return r.rows;
      });
    },
  };
}

// Equipe: projeto = quadro com pessoas. Tudo que alguém do projeto faz nele passa por
// `comoDonoDoProjeto` (conferido no banco, db/equipe/008) e roda no tenant de quem criou o
// projeto. As tarefas continuam de quem as criou; lê-las é `carregarTarefas`, cada grupo no
// tenant do seu dono.

import { withTenant } from "./db";
import { TAREFA_SELECT, type Tarefa } from "./queries";
import type { AtividadeItem, Quadro } from "./quadros";
import { CANDIDATAS_LIMIT } from "./quadros";
import {
  carregarTarefas,
  colegasDe,
  comoDonoDoProjeto,
  donoDoProjeto,
  nomesDeUsuarios,
  tarefasParaMim,
} from "./equipe-compartilhado";

export type PessoaProjeto = { user_id: string; nome: string; e_dono: boolean };

export type ProjetoResumo = Quadro & {
  n_tarefas: number;
  pessoas: PessoaProjeto[];
  sou_dono: boolean;
};

type Par = { tarefa_id: string; dono_id: string; ordem: number | null };

async function pessoasDoProjeto(userId: string, quadroId: string): Promise<PessoaProjeto[]> {
  const r = await withTenant(userId, (c) =>
    c.query<PessoaProjeto>(
      `SELECT user_id::text AS user_id, nome, e_dono FROM equipe_pessoas_do_projeto($1)`,
      [quadroId],
    ),
  );
  return r.rows.sort((a, b) => (a.e_dono === b.e_dono ? a.nome.localeCompare(b.nome) : a.e_dono ? -1 : 1));
}

async function paresDoProjeto(userId: string, quadroId: string): Promise<Par[]> {
  const r = await withTenant(userId, (c) =>
    c.query<Par>(`SELECT tarefa_id, dono_id, ordem FROM equipe_tarefas_do_projeto($1)`, [quadroId]),
  );
  return r.rows;
}

/** Projetos de quem pede (os dele e os em que foi chamado), mais recentes primeiro. */
export async function listarProjetos(userId: string): Promise<ProjetoResumo[]> {
  const meus = await withTenant(userId, (c) =>
    c.query<{ quadro_id: string; dono_id: string }>(`SELECT quadro_id, dono_id FROM equipe_meus_projetos()`),
  );
  const porDono = new Map<string, string[]>();
  for (const p of meus.rows) porDono.set(p.dono_id, [...(porDono.get(p.dono_id) ?? []), p.quadro_id]);

  const quadros = (
    await Promise.all(
      [...porDono.entries()].map(([donoId, ids]) =>
        withTenant(donoId, async (c) => {
          const r = await c.query<Quadro & { n_tarefas: number }>(
            `SELECT q.*,
                    (SELECT COUNT(*)::int FROM quadro_tarefas WHERE quadro_id = q.id) AS n_tarefas
               FROM quadros q WHERE q.id = ANY($1::uuid[])`,
            [ids],
          );
          return r.rows;
        }),
      ),
    )
  ).flat();

  const comPessoas = await Promise.all(
    quadros.map(async (q) => ({
      ...q,
      pessoas: await pessoasDoProjeto(userId, q.id),
      sou_dono: q.user_id === userId,
    })),
  );
  return comPessoas.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

/** Atividade das tarefas do projeto, de todos os donos, com o nome de quem fez. */
async function atividadeDoProjeto(pares: Par[]): Promise<AtividadeItem[]> {
  const porDono = new Map<string, string[]>();
  for (const p of pares) porDono.set(p.dono_id, [...(porDono.get(p.dono_id) ?? []), p.tarefa_id]);
  const linhas = (
    await Promise.all(
      [...porDono.entries()].map(([donoId, ids]) =>
        withTenant(donoId, async (c) => {
          const r = await c.query<AtividadeItem & { ator_user_id: string | null; created_at: string }>(
            `SELECT te.id,
                    to_char(te.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
                    te.evento, te.payload, t.titulo AS tarefa_titulo, te.tarefa_id,
                    COALESCE(te.ator_user_id, t.user_id)::text AS ator_user_id,
                    NULL::text AS convidado_nome, NULL::uuid AS convidado_id
               FROM tarefa_eventos te
               LEFT JOIN tarefas t ON t.id = te.tarefa_id
              WHERE te.tarefa_id = ANY($1::uuid[])
              ORDER BY te.created_at DESC
              LIMIT 50`,
            [ids],
          );
          return r.rows;
        }),
      ),
    )
  ).flat();
  const nomes = await nomesDeUsuarios(linhas.map((l) => l.ator_user_id));
  return linhas
    .map(({ ator_user_id, ...l }) => ({ ...l, convidado_nome: (ator_user_id && nomes.get(ator_user_id)) || null }))
    .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))
    .slice(0, 50);
}

export type ProjetoCompleto = {
  quadro: Quadro;
  sou_dono: boolean;
  pessoas: PessoaProjeto[];
  tarefas: Tarefa[];
  atividade: AtividadeItem[];
};

/** O projeto inteiro como quem pede enxerga. null = não existe ou a pessoa não está nele. */
export async function projetoParaQuemVe(userId: string, quadroId: string): Promise<ProjetoCompleto | null> {
  const r = await comoDonoDoProjeto(userId, quadroId, async (c) => {
    const q = await c.query<Quadro>(`SELECT * FROM quadros WHERE id = $1`, [quadroId]);
    return q.rows[0] ?? null;
  });
  if (!r?.valor) return null;
  const pares = await paresDoProjeto(userId, quadroId);
  const ordem = new Map(pares.map((p) => [p.tarefa_id, p.ordem]));
  const [tarefas, pessoas, atividade] = await Promise.all([
    carregarTarefas(userId, pares, { donoNome: true }),
    pessoasDoProjeto(userId, quadroId),
    atividadeDoProjeto(pares),
  ]);
  const comOrdem = tarefas
    .map((t) => ({ ...t, quadro_ordem: ordem.get(t.id) ?? null }))
    .sort((a, b) => {
      const oa = a.quadro_ordem ?? Number.MAX_SAFE_INTEGER;
      const ob = b.quadro_ordem ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.created_at < b.created_at ? 1 : -1;
    });
  return { quadro: r.valor, sou_dono: r.donoId === userId, pessoas, tarefas: comOrdem, atividade };
}

/** Tarefas de quem pede que ainda não estão no projeto: as dele e as que colegas passaram pra ele. */
export async function candidatasDoProjeto(userId: string, quadroId: string, q?: string): Promise<Tarefa[] | null> {
  if (!(await donoDoProjeto(userId, quadroId))) return null;
  const like = q && q.trim() ? `%${q.trim()}%` : null;
  const minhas = await withTenant(userId, async (c) => {
    const r = await c.query<Tarefa>(
      `${TAREFA_SELECT}
        WHERE t.status IN ('aberta','em_andamento')
          AND NOT (t.id = ANY(ARRAY(SELECT tarefa_id FROM equipe_tarefas_do_projeto($1))))
          AND ($2::text IS NULL OR t.titulo ILIKE $2 OR t.descricao ILIKE $2 OR t.owner ILIKE $2)
        ORDER BY t.created_at DESC
        LIMIT ${CANDIDATAS_LIMIT}`,
      [quadroId, like],
    );
    return r.rows;
  });
  const noProjeto = new Set((await paresDoProjeto(userId, quadroId)).map((p) => p.tarefa_id));
  const alvo = like ? like.slice(1, -1).toLowerCase() : null;
  const recebidas = (await tarefasParaMim(userId)).filter(
    (t) =>
      (t.status === "aberta" || t.status === "em_andamento") &&
      !noProjeto.has(t.id) &&
      (!alvo || `${t.titulo} ${t.descricao ?? ""}`.toLowerCase().includes(alvo)),
  );
  return [...recebidas, ...minhas].slice(0, CANDIDATAS_LIMIT);
}

/** Põe tarefas no projeto. Só entram as que quem pede pode mexer (dele, passadas a ele ou já num projeto dele). */
export async function adicionarAoProjeto(
  userId: string,
  quadroId: string,
  tarefaIds: string[],
): Promise<{ adicionadas: number; duplicadas: number; recusadas: number } | null> {
  const donoId = await donoDoProjeto(userId, quadroId);
  if (!donoId) return null;
  const ids = [...new Set(tarefaIds)];
  const permitidas = await withTenant(userId, async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT x::text AS id FROM unnest($1::uuid[]) AS x
        WHERE EXISTS (SELECT 1 FROM equipe_acesso_tarefa(x))`,
      [ids],
    );
    return r.rows.map((x) => x.id);
  });
  const adicionadas = await withTenant(donoId, async (c) => {
    if (!permitidas.length) return 0;
    const r = await c.query(
      `INSERT INTO quadro_tarefas (quadro_id, tarefa_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (quadro_id, tarefa_id) DO NOTHING
       RETURNING tarefa_id`,
      [quadroId, permitidas],
    );
    if ((r.rowCount ?? 0) > 0) await c.query(`UPDATE quadros SET updated_at = now() WHERE id = $1`, [quadroId]);
    return r.rowCount ?? 0;
  });
  return {
    adicionadas,
    duplicadas: permitidas.length - adicionadas,
    recusadas: ids.length - permitidas.length,
  };
}

export async function tirarDoProjeto(userId: string, quadroId: string, tarefaId: string): Promise<boolean> {
  const r = await comoDonoDoProjeto(userId, quadroId, (c) =>
    c.query(`DELETE FROM quadro_tarefas WHERE quadro_id = $1 AND tarefa_id = $2`, [quadroId, tarefaId]),
  );
  return !!r;
}

export async function reordenarNoProjeto(userId: string, quadroId: string, ids: string[]): Promise<boolean> {
  const r = await comoDonoDoProjeto(userId, quadroId, (c) =>
    c.query(
      `UPDATE quadro_tarefas qt
          SET ordem = (u.idx - 1) * 10
         FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, idx)
        WHERE qt.quadro_id = $1 AND qt.tarefa_id = u.id`,
      [quadroId, ids],
    ),
  );
  return !!r;
}

/** Nome, descrição e visão: qualquer pessoa do projeto muda. */
export async function atualizarProjeto(
  userId: string,
  quadroId: string,
  mud: { nome?: string; descricao?: string | null; vista_padrao?: "lista" | "timeline" },
): Promise<Quadro | null> {
  const r = await comoDonoDoProjeto(userId, quadroId, async (c) => {
    const sets: string[] = [];
    const vals: unknown[] = [quadroId];
    if (mud.nome !== undefined && mud.nome.trim()) {
      vals.push(mud.nome.trim().slice(0, 120));
      sets.push(`nome = $${vals.length}`);
    }
    if (mud.descricao !== undefined) {
      vals.push(mud.descricao?.trim() || null);
      sets.push(`descricao = $${vals.length}`);
    }
    if (mud.vista_padrao !== undefined) {
      vals.push(mud.vista_padrao);
      sets.push(`vista_padrao = $${vals.length}`);
    }
    if (!sets.length) return null;
    const q = await c.query<Quadro>(
      `UPDATE quadros SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      vals,
    );
    return q.rows[0] ?? null;
  });
  return r?.valor ?? null;
}

/** Arquivar: só quem criou o projeto. */
export async function arquivarProjeto(userId: string, quadroId: string): Promise<"ok" | "nao_e_dono" | "nao_achou"> {
  const donoId = await donoDoProjeto(userId, quadroId);
  if (!donoId) return "nao_achou";
  if (donoId !== userId) return "nao_e_dono";
  await withTenant(userId, (c) => c.query(`UPDATE quadros SET archived_at = now() WHERE id = $1`, [quadroId]));
  return "ok";
}

/** Chama um colega pro projeto. Qualquer pessoa do projeto chama. */
export async function chamarPessoa(
  userId: string,
  quadroId: string,
  pessoaId: string,
): Promise<"ok" | "nao_achou" | "nao_e_colega"> {
  const colegas = await colegasDe(userId);
  if (!colegas.some((c) => c.id === pessoaId)) return "nao_e_colega";
  const r = await comoDonoDoProjeto(userId, quadroId, async (c, donoId) => {
    if (pessoaId === donoId) return;
    await c.query(
      `INSERT INTO quadro_membros (quadro_id, user_id, adicionado_por) VALUES ($1, $2, $3)
       ON CONFLICT (quadro_id, user_id) DO NOTHING`,
      [quadroId, pessoaId, userId],
    );
  });
  return r ? "ok" : "nao_achou";
}

/** Tira alguém do projeto: quem criou tira qualquer um; os outros só saem por conta própria. */
export async function tirarPessoa(
  userId: string,
  quadroId: string,
  pessoaId: string,
): Promise<"ok" | "nao_achou" | "nao_pode"> {
  const donoId = await donoDoProjeto(userId, quadroId);
  if (!donoId) return "nao_achou";
  if (pessoaId === donoId) return "nao_pode";
  if (userId !== donoId && pessoaId !== userId) return "nao_pode";
  await withTenant(donoId, (c) =>
    c.query(`DELETE FROM quadro_membros WHERE quadro_id = $1 AND user_id = $2`, [quadroId, pessoaId]),
  );
  return "ok";
}

export { pessoasDoProjeto };

/** Dono do projeto se quem pede está nele (para as rotas conferirem antes de ler). */
export const donoDoProjetoOuNulo = donoDoProjeto;

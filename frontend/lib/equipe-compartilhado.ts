// Equipe: acesso a tarefas e projetos que outra pessoa criou.
//
// Porta única, no mesmo desenho do link de convidado (lib/quadro-guest.ts): uma função
// SECURITY DEFINER do banco (db/equipe/008) diz SE quem pede pode mexer e QUEM é o dono;
// só então o app abre o tenant do dono e roda a operação ali. O RLS de tarefas continua
// fechado por dono — nada aqui afrouxa política.
//
// REGRA: dentro de `comoDonoDaTarefa`/`comoDonoDoProjeto`, toda query usa o client `c`
// recebido e mexe só na tarefa/projeto conferido.

import type { PoolClient } from "pg";
import { query, withTenant, withTenantLeituraEquipe } from "./db";
import { MARCA_DO_TEAMS } from "./ttars-auth";
import { isTeamMode } from "./team-mode";
import { getOwnerSlug, isOwner } from "./owner-slug";
import { TAREFA_SELECT, TAREFA_SELECT_CONVIDADO, type Tarefa } from "./queries";
import { type Colega, ordenarPendencias, paraQuemVe } from "./compartilhar";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Papel = "dono" | "responsavel" | "projeto" | "time" | "pessoa";
export type AcessoTarefa = { donoId: string; papel: Papel };

/** Quem pode mexer na tarefa e em nome de quem. Fora da equipe: sempre o próprio. */
export async function acessoTarefa(userId: string, tarefaId: string): Promise<AcessoTarefa | null> {
  if (!isTeamMode()) return { donoId: userId, papel: "dono" };
  if (!UUID_RE.test(tarefaId)) return null;
  const r = await withTenant(userId, (c) =>
    c.query<{ dono_id: string; papel: Papel }>(
      `SELECT dono_id, papel FROM equipe_acesso_tarefa($1)`,
      [tarefaId],
    ),
  );
  const row = r.rows[0];
  return row ? { donoId: row.dono_id, papel: row.papel } : null;
}

/** Roda `fn` no tenant do dono da tarefa, depois de conferir que `userId` pode mexer nela. */
export async function comoDonoDaTarefa<T>(
  userId: string,
  tarefaId: string,
  fn: (c: PoolClient, acesso: AcessoTarefa) => Promise<T>,
): Promise<{ acesso: AcessoTarefa; valor: T } | null> {
  const acesso = await acessoTarefa(userId, tarefaId);
  if (!acesso) return null;
  const valor = await withTenant(acesso.donoId, (c) => fn(c, acesso));
  return { acesso, valor };
}

/** Dono do projeto, se `userId` está nele (dono ou chamado). */
export async function donoDoProjeto(userId: string, quadroId: string): Promise<string | null> {
  if (!isTeamMode()) return userId;
  if (!UUID_RE.test(quadroId)) return null;
  const r = await withTenant(userId, (c) =>
    c.query<{ dono: string | null }>(`SELECT equipe_projeto_dono($1) AS dono`, [quadroId]),
  );
  return r.rows[0]?.dono ?? null;
}

export async function comoDonoDoProjeto<T>(
  userId: string,
  quadroId: string,
  fn: (c: PoolClient, donoId: string) => Promise<T>,
): Promise<{ donoId: string; valor: T } | null> {
  const donoId = await donoDoProjeto(userId, quadroId);
  if (!donoId) return null;
  const valor = await withTenant(donoId, (c) => fn(c, donoId));
  return { donoId, valor };
}

/**
 * Pessoas da equipe que podem receber tarefa: a própria, as liberadas e as pessoas do TTARS
 * que já têm conta aqui (criada quando alguém passou uma tarefa pra elas).
 */
export async function colegasDe(userId: string): Promise<Colega[]> {
  // Quem só está no Teams pode receber ação (continua na lista), marcado para o nome digitado
  // preferir quem tem TTARS.
  return query<Colega>(
    `SELECT u.id::text AS id, u.nome,
            (NOT EXISTS (SELECT 1 FROM acessos_equipe a WHERE a.email = u.email AND a.liberado)
             AND EXISTS (SELECT 1 FROM ttars_pessoas p WHERE p.email = LOWER(u.email) AND LEFT(p.organizacao, $2) = $3)) AS so_no_teams
       FROM users u
      WHERE u.deleted_at IS NULL
        AND (u.id = $1
             OR EXISTS (SELECT 1 FROM acessos_equipe a WHERE a.email = u.email AND a.liberado)
             OR EXISTS (SELECT 1 FROM ttars_pessoas p WHERE p.email = LOWER(u.email) AND p.organizacao <> ''))
      ORDER BY u.nome`,
    [userId, MARCA_DO_TEAMS.length, MARCA_DO_TEAMS],
  );
}

/** Pessoa do TTARS (da Welcome) que pode receber tarefa, com a conta aqui se já existe. */
export type PessoaDaEquipe = {
  id: string | null;
  email: string;
  nome: string;
  organizacao: string;
  times: { id: string; nome: string; organizacao?: string | null }[];
  /** Liberada no Ações: vê o que recebe. Sem isso, a tarefa espera até ela ser liberada. */
  usa_acoes: boolean;
  /** Da Welcome, está no Teams e ainda não tem TTARS (recebe ação, não entra no Ações). */
  so_no_teams: boolean;
};

/** As pessoas do TTARS (fora "Parceiros"), da lista que o admin atualiza ao entrar. */
export async function pessoasDaEquipe(): Promise<PessoaDaEquipe[]> {
  return query<PessoaDaEquipe>(
    `SELECT u.id::text AS id, p.email, p.nome,
            CASE WHEN LEFT(p.organizacao, $1) = $2 THEN SUBSTRING(p.organizacao FROM $1 + 1) ELSE p.organizacao END AS organizacao,
            COALESCE(p.times, '[]'::jsonb) AS times,
            (EXISTS (SELECT 1 FROM acessos_equipe a WHERE a.email = p.email AND a.liberado)
             OR COALESCE(u.is_admin, false)) AS usa_acoes,
            LEFT(p.organizacao, $1) = $2 AS so_no_teams
       FROM ttars_pessoas p
       LEFT JOIN users u ON LOWER(u.email) = p.email AND u.deleted_at IS NULL
      WHERE p.organizacao <> ''
      ORDER BY p.nome`,
    [MARCA_DO_TEAMS.length, MARCA_DO_TEAMS],
  );
}

/**
 * Conta aqui de uma pessoa do TTARS, criada na hora se ela nunca entrou. Assim a tarefa pode
 * ser passada pra qualquer pessoa da Welcome; ela vê quando for liberada no Ações.
 */
export async function garantirColegaDoTtars(email: string): Promise<Colega | null> {
  const alvo = email.trim().toLowerCase();
  if (!alvo) return null;
  const r = await query<Colega>(
    `WITH p AS (SELECT email, nome, times FROM ttars_pessoas WHERE email = $1 AND organizacao <> '')
     INSERT INTO users (nome, email, times, is_admin, consent_terms_at)
     SELECT nome, email, COALESCE(times, '[]'::jsonb), false, NULL FROM p
     ON CONFLICT (email) WHERE email IS NOT NULL AND deleted_at IS NULL DO UPDATE SET nome = users.nome
     RETURNING id::text AS id, nome`,
    [alvo],
  );
  return r[0] ?? null;
}

export async function nomesDeUsuarios(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const r = await query<{ id: string; nome: string }>(
    `SELECT id::text AS id, nome FROM users WHERE id = ANY($1::uuid[])`,
    [unicos],
  );
  return new Map(r.map((x) => [x.id, x.nome]));
}

type Par = { tarefa_id: string; dono_id: string };

/** Carrega tarefas de vários donos, cada grupo no tenant do seu dono, já do ponto de vista de quem vê. */
export async function carregarTarefas(
  viewerId: string,
  pares: Par[],
  opts: { donoNome?: boolean } = {},
): Promise<Tarefa[]> {
  const porDono = new Map<string, string[]>();
  for (const p of pares) {
    const l = porDono.get(p.dono_id) ?? [];
    l.push(p.tarefa_id);
    porDono.set(p.dono_id, l);
  }
  const grupos = await Promise.all(
    [...porDono.entries()].map(([donoId, ids]) =>
      withTenant(donoId, async (c) => {
        // Quem não criou não recebe o que cita a reunião (mencoes/parece_com) — e o resto
        // da reunião é limpo em paraQuemVe.
        const sel = donoId === viewerId ? TAREFA_SELECT : TAREFA_SELECT_CONVIDADO;
        const r = await c.query<Tarefa>(`${sel} WHERE t.id = ANY($1::uuid[])`, [ids]);
        return r.rows;
      }),
    ),
  );
  const tarefas = grupos.flat();
  const [nomes, veReuniao] = await Promise.all([
    nomesDeUsuarios([viewerId, ...tarefas.map((t) => t.user_id), ...tarefas.map((t) => t.responsavel_user_id)]),
    reunioesQueAbre(viewerId, tarefas.filter((t) => t.user_id !== viewerId && t.meeting_id).map((t) => t.meeting_id!)),
  ]);
  const slug = getOwnerSlug();
  return tarefas.map((t) =>
    paraQuemVe(t, { viewerId, slug, nomes, donoNome: opts.donoNome, veReuniao: !!t.meeting_id && veReuniao.has(t.meeting_id) }),
  );
}

/** As reuniões (dentre `ids`) que quem vê consegue abrir, pela mesma regra de quem vê do banco. */
async function reunioesQueAbre(viewerId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await withTenantLeituraEquipe(viewerId, (c) =>
    c.query<{ id: string }>(`SELECT id::text AS id FROM meetings WHERE id = ANY($1::uuid[])`, [[...new Set(ids)]]),
  );
  return new Set(r.rows.map((x) => x.id));
}

/** Tarefas que colegas passaram para `userId` (as dele não entram). */
export async function tarefasParaMim(userId: string): Promise<Tarefa[]> {
  if (!isTeamMode()) return [];
  const r = await withTenant(userId, (c) =>
    c.query<Par>(`SELECT tarefa_id, dono_id FROM equipe_tarefas_para_mim()`),
  );
  if (!r.rows.length) return [];
  const lista = await carregarTarefas(userId, r.rows);
  return lista.sort(ordenarPendencias);
}

/** Tarefas que colegas marcaram para `userId` ver (as passadas a ele já vêm em tarefasParaMim). */
export async function tarefasMarcadasParaMim(userId: string): Promise<Tarefa[]> {
  if (!isTeamMode()) return [];
  const r = await withTenant(userId, (c) =>
    c.query<Par>(`SELECT tarefa_id, dono_id FROM equipe_tarefas_marcadas_para_mim()`),
  );
  if (!r.rows.length) return [];
  const lista = await carregarTarefas(userId, r.rows);
  return lista.map((t) => ({ ...t, marcada_para_mim: true })).sort(ordenarPendencias);
}

/** Em quais projetos (de quem vê) cada tarefa está. */
export async function projetosDasTarefas(
  userId: string,
  ids: string[],
): Promise<Map<string, { id: string; nome: string }[]>> {
  const mapa = new Map<string, { id: string; nome: string }[]>();
  if (!isTeamMode() || !ids.length) return mapa;
  const r = await withTenant(userId, (c) =>
    c.query<{ tarefa_id: string; quadro_id: string; nome: string }>(
      `SELECT tarefa_id, quadro_id, nome FROM equipe_projetos_das_tarefas($1::uuid[])`,
      [ids],
    ),
  );
  for (const x of r.rows) {
    const l = mapa.get(x.tarefa_id) ?? [];
    l.push({ id: x.quadro_id, nome: x.nome });
    mapa.set(x.tarefa_id, l);
  }
  return mapa;
}

/** Devolve as tarefas com `projetos` preenchido (equipe). Fora da equipe, iguais. */
export async function comProjetos<T extends Tarefa>(userId: string, tarefas: T[]): Promise<T[]> {
  if (!isTeamMode() || !tarefas.length) return tarefas;
  const mapa = await projetosDasTarefas(userId, tarefas.map((t) => t.id));
  return tarefas.map((t) => ({ ...t, projetos: mapa.get(t.id) ?? [] }));
}

/** Evento de tarefa com quem fez (quando quem fez não é o dono). */
/**
 * Depois de trocar quem faz a tarefa: a pessoa principal (a que agrupa "por pessoa") passa a
 * ser a do dono novo. Espelha a trigger resolve_tarefa_pessoas:
 *   executar        → ninguém é principal (agrupa em "Você")
 *   cobrar/aguardar → principal = a pessoa do owner (cria/vincula se preciso)
 */
export async function ajustarPrincipal(
  c: PoolClient,
  tarefaId: string,
  donoId: string,
  acao: string,
  owner: string,
) {
  if (acao === "executar") {
    await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1 AND principal", [tarefaId]);
    return;
  }
  await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1", [tarefaId]);
  if (!owner || owner === "?" || isOwner(owner)) return;
  const found = await c.query<{ pessoa_id: string }>(
    `SELECT tp.pessoa_id FROM tarefa_pessoas tp
       JOIN pessoas p ON p.id = tp.pessoa_id
      WHERE tp.tarefa_id = $1 AND app_slugify(p.nome) = app_slugify($2) LIMIT 1`,
    [tarefaId, owner],
  );
  let pessoaId = found.rows[0]?.pessoa_id;
  if (!pessoaId) {
    const pr = await c.query<{ id: string }>(
      `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
       ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
      [donoId, owner],
    );
    pessoaId = pr.rows[0].id;
  }
  await c.query(
    `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,true)
     ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
    [tarefaId, pessoaId],
  );
}

export async function registrarEvento(
  c: PoolClient,
  tarefaId: string,
  evento: string,
  payload: unknown,
  atorId: string | null,
) {
  if (isTeamMode()) {
    await c.query(
      "INSERT INTO tarefa_eventos (tarefa_id, evento, payload, ator_user_id) VALUES ($1,$2,$3,$4)",
      [tarefaId, evento, JSON.stringify(payload), atorId],
    );
  } else {
    await c.query("INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,$2,$3)", [
      tarefaId,
      evento,
      JSON.stringify(payload),
    ]);
  }
}

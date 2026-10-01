// Hub do Ações da equipe (28/09/2026): times, objetivos e listas salvas.
//
// Mesmo desenho do resto da equipe (lib/equipe-compartilhado.ts): quem pode ver o quê é
// decidido pelas funções SECURITY DEFINER de db/equipe/011 (lidas no tenant de quem pede);
// escrever em coisa de outra pessoa é no tenant do dono, depois de conferir.

import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { carregarTarefas, pessoasDaEquipe, type PessoaDaEquipe } from "./equipe-compartilhado";
import type { Tarefa } from "./queries";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function timeIdValido(v: unknown): v is string {
  return typeof v === "string" && TIME_RE.test(v);
}

/** Por onde a reunião de onde a ação veio foi gravada, no nome que a tela usa. */
export function origemDaReuniao(source: string | null | undefined): "teams" | "computador" | "celular" | null {
  if (!source) return null;
  if (source === "teams") return "teams";
  if (source === "ios-app" || source === "iphone") return "celular";
  if (source === "macbook" || source === "segmented") return "computador";
  return null;
}

// ─── Times ────────────────────────────────────────────────────────────

export type TimeNoTtars = { id: string; nome: string; organizacao: string | null };

/** Todos os times que aparecem nas pessoas do TTARS (id → nome e organização). */
export function timesDasPessoas(pessoas: PessoaDaEquipe[]): Map<string, TimeNoTtars> {
  const mapa = new Map<string, TimeNoTtars>();
  for (const p of pessoas) {
    for (const t of Array.isArray(p.times) ? p.times : []) {
      if (!t?.id || !timeIdValido(t.id) || mapa.has(t.id)) continue;
      mapa.set(t.id, { id: t.id, nome: t.nome || "Time", organizacao: t.organizacao || p.organizacao || null });
    }
  }
  return mapa;
}

export async function nomesDosTimes(): Promise<Map<string, string>> {
  const m = timesDasPessoas(await pessoasDaEquipe());
  return new Map([...m.values()].map((t) => [t.id, t.nome]));
}

export async function podeTime(userId: string, timeId: string): Promise<boolean> {
  if (!timeIdValido(timeId)) return false;
  const r = await withTenant(userId, (c) => c.query<{ ok: boolean }>(`SELECT equipe_pode_time($1) AS ok`, [timeId]));
  return !!r.rows[0]?.ok;
}

async function meusTimesESouAdmin(userId: string): Promise<{ meus: Set<string>; admin: boolean }> {
  const r = await withTenant(userId, (c) =>
    c.query<{ meus: string[]; admin: boolean }>(`SELECT equipe_meus_times() AS meus, equipe_sou_admin() AS admin`),
  );
  return { meus: new Set(r.rows[0]?.meus ?? []), admin: !!r.rows[0]?.admin };
}

export type TimeDoAcoes = TimeNoTtars & { sou_membro: boolean; abertas: number; pessoas: PessoaDaEquipe[] };

/** Os times que quem pede vê: os dele (e todos, se for administrador), com as pessoas e as ações abertas. */
export async function timesVisiveis(userId: string): Promise<TimeDoAcoes[]> {
  const [pessoas, { meus, admin }] = await Promise.all([pessoasDaEquipe(), meusTimesESouAdmin(userId)]);
  const todos = timesDasPessoas(pessoas);
  const visiveis = [...todos.values()].filter((t) => admin || meus.has(t.id));
  if (!visiveis.length) return [];
  const abertas = await withTenant(userId, (c) =>
    c.query<{ time_id: string; abertas: number }>(`SELECT time_id, abertas FROM equipe_resumo_times($1::text[])`, [
      visiveis.map((t) => t.id),
    ]),
  );
  const porTime = new Map(abertas.rows.map((x) => [x.time_id, x.abertas]));
  return visiveis
    .map((t) => ({
      ...t,
      sou_membro: meus.has(t.id),
      abertas: porTime.get(t.id) ?? 0,
      pessoas: pessoas.filter((p) => (p.times ?? []).some((x) => x?.id === t.id)),
    }))
    .sort((a, b) => Number(b.sou_membro) - Number(a.sou_membro) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Ações do time (de qualquer dono), do ponto de vista de quem vê. [] se não pode ver o time. */
export async function tarefasDoTime(userId: string, timeId: string): Promise<Tarefa[]> {
  const pares = await withTenant(userId, (c) =>
    c.query<{ tarefa_id: string; dono_id: string }>(`SELECT tarefa_id, dono_id FROM equipe_tarefas_do_time($1)`, [timeId]),
  );
  return pares.rows.length ? carregarTarefas(userId, pares.rows, { donoNome: true }) : [];
}

// ─── Resumos ──────────────────────────────────────────────────────────

export type ResumoDoProjeto = { abertas: number; feitas: number; vencidas: number; proximo_prazo: string | null };

export async function resumoDosProjetos(userId: string, ids: string[]): Promise<Map<string, ResumoDoProjeto>> {
  if (!ids.length) return new Map();
  const r = await withTenant(userId, (c) =>
    c.query<{ quadro_id: string; abertas: number; feitas: number; vencidas: number; proximo_prazo: string | null }>(
      `SELECT quadro_id, abertas, feitas, vencidas,
              to_char(proximo_prazo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS proximo_prazo
         FROM equipe_resumo_projetos($1::uuid[])`,
      [ids],
    ),
  );
  return new Map(r.rows.map((x) => [x.quadro_id, { abertas: x.abertas, feitas: x.feitas, vencidas: x.vencidas, proximo_prazo: x.proximo_prazo }]));
}

// ─── Objetivos ────────────────────────────────────────────────────────

export type Visibilidade = "so_eu" | "time" | "todos";
export const VISIBILIDADES: Visibilidade[] = ["so_eu", "time", "todos"];

export type ObjetivoResumo = {
  id: string;
  nome: string;
  como_medir: string | null;
  prazo: string | null;
  visibilidade: Visibilidade;
  time_id: string | null;
  time_nome: string | null;
  sou_dono: boolean;
  /** Muda nome, prazo e como medir: quem criou; no objetivo do time, também o time. */
  pode_editar: boolean;
  criador_nome: string | null;
  total: number;
  feitas: number;
  vencidas: number;
  n_projetos: number;
};

type LinhaObjetivo = {
  id: string;
  user_id: string;
  nome: string;
  como_medir: string | null;
  prazo: string | null;
  visibilidade: Visibilidade;
  time_id: string | null;
};

/** Os objetivos que quem pede vê, com os números (sobre as mesmas ações que a tela mostra). */
export async function objetivosVisiveis(userId: string, soEste?: string): Promise<ObjetivoResumo[]> {
  const linhas = await withTenant(userId, async (c) => {
    const r = await c.query<LinhaObjetivo & { total: number; feitas: number; vencidas: number; n_projetos: number; criador_nome: string | null }>(
      `SELECT o.id::text, o.user_id::text, o.nome, o.como_medir, to_char(o.prazo, 'YYYY-MM-DD') AS prazo,
              o.visibilidade, o.time_id,
              COALESCE(s.total, 0) AS total, COALESCE(s.feitas, 0) AS feitas, COALESCE(s.vencidas, 0) AS vencidas,
              COALESCE(s.n_projetos, 0) AS n_projetos, u.nome AS criador_nome
         FROM equipe_objetivos_visiveis() o
         LEFT JOIN LATERAL equipe_resumo_objetivos(ARRAY[o.id]) s ON true
         LEFT JOIN users u ON u.id = o.user_id
        WHERE ($1::uuid IS NULL OR o.id = $1::uuid)
        ORDER BY o.prazo ASC NULLS LAST, o.nome`,
      [soEste ?? null],
    );
    return r.rows;
  });
  const times = linhas.some((l) => l.time_id) ? await nomesDosTimes() : new Map<string, string>();
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    como_medir: l.como_medir,
    prazo: l.prazo,
    visibilidade: l.visibilidade,
    time_id: l.time_id,
    time_nome: l.time_id ? (times.get(l.time_id) ?? null) : null,
    sou_dono: l.user_id === userId,
    pode_editar: l.user_id === userId || l.visibilidade === "time",
    criador_nome: l.criador_nome,
    total: l.total,
    feitas: l.feitas,
    vencidas: l.vencidas,
    n_projetos: l.n_projetos,
  }));
}

export async function podeObjetivo(userId: string, objetivoId: string): Promise<boolean> {
  if (!UUID_RE.test(objetivoId)) return false;
  const r = await withTenant(userId, (c) => c.query<{ ok: boolean }>(`SELECT equipe_pode_objetivo($1) AS ok`, [objetivoId]));
  return !!r.rows[0]?.ok;
}

/** Sem o id de um objetivo que quem vê não enxerga (o nome já não sai). */
export async function semObjetivoEscondido<T extends { objetivo_id?: string | null }>(userId: string, t: T): Promise<T> {
  return t.objetivo_id && !(await podeObjetivo(userId, t.objetivo_id)) ? { ...t, objetivo_id: null } : t;
}

/** Roda `fn` no tenant de quem criou o objetivo, depois de conferir que `userId` o vê. */
export async function comoDonoDoObjetivo<T>(
  userId: string,
  objetivoId: string,
  fn: (c: PoolClient, donoId: string) => Promise<T>,
): Promise<{ donoId: string; valor: T } | null> {
  if (!UUID_RE.test(objetivoId)) return null;
  const r = await withTenant(userId, (c) => c.query<{ dono: string | null }>(`SELECT equipe_objetivo_dono($1)::text AS dono`, [objetivoId]));
  const donoId = r.rows[0]?.dono;
  if (!donoId) return null;
  return { donoId, valor: await withTenant(donoId, (c) => fn(c, donoId)) };
}

export async function tarefasDoObjetivo(userId: string, objetivoId: string): Promise<Tarefa[]> {
  const pares = await withTenant(userId, (c) =>
    c.query<{ tarefa_id: string; dono_id: string }>(`SELECT tarefa_id, dono_id FROM equipe_tarefas_do_objetivo($1)`, [objetivoId]),
  );
  return pares.rows.length ? carregarTarefas(userId, pares.rows, { donoNome: true }) : [];
}

/** Nome dos objetivos (só os que quem pede vê) — o selo "objetivo" de cada ação. */
export async function nomesDosObjetivos(userId: string, ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x) => UUID_RE.test(x)))];
  if (!unicos.length) return new Map();
  const r = await withTenant(userId, (c) =>
    c.query<{ id: string; nome: string }>(`SELECT id::text, nome FROM equipe_objetivos_nomes($1::uuid[])`, [unicos]),
  );
  return new Map(r.rows.map((x) => [x.id, x.nome]));
}

// ─── Listas salvas ────────────────────────────────────────────────────

export type ListaSalva = {
  id: string;
  nome: string;
  onde: string;
  filtro: Record<string, unknown>;
  ordem: string | null;
  vista: string | null;
};

export const ONDE_RE = /^(minhas|pedidos|(time|projeto|objetivo):[A-Za-z0-9_-]{1,80})$/;
export const ORDENS = ["prazo", "criada", "pessoa", "pediu", "prioridade", "projeto", "objetivo", "time", "reuniao", "situacao", "titulo"];
export const VISTAS = ["lista", "quadro", "tabela"];

export async function listasDe(userId: string): Promise<ListaSalva[]> {
  const r = await withTenant(userId, (c) =>
    c.query<ListaSalva>(`SELECT id::text, nome, onde, filtro, ordem, vista FROM acoes_listas ORDER BY created_at`),
  );
  return r.rows;
}

// Central do Marketing (01/10/2026, pedido do Vitor: "um hub para as meninas do marketing… é lá que
// pedidos pro marketing devem aparecer"): os pedidos que chegaram ao marketing, para quem é do marketing
// ou administrador (pedido_posso_mexer). Cada pedido vem como as outras listas do TTARS mostram.
import { query, withTenant } from "./db";
import { carregarTarefas } from "./equipe-compartilhado";
import { lerFonte, paginasEditadas } from "./notion-api";
import { etapaEmPortugues, lerPagina, PROPS } from "./notion-mapa";
import { conexaoAtiva } from "./notion-sync";
import { paraTela } from "./ttars-tela";

const QUANTOS = 300;

export async function souDoMarketing(userId: string): Promise<boolean> {
  const r = await withTenant(userId, (c) =>
    c.query<{ ok: boolean }>(`SELECT pedido_posso_mexer() AS ok`),
  );
  return r.rows[0]?.ok === true;
}

/** Os pedidos mais novos primeiro, os cancelados por último (o dono de cada ação é quem pediu). */
export async function pedidosDaCentral(userId: string) {
  const linhas = await query<{ tarefa_id: string; dono_id: string }>(
    `SELECT tarefa_id::text AS tarefa_id, pedido_por::text AS dono_id
       FROM tarefa_pedidos
      ORDER BY cancelado, criado_em DESC
      LIMIT ${QUANTOS}`,
  );
  if (!linhas.length) return [];
  const ordem = new Map(linhas.map((l, i) => [l.tarefa_id, i]));
  const tarefas = await carregarTarefas(userId, linhas, { donoNome: true });
  tarefas.sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
  return paraTela(userId, tarefas);
}

// ── As tarefas do marketing como no Notion (Hub do Marketing, 01/10/2026) ───────────────────────
// Vitor: "a página inicial das tarefas de mkt deve copiar o Notion, tanto nas tarefas quanto nos
// controles". As tarefas são as do Ações que espelham o Notion (os projetos do marketing e o "sem
// projeto"); de cada uma vai também o que está lá AGORA, cru: a situação com o nome e a cor de lá,
// prioridade vazia (o Ações guarda vazia como Média), Person e Assign, o período do prazo e a área.

type OpcaoDoNotion = { nome: string; cor: string; grupo?: string | null };
export type EsquemaDoNotion = { situacoes: OpcaoDoNotion[]; areas: OpcaoDoNotion[]; prioridades: OpcaoDoNotion[] };
export type NoNotionAgora = {
  page_id: string;
  url: string | null;
  situacao: string;
  prioridade: string | null;
  area: string | null;
  assign: string[];
  person: string[];
  inicio: string | null;
  fim: string | null;
  projetos: string[];
};
type Leitura = { em: number; esquema: EsquemaDoNotion; porPagina: Map<string, NoNotionAgora> };

let lido: Leitura | null = null;
let lendo: Promise<Leitura | null> | null = null;

type PropDoEsquema = {
  status?: { options?: { id: string; name: string; color: string }[]; groups?: { name: string; option_ids?: string[] }[] };
  select?: { options?: { name: string; color: string }[] };
};

/** O Notion agora: lido de novo no máximo a cada minuto (o limite de lá é ~3 pedidos por segundo). */
async function notionAgora(): Promise<Leitura | null> {
  if (lido && Date.now() - lido.em < 60_000) return lido;
  lendo ??= (async () => {
    const c = await conexaoAtiva();
    if (!c) return null;
    const [fonte, paginas] = await Promise.all([lerFonte(c.token, c.data_source_id), paginasEditadas(c.token, c.data_source_id, null)]);
    const props = fonte.properties as Record<string, PropDoEsquema>;
    const status = props[PROPS.status]?.status;
    const opcoes = (p: PropDoEsquema | undefined) => (p?.select?.options ?? []).map((o) => ({ nome: o.name, cor: o.color }));
    const esquema: EsquemaDoNotion = {
      situacoes: (status?.options ?? []).map((o) => ({
        nome: o.name,
        cor: o.color,
        grupo: status?.groups?.find((g) => g.option_ids?.includes(o.id))?.name ?? null,
      })),
      areas: opcoes(props[PROPS.bu]),
      prioridades: opcoes(props[PROPS.prioridade]),
    };
    const porPagina = new Map<string, NoNotionAgora>();
    for (const pg of paginas) {
      if (pg.in_trash || pg.archived) continue;
      const l = lerPagina(pg);
      const nome = (id: string) => l.pessoas.find((p) => p.id === id)?.nome ?? "";
      const data = (pg.properties[PROPS.prazo] as { date?: { start?: string | null; end?: string | null } | null } | undefined)?.date;
      porPagina.set(pg.id, {
        page_id: pg.id,
        url: l.url,
        situacao: l.statusNotion,
        prioridade: (pg.properties[PROPS.prioridade] as { select?: { name?: string } | null } | undefined)?.select?.name ?? null,
        area: l.bu,
        assign: l.listaAssign.map(nome).filter(Boolean),
        person: l.listaPerson.map(nome).filter(Boolean),
        inicio: data?.start ?? null,
        fim: data?.end ?? null,
        projetos: l.projetos,
      });
    }
    lido = { em: Date.now(), esquema, porPagina };
    return lido;
  })().finally(() => {
    lendo = null;
  });
  return lendo;
}

/**
 * GET /api/ttars/marketing/tarefas — todas as tarefas do marketing (só marketing e administrador; a rota
 * confere), lidas como o dono dos projetos do marketing, cada uma com o que está no Notion agora.
 * Notion fora do ar: as tarefas vêm do mesmo jeito, sem a leitura de lá (`notion_ok: false`).
 */
export async function tarefasDoMarketing(userId: string) {
  const c = await conexaoAtiva();
  if (!c) return { ligado: false as const };
  const projetos = await query<{ page_id: string; quadro_id: string | null; nome: string; etapa: string | null; inicio: string | null; fim: string | null; url: string | null; lider: string | null }>(
    `SELECT np.page_id, np.quadro_id::text AS quadro_id, np.nome, np.etapa, to_char(np.inicio, 'YYYY-MM-DD') AS inicio,
            to_char(np.fim, 'YYYY-MM-DD') AS fim, np.url,
            (SELECT p.nome FROM notion_pessoas p WHERE p.conexao_id = np.conexao_id AND p.notion_user_id = np.lider) AS lider
       FROM notion_projetos np WHERE np.conexao_id = $1 AND NOT np.no_lixo ORDER BY np.nome`,
    [c.id],
  );
  const quadros = [c.quadro_id, ...projetos.map((p) => p.quadro_id)].filter((x): x is string => !!x);
  const [noQuadro, links, agora] = await Promise.all([
    withTenant(c.dono_user_id, (db) =>
      db.query<{ tarefa_id: string; dono_id: string; quadro_id: string }>(
        `SELECT t.tarefa_id::text AS tarefa_id, t.dono_id::text AS dono_id, q.id::text AS quadro_id
           FROM unnest($1::uuid[]) AS q(id) CROSS JOIN LATERAL equipe_tarefas_do_projeto(q.id) AS t`,
        [quadros],
      ),
    ),
    query<{ tarefa_id: string; dono_id: string; page_id: string }>(
      `SELECT tarefa_id::text AS tarefa_id, tarefa_dono_id::text AS dono_id, page_id FROM notion_paginas WHERE conexao_id = $1`,
      [c.id],
    ),
    notionAgora().catch(() => null),
  ]);
  const pares = new Map<string, { tarefa_id: string; dono_id: string }>();
  for (const x of [...noQuadro.rows, ...links]) if (!pares.has(x.tarefa_id)) pares.set(x.tarefa_id, { tarefa_id: x.tarefa_id, dono_id: x.dono_id });
  const quadrosDa = new Map<string, string[]>();
  for (const x of noQuadro.rows) quadrosDa.set(x.tarefa_id, [...(quadrosDa.get(x.tarefa_id) ?? []), x.quadro_id]);
  const paginaDa = new Map(links.map((l) => [l.tarefa_id, l.page_id]));
  const tarefas = await paraTela(userId, await carregarTarefas(userId, [...pares.values()], { donoNome: true }));
  const nomeDoQuadro = new Map<string, string>(projetos.filter((p) => p.quadro_id).map((p) => [p.quadro_id!, p.nome]));
  return {
    ligado: true as const,
    notion_ok: !!agora,
    url_da_base: `https://www.notion.so/${c.database_id.replace(/-/g, "")}`,
    esquema: agora?.esquema ?? null,
    sem_projeto: c.quadro_id,
    projetos: projetos.map((p) => ({ ...p, etapa_pt: etapaEmPortugues(p.etapa) })),
    tarefas: tarefas.map((t) => {
      const pagina = paginaDa.get(t.id);
      return {
        ...t,
        // Os projetos do marketing em que a tarefa está (pelo Ações, vale também para quem não está neles).
        projetos_do_marketing: (quadrosDa.get(t.id) ?? []).filter((q) => q !== c.quadro_id).map((q) => ({ id: q, nome: nomeDoQuadro.get(q) ?? "Projeto" })),
        no_notion: pagina ? (agora?.porPagina.get(pagina) ?? null) : null,
      };
    }),
  };
}

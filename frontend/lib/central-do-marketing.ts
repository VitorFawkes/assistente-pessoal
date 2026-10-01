// Central do Marketing (01/10/2026, pedido do Vitor: "um hub para as meninas do marketing… é lá que
// pedidos pro marketing devem aparecer"): os pedidos que chegaram ao marketing, para quem é do marketing
// ou administrador (pedido_posso_mexer). Cada pedido vem como as outras listas do TTARS mostram.
import type { User } from "./auth";
import { query, withTenant } from "./db";
import { carregarTarefas } from "./equipe-compartilhado";
import { criarAcao, type Prioridade } from "./nova-acao";
import { lerFonte, paginasEditadas, ultimaEscritaNoNotion } from "./notion-api";
import { etapaEmPortugues, lerPagina, PROPS, statusDoNotion } from "./notion-mapa";
import { conexaoAtiva, mudadosNoAcoes, pedirEnvio } from "./notion-sync";
import { situacoesDoNotion } from "./notion-tela";
import { paraTela, tarefaNaTela } from "./ttars-tela";

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
  /** Quando o Notion foi lido: mudança feita aqui depois disso ainda não está nesta leitura. */
  lido_em: string;
};
type Leitura = { em: number; esquema: EsquemaDoNotion; porPagina: Map<string, NoNotionAgora> };

let lido: Leitura | null = null;
let lendo: Promise<Leitura | null> | null = null;

type PropDoEsquema = {
  status?: { options?: { id: string; name: string; color: string }[]; groups?: { name: string; option_ids?: string[] }[] };
  select?: { options?: { name: string; color: string }[] };
};

/**
 * O Notion agora: lido de novo no máximo a cada minuto (o limite de lá é ~3 pedidos por segundo), e logo
 * depois que o Ações gravou lá (situação, área, a rodada): a tela nunca mostra o que acabou de mudar.
 */
async function notionAgora(): Promise<Leitura | null> {
  if (lido && Date.now() - lido.em < 60_000 && ultimaEscritaNoNotion() < lido.em) return lido;
  lendo ??= (async () => {
    const c = await conexaoAtiva();
    if (!c) return null;
    const inicio = Date.now();
    const lidoEm = new Date(inicio).toISOString();
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
        lido_em: lidoEm,
      });
    }
    lido = { em: inicio, esquema, porPagina };
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
  const [noQuadro, links, agora, eu, comentarios, mudados] = await Promise.all([
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
    query<{ nome: string }>(`SELECT nome FROM notion_pessoas WHERE conexao_id = $1 AND user_id = $2 LIMIT 1`, [c.id, userId]),
    // Os comentários da página (os de lá e os feitos aqui que já foram), o número que o cartão de lá mostra.
    query<{ page_id: string; n: number }>(
      `SELECT page_id, count(*)::int AS n FROM notion_comentarios WHERE conexao_id = $1 AND comment_id NOT LIKE 'pendente:%' GROUP BY page_id`,
      [c.id],
    ).catch(() => []),
    // O que mudou aqui e a rodada ainda vai levar (a mesma conta dela): nesses campos a tela mostra o daqui.
    mudadosNoAcoes(c),
  ]);
  const comentariosDa = new Map(comentarios.map((x) => [x.page_id, x.n]));
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
    // Quem vê, como aparece nas colunas Person e Assign de lá (null = não está no Notion do marketing).
    eu_no_notion: eu[0]?.nome ?? null,
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
        comentarios_no_notion: pagina ? (comentariosDa.get(pagina) ?? 0) : 0,
        aqui_mudou: mudados.get(t.id) ?? [],
      };
    }),
  };
}

// As áreas (BU) da base; uma criada depois lá vale pela leitura de lá.
const AREAS_CONHECIDAS = ["Weddings", "Trips", "Corp", "Institucional"];
const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];

/**
 * POST /api/ttars/marketing/tarefas — "Nova tarefa" do Hub, com os campos escolhidos (sem a IA reler o
 * título), como o New do Notion: vai para um projeto do marketing (ou o "sem projeto") e de lá para o Notion,
 * na situação escolhida ("+ New task" da coluna), com quem faz em Person e Assign ("Eu" = quem cria) e
 * prioridade e área vazias quando ninguém escolheu.
 */
export async function novaTarefaDoMarketing(user: User, corpo: unknown) {
  const b = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const c = await conexaoAtiva();
  if (!c?.quadro_id) return { status: 409, json: { error: "O Notion do marketing não está ligado." } };
  const projeto = txt(b.projeto_id) ?? c.quadro_id;
  const doMarketing = await query<{ ok: boolean }>(
    `SELECT ($2::uuid = $3::uuid OR EXISTS (SELECT 1 FROM notion_projetos WHERE conexao_id = $1 AND quadro_id = $2::uuid AND NOT no_lixo)) AS ok`,
    [c.id, projeto, c.quadro_id],
  ).catch(() => [{ ok: false }]);
  if (!doMarketing[0]?.ok) return { status: 400, json: { error: "Escolha um projeto do marketing." } };
  const area = txt(b.area);
  const bu = area && (AREAS_CONHECIDAS.includes(area) || !!lido?.esquema.areas.some((a) => a.nome === area)) ? area : null;
  const prioridade = PRIORIDADES.includes(b.prioridade as Prioridade) ? (b.prioridade as Prioridade) : null;
  // Só uma situação que existe lá (com a grafia de lá; criada há pouco lá: lê de novo). Notion fora do ar: vale
  // a pedida (a página nasce quando ele voltar).
  const pedida = txt(b.situacao)?.slice(0, 60) ?? null;
  let situacao: string | null = null;
  if (pedida) {
    const achar = (nomes: string[]) => nomes.find((n) => n.toLowerCase() === pedida.toLowerCase()) ?? null;
    try {
      situacao = achar(await situacoesDoNotion()) ?? achar(await situacoesDoNotion(true));
    } catch {
      situacao = pedida;
    }
    if (!situacao) return { status: 400, json: { error: "Essa situação não existe no Notion do marketing." } };
  }
  // Sem projeto aqui: quem é do marketing cria mesmo sem ser membro do projeto (o projeto é do robô do Notion).
  const r = await criarAcao(user, {
    titulo: txt(b.titulo) ?? "",
    descricao: txt(b.descricao),
    quem_email: txt(b.quem_email),
    prazo: txt(b.prazo),
    prioridade: prioridade ?? "media",
    origem: "manual",
    semFila: true,
  });
  if (!r.ok) return { status: r.status, json: { error: r.erro } };
  const id = r.tarefa.id;
  // "+ New task" no pé de uma coluna: nasce nela (aqui, na situação do Ações que ela quer dizer; é a criação,
  // não um "reabriu" no histórico).
  const status = statusDoNotion(situacao);
  if (situacao && status !== "aberta") {
    await withTenant(user.id, (db) =>
      db.query(
        `UPDATE tarefas SET status = $2, situacao_desde = now(), concluida_em = CASE WHEN $2 = 'concluida' THEN now() END WHERE id = $1`,
        [id, status],
      ),
    );
  }
  // "Eu": no Notion vai quem cria (se está no Notion do marketing).
  const quem =
    r.notionUserId ??
    (await query<{ id: string }>(`SELECT notion_user_id AS id FROM notion_pessoas WHERE conexao_id = $1 AND user_id = $2 LIMIT 1`, [c.id, user.id]))[0]?.id ??
    null;
  // No projeto e na fila na mesma transação: a rodada do Notion nunca acha a tarefa no projeto sem as escolhas.
  await withTenant(c.dono_user_id, async (db) => {
    await db.query(`INSERT INTO quadro_tarefas (quadro_id, tarefa_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [projeto, id]);
    await pedirEnvio({ tarefaId: id, donoId: user.id, pedidoPor: user.id, notionUserId: quem, bu, doHub: { situacao, prioridade: !!prioridade, bu }, db: { client: db, conexaoId: c.id } });
  });
  const tarefa = (await tarefaNaTela(user.id, id))?.tarefa ?? r.tarefa;
  return { status: 201, json: { tarefa, aviso: r.aviso } };
}

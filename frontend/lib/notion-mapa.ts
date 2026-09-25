// Notion do marketing ↔ Ações (pedido do Vitor, 25/09/2026, bloco 4): regras puras de
// tradução entre uma página da base "Tasks" do Notion e uma ação. Sem I/O — testadas em
// notion-mapa.test.ts. O que chega e sai do Notion passa todo por aqui.

export type StatusAcoes = "aberta" | "em_andamento" | "aguardando_aprovacao" | "concluida" | "cancelada";
export type Prioridade = "baixa" | "media" | "alta" | "urgente";

/** Os campos que andam nos dois sentidos, já no formato de comparação. */
export type Campos = {
  titulo: string;
  descricao: string;
  /** Dia (AAAA-MM-DD) ou "" sem prazo. */
  prazo: string;
  /** Situação no Ações (Not started e Up next viram "aberta"). */
  status: StatusAcoes;
  prioridade: Prioridade;
  /** Id da pessoa no Notion ("" = ninguém). */
  pessoa: string;
};

export type PaginaLida = Campos & {
  pageId: string;
  url: string | null;
  /** O nome da situação no Notion, como a equipe vê lá (Not started, Up next…). */
  statusNotion: string;
  bu: string | null;
  noLixo: boolean;
  editadoEm: string;
  editadoPor: string | null;
  pessoas: { id: string; nome: string; email: string | null }[];
};

type Prop = { type?: string; [k: string]: unknown };
export type PaginaNotion = {
  id: string;
  url?: string;
  in_trash?: boolean;
  archived?: boolean;
  last_edited_time: string;
  last_edited_by?: { id?: string };
  properties: Record<string, Prop>;
};

/** Nomes das propriedades na base Tasks (conferidos no Notion dela em 25/09). */
export const PROPS = {
  titulo: "Name",
  status: "Status",
  prazo: "Due date",
  pessoa: "Person",
  pessoaReserva: "Assign",
  bu: "BU",
  descricao: "Description",
  prioridade: "Priority",
} as const;

const DE_NOTION: Record<string, StatusAcoes> = {
  "not started": "aberta",
  "up next": "aberta",
  "this week": "em_andamento",
  "in progress": "em_andamento",
  "in approval": "aguardando_aprovacao",
  done: "concluida",
};

export function statusDoNotion(nome: string | null | undefined): StatusAcoes {
  return DE_NOTION[(nome ?? "").trim().toLowerCase()] ?? "aberta";
}

/**
 * Situação do Ações → nome no Notion. "aberta" mantém o que a equipe tinha (Not started ou
 * Up next); cancelada não tem situação: a página vai pra lixeira (null aqui).
 */
export function statusParaNotion(s: StatusAcoes, anteriorNoNotion: string | null | undefined): string | null {
  if (s === "cancelada") return null;
  if (s === "aberta") {
    const a = (anteriorNoNotion ?? "").trim().toLowerCase();
    return a === "up next" ? "Up next" : "Not started";
  }
  if (s === "em_andamento") return "This Week";
  if (s === "aguardando_aprovacao") return "In Approval";
  return "Done";
}

const PRIO_DE_NOTION: Record<string, Prioridade> = { urgent: "urgente", high: "alta", medium: "media", low: "baixa" };
const PRIO_PARA_NOTION: Record<Prioridade, string | null> = { urgente: "Urgent", alta: "High", media: "Medium", baixa: null };

export const prioridadeDoNotion = (nome: string | null | undefined): Prioridade =>
  PRIO_DE_NOTION[(nome ?? "").trim().toLowerCase()] ?? "media";
export const prioridadeParaNotion = (p: Prioridade): string | null => PRIO_PARA_NOTION[p];

/** "Paula Klotz | Welcome Trips" → "Paula Klotz" (o Notion delas põe a empresa no nome). */
export function nomeLimpo(nome: string | null | undefined): string {
  return (nome ?? "").split("|")[0].trim();
}

function textoRico(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v.map((x: { plain_text?: string; text?: { content?: string } }) => x.plain_text ?? x.text?.content ?? "").join("").trim();
}

function pessoasDe(p: Prop | undefined): { id: string; nome: string; email: string | null }[] {
  const lista = (p?.people as { id: string; name?: string; person?: { email?: string } }[] | undefined) ?? [];
  return lista.filter((x) => x?.id).map((x) => ({ id: x.id, nome: nomeLimpo(x.name) || "Pessoa do Notion", email: x.person?.email?.toLowerCase() ?? null }));
}

/** O dia do prazo: o fim do intervalo quando é intervalo, senão o dia. */
export function diaDoNotion(p: Prop | undefined): string {
  const d = p?.date as { start?: string | null; end?: string | null } | null | undefined;
  const v = d?.end || d?.start || "";
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}

export function lerPagina(pg: PaginaNotion): PaginaLida {
  const pr = pg.properties || {};
  const pessoas = pessoasDe(pr[PROPS.pessoa]);
  const reserva = pessoasDe(pr[PROPS.pessoaReserva]);
  const todas = pessoas.length ? pessoas : reserva;
  const statusNotion = ((pr[PROPS.status]?.status as { name?: string } | null)?.name ?? "").trim();
  return {
    pageId: pg.id,
    url: pg.url ?? null,
    titulo: textoRico(pr[PROPS.titulo]?.title).trim() || "(sem título no Notion)",
    descricao: textoRico(pr[PROPS.descricao]?.rich_text),
    prazo: diaDoNotion(pr[PROPS.prazo]),
    status: statusDoNotion(statusNotion),
    statusNotion: statusNotion || "Not started",
    prioridade: prioridadeDoNotion((pr[PROPS.prioridade]?.select as { name?: string } | null)?.name),
    pessoa: todas[0]?.id ?? "",
    pessoas: [...pessoas, ...reserva.filter((r) => !pessoas.some((p) => p.id === r.id))],
    bu: ((pr[PROPS.bu]?.select as { name?: string } | null)?.name ?? null) || null,
    noLixo: !!(pg.in_trash || pg.archived),
    editadoEm: pg.last_edited_time,
    editadoPor: pg.last_edited_by?.id ?? null,
  };
}

/** Propriedades do Notion para gravar estes campos (só os pedidos). */
export function propriedadesPara(
  campos: Partial<Campos>,
  ctx: { statusAnterior?: string | null; bu?: string | null } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (campos.titulo !== undefined) out[PROPS.titulo] = { title: [{ text: { content: campos.titulo.slice(0, 2000) } }] };
  if (campos.descricao !== undefined)
    out[PROPS.descricao] = { rich_text: campos.descricao ? [{ text: { content: campos.descricao.slice(0, 2000) } }] : [] };
  if (campos.prazo !== undefined) out[PROPS.prazo] = { date: campos.prazo ? { start: campos.prazo } : null };
  if (campos.status !== undefined) {
    const nome = statusParaNotion(campos.status, ctx.statusAnterior);
    if (nome) out[PROPS.status] = { status: { name: nome } };
  }
  if (campos.prioridade !== undefined) {
    const nome = prioridadeParaNotion(campos.prioridade);
    out[PROPS.prioridade] = { select: nome ? { name: nome } : null };
  }
  if (campos.pessoa !== undefined) out[PROPS.pessoa] = { people: campos.pessoa ? [{ id: campos.pessoa }] : [] };
  if (ctx.bu) out[PROPS.bu] = { select: { name: ctx.bu } };
  return out;
}

export const CHAVES: (keyof Campos)[] = ["titulo", "descricao", "prazo", "status", "prioridade", "pessoa"];

function igual(a: unknown, b: unknown) {
  return String(a ?? "") === String(b ?? "");
}

export type Decisao = {
  /** Vai do Notion pra ação. */
  paraAcoes: Partial<Campos>;
  /** Vai da ação pro Notion. */
  paraNotion: Partial<Campos>;
  /** Mudou dos dois lados desde a última vez. */
  conflitos: (keyof Campos)[];
};

/**
 * Compara os dois lados com o que valia na última sincronização. Mudou só de um lado → vai
 * pro outro. Mudou dos dois → vale o mais recente (empate: o Notion, que é onde o marketing
 * trabalha). Sem "última vez" (acabou de ligar): o Notion vale.
 */
export function decidir(
  notion: Campos,
  acoes: Campos,
  ultimos: Partial<Campos> | null,
  quando: { notion: string; acoes: string },
): Decisao {
  const d: Decisao = { paraAcoes: {}, paraNotion: {}, conflitos: [] };
  for (const k of CHAVES) {
    if (igual(notion[k], acoes[k])) continue;
    if (!ultimos || !(k in ultimos)) {
      (d.paraAcoes as Record<string, unknown>)[k] = notion[k];
      continue;
    }
    const mudouNotion = !igual(notion[k], ultimos[k]);
    const mudouAcoes = !igual(acoes[k], ultimos[k]);
    if (mudouNotion && mudouAcoes) {
      d.conflitos.push(k);
      if (Date.parse(quando.acoes) > Date.parse(quando.notion)) (d.paraNotion as Record<string, unknown>)[k] = acoes[k];
      else (d.paraAcoes as Record<string, unknown>)[k] = notion[k];
    } else if (mudouNotion) (d.paraAcoes as Record<string, unknown>)[k] = notion[k];
    else if (mudouAcoes) (d.paraNotion as Record<string, unknown>)[k] = acoes[k];
  }
  return d;
}

/** Área (BU) do Notion pelo workspace do TTARS de quem pediu. */
export function buDoWorkspace(slug: string | null | undefined): string {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("wedding")) return "Weddings";
  if (s.includes("trips")) return "Trips";
  if (s.includes("corp")) return "Corp";
  return "Institucional";
}

/** Id da base a partir do link do Notion (aceita o link inteiro ou só o id). */
export function idDaBase(linkOuId: string): string | null {
  const m = linkOuId.replace(/-/g, "").match(/[0-9a-f]{32}/i);
  if (!m) return null;
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

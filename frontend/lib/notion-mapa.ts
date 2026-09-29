// Notion do marketing ↔ Ações (pedido do Vitor, 25/09/2026, bloco 4): regras puras de
// tradução entre uma página da base "Tasks" do Notion e uma ação. Sem I/O — testadas em
// notion-mapa.test.ts. O que chega e sai do Notion passa todo por aqui.
// 29/09/2026 ("tem que linkar 100%"): as 8 situações da base, o projeto de cada tarefa (vira
// projeto no Ações), a coluna Text, os arquivos e quem criou a tarefa no Notion.

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
  /** Id da página do projeto do Notion ("" = sem projeto). */
  projeto: string;
};

/** Onde a descrição mora na página: a equipe usa Description OU Text. Com as duas preenchidas, o
 *  Ações mostra as duas juntas e, se mudar a descrição aqui, grava tudo na Description (Text vazio). */
export type CampoDaDescricao = "Description" | "Text" | "Ambos";

/** Um arquivo da coluna "Files & media". `chave` identifica o arquivo entre leituras (o link de
 *  arquivo guardado no Notion muda a cada leitura; o caminho, não). */
export type ArquivoDoNotion = { chave: string; nome: string; tipo: "external" | "file"; url: string };

export type PaginaLida = Campos & {
  pageId: string;
  url: string | null;
  /** O nome da situação no Notion, como a equipe vê lá (Not started, Up next…). */
  statusNotion: string;
  bu: string | null;
  noLixo: boolean;
  editadoEm: string;
  editadoPor: string | null;
  /** Quem criou a página no Notion (id). */
  criadoPor: string | null;
  campoDescricao: CampoDaDescricao;
  /** Todos os projetos da coluna Project (quase sempre um só). */
  projetos: string[];
  arquivos: ArquivoDoNotion[];
  pessoas: { id: string; nome: string; email: string | null }[];
};

/** Uma página da base Projects do Notion. */
export type ProjetoLido = {
  pageId: string;
  url: string | null;
  nome: string;
  /** Idea, Planning, In Progress, Complete, Archived. */
  etapa: string | null;
  inicio: string | null;
  fim: string | null;
  /** Id do líder no Notion. */
  lider: string | null;
  noLixo: boolean;
  editadoEm: string;
};

type Prop = { type?: string; [k: string]: unknown };
export type PaginaNotion = {
  id: string;
  url?: string;
  in_trash?: boolean;
  archived?: boolean;
  last_edited_time: string;
  last_edited_by?: { id?: string };
  created_by?: { id?: string };
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
  texto: "Text",
  prioridade: "Priority",
  projeto: "Project",
  arquivos: "Files & media",
} as const;

/** Nomes das propriedades na base Projects (conferidos em 29/09). */
export const PROPS_PROJETO = {
  nome: "Name",
  etapa: "Stage",
  periodo: "Timeline",
  lider: "Lead",
} as const;

// As 8 situações da base (29/09): To Day e Daily são "fazendo"; Locked (travada) fica aberta,
// com o nome de lá à vista na ação.
const DE_NOTION: Record<string, StatusAcoes> = {
  "not started": "aberta",
  "up next": "aberta",
  locked: "aberta",
  "this week": "em_andamento",
  "to day": "em_andamento",
  today: "em_andamento",
  daily: "em_andamento",
  "in progress": "em_andamento",
  "in approval": "aguardando_aprovacao",
  done: "concluida",
};

export function statusDoNotion(nome: string | null | undefined): StatusAcoes {
  return DE_NOTION[(nome ?? "").trim().toLowerCase()] ?? "aberta";
}

/**
 * Situação do Ações → nome no Notion. Se o nome que estava lá já quer dizer a mesma situação
 * (To Day, Daily e This Week são "fazendo"; Up next e Locked são "aberta"), ele fica; senão vai
 * o nome padrão. Cancelada não tem situação: a página vai pra lixeira (null aqui).
 */
export function statusParaNotion(s: StatusAcoes, anteriorNoNotion: string | null | undefined): string | null {
  if (s === "cancelada") return null;
  const anterior = (anteriorNoNotion ?? "").trim();
  if (anterior && DE_NOTION[anterior.toLowerCase()] === s) return anterior;
  if (s === "aberta") return "Not started";
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

/** O caminho do arquivo guardado no Notion, sem a assinatura que muda a cada leitura. */
export function chaveDoArquivo(tipo: string, url: string): string {
  if (tipo !== "file") return url;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function arquivosDe(p: Prop | undefined): ArquivoDoNotion[] {
  const lista = (p?.files as { name?: string; type?: string; external?: { url?: string }; file?: { url?: string } }[] | undefined) ?? [];
  const out: ArquivoDoNotion[] = [];
  for (const f of lista) {
    const tipo = f.type === "file" ? "file" : "external";
    const url = (tipo === "file" ? f.file?.url : f.external?.url) ?? "";
    if (!url) continue;
    out.push({ chave: chaveDoArquivo(tipo, url), nome: (f.name ?? "").trim() || url, tipo, url });
  }
  return out;
}

export function lerPagina(pg: PaginaNotion): PaginaLida {
  const pr = pg.properties || {};
  const pessoas = pessoasDe(pr[PROPS.pessoa]);
  const reserva = pessoasDe(pr[PROPS.pessoaReserva]);
  const todas = pessoas.length ? pessoas : reserva;
  const statusNotion = ((pr[PROPS.status]?.status as { name?: string } | null)?.name ?? "").trim();
  const descricao = textoRico(pr[PROPS.descricao]?.rich_text);
  const texto = textoRico(pr[PROPS.texto]?.rich_text);
  const projetos = ((pr[PROPS.projeto]?.relation as { id?: string }[] | undefined) ?? []).map((x) => x?.id ?? "").filter(Boolean);
  return {
    pageId: pg.id,
    url: pg.url ?? null,
    titulo: textoRico(pr[PROPS.titulo]?.title).trim() || "(sem título no Notion)",
    // Quem usa a coluna Text escreve ali o que seria a descrição; com as duas, vão juntas.
    descricao: [descricao, texto].filter(Boolean).join("\n\n"),
    campoDescricao: descricao && texto ? "Ambos" : texto ? "Text" : "Description",
    projeto: projetos[0] ?? "",
    projetos,
    arquivos: arquivosDe(pr[PROPS.arquivos]),
    criadoPor: pg.created_by?.id ?? null,
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
  ctx: { statusAnterior?: string | null; bu?: string | null; campoDescricao?: CampoDaDescricao | null } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (campos.titulo !== undefined) out[PROPS.titulo] = { title: [{ text: { content: campos.titulo.slice(0, 2000) } }] };
  if (campos.descricao !== undefined) {
    out[ctx.campoDescricao === "Text" ? PROPS.texto : PROPS.descricao] = {
      rich_text: campos.descricao ? [{ text: { content: campos.descricao.slice(0, 2000) } }] : [],
    };
    // Estava nas duas colunas: tudo vai pra Description e o Text fica vazio (senão aparece dobrado).
    if (ctx.campoDescricao === "Ambos") out[PROPS.texto] = { rich_text: [] };
  }
  if (campos.projeto !== undefined) out[PROPS.projeto] = { relation: campos.projeto ? [{ id: campos.projeto }] : [] };
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

export const CHAVES: (keyof Campos)[] = ["titulo", "descricao", "prazo", "status", "prioridade", "pessoa", "projeto"];

/** Uma página da base Projects. */
export function lerProjeto(pg: PaginaNotion): ProjetoLido {
  const pr = pg.properties || {};
  const periodo = pr[PROPS_PROJETO.periodo]?.date as { start?: string | null; end?: string | null } | null | undefined;
  const dia = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const lideres = (pr[PROPS_PROJETO.lider]?.people as { id?: string }[] | undefined) ?? [];
  return {
    pageId: pg.id,
    url: pg.url ?? null,
    nome: textoRico(pr[PROPS_PROJETO.nome]?.title).trim() || "(projeto sem nome no Notion)",
    etapa: ((pr[PROPS_PROJETO.etapa]?.select as { name?: string } | null)?.name ?? "").trim() || null,
    inicio: dia(periodo?.start),
    fim: dia(periodo?.end ?? periodo?.start),
    lider: lideres.find((x) => x?.id)?.id ?? null,
    noLixo: !!(pg.in_trash || pg.archived),
    editadoEm: pg.last_edited_time,
  };
}

/** Etapa do projeto em português (a tela do TTARS mostra assim). */
export function etapaEmPortugues(etapa: string | null | undefined): string | null {
  const e = (etapa ?? "").trim().toLowerCase();
  const nomes: Record<string, string> = {
    idea: "Ideia",
    planning: "Planejando",
    "in progress": "Em andamento",
    complete: "Concluído",
    archived: "Arquivado",
  };
  return nomes[e] ?? (etapa?.trim() || null);
}

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

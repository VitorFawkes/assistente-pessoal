// Pedidos ao Marketing (30/09/2026): os tipos que o servidor e o TTARS usam com os MESMOS nomes, e as
// regras puras (conferir o que vem da tela, quem é do público, como cada resposta vira texto). Sem I/O —
// testadas em pedidos-tipos.test.ts.
import { MARCA_DO_TEAMS } from "./ttars-auth";

export type TipoPergunta =
  | "automatico_quem_pede"
  | "casamento"
  | "texto"
  | "paragrafo"
  | "data"
  | "sim_nao"
  | "escolha_unica"
  | "multipla"
  | "telefone_email"
  | "instagram"
  | "link"
  | "numero";
export type Preenche = "data_casamento" | "casal" | "local" | "programacao" | "produtora" | "instagram" | null;

export interface Pergunta {
  id: string;
  tipo: TipoPergunta;
  rotulo: string;
  ajuda?: string;
  obrigatoria: boolean;
  aceita_nao_temos: boolean;
  opcoes?: string[];
  preenche?: Preenche;
  /** Só no Instagram do casal: o rótulo vira "Instagram de <nome>" na tela. */
  pessoa?: 1 | 2;
  linha_original?: string;
}
export interface Publico {
  tipo: "todos" | "empresas" | "times";
  empresas: string[];
  times: { id: string; nome: string }[];
}
export type Area = "Weddings" | "Trips" | "Corp" | "Institucional";
export type PrioridadePedido = "baixa" | "media" | "alta" | "urgente";
export interface Destino {
  quem_email: string;
  projeto_notion_page_id: string | null;
  bu: Area;
  prioridade: PrioridadePedido;
  prazo: { tipo: "data_casamento" | "dias" | "sem"; dias?: number };
  /** Ex.: "Cobertura I {casal} I Pedido"; {casal} e {quem}. */
  titulo_modelo: string;
}
export interface Rascunho {
  nome: string;
  explica: string;
  icone: string;
  perguntas: Pergunta[];
  publico: Publico;
  destino: Destino;
}
export interface Formulario {
  id: string;
  slug: string;
  nome: string;
  explica: string;
  icone: string;
  estado: "rascunho" | "no_ar" | "desligado";
  versao: number;
  perguntas: Pergunta[];
  publico: Publico;
  destino: Destino;
  rascunho: null | Rascunho;
  pedidos: number;
  atualizado_em: string;
  atualizado_por_nome: string | null;
}
export interface Resposta {
  valor: string | string[] | boolean | null;
  nao_temos?: boolean;
}
export interface PedidoDaAcao {
  formulario_id: string;
  formulario_nome: string;
  versao: number;
  card_id: string | null;
  card_titulo: string | null;
  respostas: { rotulo: string; texto: string }[];
  somente_leitura: boolean;
  pode_cancelar: boolean;
}

export const TIPOS: TipoPergunta[] = [
  "automatico_quem_pede",
  "casamento",
  "texto",
  "paragrafo",
  "data",
  "sim_nao",
  "escolha_unica",
  "multipla",
  "telefone_email",
  "instagram",
  "link",
  "numero",
];
export const PREENCHE: Exclude<Preenche, null>[] = ["data_casamento", "casal", "local", "programacao", "produtora", "instagram"];
export const EMPRESAS = ["Welcome Weddings", "Welcome Trips", "Welcome Corporativo"];
export const AREAS: Area[] = ["Weddings", "Trips", "Corp", "Institucional"];
export const PRIORIDADES: PrioridadePedido[] = ["baixa", "media", "alta", "urgente"];
export const MAX_PERGUNTAS = 80;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ID_PERGUNTA = /^[a-z0-9_-]{1,40}$/i;
const TIME_RE = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COM_OPCOES: TipoPergunta[] = ["escolha_unica", "multipla"];

type Erro = { erro: string };
export const ehErro = (x: unknown): x is Erro => !!x && typeof x === "object" && "erro" in x;

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

/** Uma pergunta como veio da tela (ou da IA), conferida. */
export function limparPergunta(x: unknown, posicao: number): Pergunta | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const qual = `a pergunta ${posicao + 1}`;
  const tipo = o.tipo as TipoPergunta;
  if (!TIPOS.includes(tipo)) return { erro: `O tipo de ${qual} não existe.` };
  const rotulo = texto(o.rotulo, 300);
  if (!rotulo) return { erro: `Escreva o texto de ${qual}.` };
  const id = typeof o.id === "string" && ID_PERGUNTA.test(o.id) ? o.id : `p${posicao + 1}`;
  const p: Pergunta = {
    id,
    tipo,
    rotulo,
    obrigatoria: o.obrigatoria === true,
    aceita_nao_temos: o.aceita_nao_temos === true,
  };
  const ajuda = texto(o.ajuda, 500);
  if (ajuda) p.ajuda = ajuda;
  if (COM_OPCOES.includes(tipo)) {
    const opcoes = Array.isArray(o.opcoes) ? [...new Set(o.opcoes.map((v) => texto(v, 200)).filter(Boolean))].slice(0, 50) : [];
    p.opcoes = opcoes;
  }
  if (o.preenche !== undefined && o.preenche !== null) {
    if (!PREENCHE.includes(o.preenche as Exclude<Preenche, null>)) return { erro: `"Preenche sozinho" de ${qual} não existe.` };
    p.preenche = o.preenche as Preenche;
  }
  if (tipo === "instagram" && (o.pessoa === 1 || o.pessoa === 2)) p.pessoa = o.pessoa;
  const linha = texto(o.linha_original, 1000);
  if (linha) p.linha_original = linha;
  return p;
}

/** A lista inteira: ids únicos (o repetido ganha outro), no máximo MAX_PERGUNTAS. */
export function limparPerguntas(xs: unknown): Pergunta[] | Erro {
  if (!Array.isArray(xs)) return { erro: "As perguntas vieram erradas." };
  if (xs.length > MAX_PERGUNTAS) return { erro: `Um formulário tem no máximo ${MAX_PERGUNTAS} perguntas.` };
  const out: Pergunta[] = [];
  const usados = new Set<string>();
  for (let i = 0; i < xs.length; i++) {
    const p = limparPergunta(xs[i], i);
    if (ehErro(p)) return p;
    let id = p.id;
    for (let n = 2; usados.has(id); n++) id = `${p.id}-${n}`;
    usados.add(id);
    out.push({ ...p, id });
  }
  return out;
}

export function limparPublico(x: unknown): Publico | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const tipo = o.tipo as Publico["tipo"];
  if (!["todos", "empresas", "times"].includes(tipo)) return { erro: "Escolha quem pode pedir." };
  const empresas = Array.isArray(o.empresas) ? [...new Set(o.empresas.filter((e): e is string => typeof e === "string" && EMPRESAS.includes(e)))] : [];
  const times = Array.isArray(o.times)
    ? o.times
        .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
        .filter((t) => typeof t.id === "string" && TIME_RE.test(t.id))
        .map((t) => ({ id: t.id as string, nome: texto(t.nome, 120) || "Time" }))
        .filter((t, i, arr) => arr.findIndex((y) => y.id === t.id) === i)
        .slice(0, 50)
    : [];
  return { tipo, empresas, times };
}

/** `estrito` = para publicar (precisa de quem recebe). O rascunho aceita incompleto. */
export function limparDestino(x: unknown, estrito: boolean): Destino | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const quem = texto(o.quem_email, 200).toLowerCase();
  if (quem && !EMAIL_RE.test(quem)) return { erro: "O e-mail de quem recebe não está certo." };
  if (estrito && !quem) return { erro: "Escolha a pessoa do marketing que recebe o pedido." };
  const bu = (AREAS.includes(o.bu as Area) ? o.bu : "Institucional") as Area;
  const prioridade = (PRIORIDADES.includes(o.prioridade as PrioridadePedido) ? o.prioridade : "media") as PrioridadePedido;
  const pr = (o.prazo && typeof o.prazo === "object" ? o.prazo : {}) as Record<string, unknown>;
  let prazo: Destino["prazo"] = { tipo: "sem" };
  if (pr.tipo === "data_casamento") prazo = { tipo: "data_casamento" };
  else if (pr.tipo === "dias") {
    const dias = Number(pr.dias);
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { erro: "O prazo em dias vai de 0 a 365." };
    prazo = { tipo: "dias", dias };
  }
  const projeto = typeof o.projeto_notion_page_id === "string" && o.projeto_notion_page_id.trim() ? o.projeto_notion_page_id.trim().slice(0, 100) : null;
  return {
    quem_email: quem,
    projeto_notion_page_id: projeto,
    bu,
    prioridade,
    prazo,
    titulo_modelo: texto(o.titulo_modelo, 200),
  };
}

/** O rascunho inteiro (Salvar rascunho). */
export function limparRascunho(x: unknown): Rascunho | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const nome = texto(o.nome, 120);
  if (!nome) return { erro: "Dê um nome ao formulário." };
  const perguntas = limparPerguntas(o.perguntas ?? []);
  if (ehErro(perguntas)) return perguntas;
  const publico = limparPublico(o.publico ?? { tipo: "empresas" });
  if (ehErro(publico)) return publico;
  const destino = limparDestino(o.destino ?? {}, false);
  if (ehErro(destino)) return destino;
  return { nome, explica: texto(o.explica, 1000), icone: texto(o.icone, 16) || "📝", perguntas, publico, destino };
}

/** O que falta para publicar (null = pode). */
export function faltaParaPublicar(r: Rascunho): string | null {
  if (!r.perguntas.length) return "Ponha pelo menos uma pergunta.";
  if (!r.destino.quem_email) return "Escolha a pessoa do marketing que recebe o pedido.";
  if (r.publico.tipo === "empresas" && !r.publico.empresas.length) return "Escolha pelo menos uma empresa que pode pedir.";
  if (r.publico.tipo === "times" && !r.publico.times.length) return "Escolha pelo menos um time que pode pedir.";
  const semOpcao = r.perguntas.find((p) => COM_OPCOES.includes(p.tipo) && (p.opcoes?.length ?? 0) < 2);
  if (semOpcao) return `"${semOpcao.rotulo}" precisa de pelo menos 2 opções.`;
  return null;
}

// ── quem pode pedir ─────────────────────────────────────────────────────────────────────────

export type PessoaDoPublico = { organizacao: string | null; times: { id: string }[] | null };

const empresasDe = (organizacao: string) => organizacao.split(",").map((s) => s.trim()).filter(Boolean);

/** A pessoa (da lista do TTARS) está no público do formulário. Quem só está no Teams entra só em "todos". */
export function estaNoPublico(p: PessoaDoPublico | null, publico: Publico): boolean {
  if (publico.tipo === "todos") return true;
  if (!p) return false;
  const org = p.organizacao ?? "";
  if (!org || org.startsWith(MARCA_DO_TEAMS)) return false;
  if (publico.tipo === "empresas") {
    const minhas = empresasDe(org);
    return publico.empresas.some((e) => minhas.includes(e));
  }
  const meus = new Set((Array.isArray(p.times) ? p.times : []).map((t) => t?.id).filter(Boolean));
  return publico.times.some((t) => meus.has(t.id));
}

/** Um time do TTARS pode acompanhar pedidos deste público (empresas: o time é de uma delas). */
export function timeNoPublico(time: { id: string; organizacao: string | null }, publico: Publico): boolean {
  if (publico.tipo === "todos") return true;
  if (publico.tipo === "times") return publico.times.some((t) => t.id === time.id);
  const orgs = empresasDe(time.organizacao ?? "");
  return publico.empresas.some((e) => orgs.includes(e));
}

/** Robôs e contas de teste não contam como gente que pede. */
export function ehRoboOuTeste(email: string): boolean {
  const e = email.trim().toLowerCase();
  return (
    e.startsWith("sarah.ia@") ||
    e.startsWith("contato@welcomeweddings") ||
    e.startsWith("weddingplanner@") ||
    e.endsWith("@welcomecrm.test")
  );
}

// ── respostas ───────────────────────────────────────────────────────────────────────────────

const vazio = (v: Resposta["valor"] | undefined) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

/** A resposta de uma pergunta como aparece na ação e no Notion. */
export function textoDaResposta(p: Pergunta, r: Resposta | undefined): string {
  if (r?.nao_temos && p.aceita_nao_temos) return "ainda não temos";
  const v = r?.valor;
  if (vazio(v)) return "—";
  if (p.tipo === "sim_nao") return v === true ? "Sim" : v === false ? "Não" : String(v);
  if (p.tipo === "data" && typeof v === "string" && DIA.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v).trim();
}

/**
 * Confere as respostas de quem pede contra as perguntas. `auto` = o que o servidor preenche (quem pede e o
 * casamento escolhido). Devolve as respostas limpas (só as das perguntas) ou o erro para a tela.
 */
export function conferirRespostas(
  perguntas: Pergunta[],
  entrada: unknown,
  auto: { quem: string; casamento: string | null },
): Record<string, Resposta> | Erro {
  const bruto = (entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const out: Record<string, Resposta> = {};
  for (const p of perguntas) {
    if (p.tipo === "automatico_quem_pede") {
      out[p.id] = { valor: auto.quem };
      continue;
    }
    if (p.tipo === "casamento") {
      if (!auto.casamento && p.obrigatoria) return { erro: `Escolha "${p.rotulo}".` };
      out[p.id] = { valor: auto.casamento };
      continue;
    }
    const r = (bruto[p.id] && typeof bruto[p.id] === "object" ? bruto[p.id] : {}) as { valor?: unknown; nao_temos?: unknown };
    if (r.nao_temos === true) {
      if (!p.aceita_nao_temos) return { erro: `"${p.rotulo}" precisa de resposta.` };
      out[p.id] = { valor: null, nao_temos: true };
      continue;
    }
    const errado = { erro: `A resposta de "${p.rotulo}" não está certa.` };
    let valor: Resposta["valor"] = null;
    const v = r.valor;
    if (v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length)) valor = null;
    else if (p.tipo === "sim_nao") {
      if (typeof v !== "boolean") return errado;
      valor = v;
    } else if (p.tipo === "multipla") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !(p.opcoes ?? []).includes(x))) return errado;
      valor = [...new Set(v as string[])];
    } else if (typeof v !== "string" && !(p.tipo === "numero" && typeof v === "number")) return errado;
    else {
      const s = String(v).replace(/\u0000/g, "").trim();
      if (p.tipo === "data" && !DIA.test(s)) return errado;
      if (p.tipo === "numero" && !/^-?\d+([.,]\d+)?$/.test(s)) return errado;
      if (p.tipo === "escolha_unica" && !(p.opcoes ?? []).includes(s)) return errado;
      valor = s.slice(0, p.tipo === "paragrafo" ? 4000 : p.tipo === "link" ? 1000 : 500);
    }
    if (valor === null && p.obrigatoria) return { erro: `Responda "${p.rotulo}".` };
    out[p.id] = { valor };
  }
  return out;
}

/** A resposta (texto) da pergunta que preenche `qual`, se houver. */
export function respostaQuePreenche(perguntas: Pergunta[], respostas: Record<string, Resposta>, qual: Exclude<Preenche, null>): string | null {
  const p = perguntas.find((x) => x.preenche === qual);
  const v = p ? respostas[p.id]?.valor : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** O título da ação pelo modelo do formulário ({casal} e {quem}); 300 letras no máximo. */
export function tituloDoPedido(modelo: string, dados: { casal: string | null; quem: string; nomeDoFormulario: string }): string {
  const t = (modelo || dados.nomeDoFormulario)
    .replaceAll("{casal}", dados.casal ?? "")
    .replaceAll("{quem}", dados.quem)
    .replace(/\s+/g, " ")
    .trim();
  return (t || dados.nomeDoFormulario).slice(0, 300);
}

/** A descrição: quem pediu e quando (dd/mm de Brasília) e uma linha por pergunta (resposta de várias linhas
 *  fica numa só, separada por " · "). */
export function descricaoDoPedido(perguntas: Pergunta[], respostas: Record<string, Resposta>, quem: string, diaMes: string): string {
  const numaLinha = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" · ");
  return [linhaDePedido(quem, diaMes), ...perguntas.map((p) => `${p.rotulo}: ${numaLinha(textoDaResposta(p, respostas[p.id]))}`)].join("\n");
}

export const linhaDePedido = (quem: string, diaMes: string) => `Pedido por ${quem} pelo TTARS, ${diaMes}`;

/** Título do card sem os prefixos do quadro ("DW |", "DW l", "W -", "Elopement |"). */
export function casalDoTitulo(titulo: string | null | undefined): string {
  return (titulo ?? "").replace(/^\s*(DW\s*[|l]|W\s*-|Elopement\s*\|)\s*/i, "").trim();
}

// ── situação ────────────────────────────────────────────────────────────────────────────────

const DO_NOTION: Record<string, string> = {
  "not started": "Ainda não começou",
  "up next": "Na fila",
  "this week": "Nesta semana",
  "to day": "Hoje",
  today: "Hoje",
  daily: "Todo dia",
  "in progress": "Em andamento",
  "in approval": "Esperando aprovação",
  locked: "Travada",
  done: "Feita",
};
const DO_ACOES: Record<string, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  aguardando_aprovacao: "Esperando aprovação",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/** A situação do pedido em português: a do Notion quando a página existe, senão a da ação. */
export function situacaoDoPedido(status: string, statusNotion: string | null): string {
  if (status === "cancelada") return DO_ACOES.cancelada;
  if (statusNotion) return DO_NOTION[statusNotion.trim().toLowerCase()] ?? statusNotion;
  return DO_ACOES[status] ?? status;
}

/** Nome curto para o endereço do formulário. */
export function slugDe(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "formulario";
}

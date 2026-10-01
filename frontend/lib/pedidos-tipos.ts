// Pedidos ao Marketing (30/09/2026): os tipos que o servidor e o TTARS usam com os MESMOS nomes, e as
// regras puras (conferir o que vem da tela, quem é do público, como cada resposta vira texto). Sem I/O —
// testadas em pedidos-tipos.test.ts.
// 01/10/2026 ("Pq só uma pessoa pode receber o formulário?"): várias pessoas recebem (a 1ª faz, as outras
// também fazem), prazo pela data que quem pede escolhe, área pela marca de quem pede e repetido por formulário.
import { maisDiasBR } from "./data-br";
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
/** "combinado" = basta estar em qualquer lista (empresas, times ou pessoas). Os antigos "empresas" e "times" são
 *  lidos como combinado só com a lista deles; salvar grava sempre "todos" ou "combinado". */
export interface Publico {
  tipo: "todos" | "combinado";
  empresas: string[];
  times: { id: string; nome: string }[];
  /** E-mails de pessoas avulsas (não liberam time para acompanhar). */
  pessoas: string[];
}
export type Area = "Weddings" | "Trips" | "Corp" | "Institucional";
export type PrioridadePedido = "baixa" | "media" | "alta" | "urgente";
export interface Destino {
  /** = quem_emails[0] (formulário antigo só tinha este). */
  quem_email: string;
  /** Quem recebe, na ordem: a 1ª faz, as outras também fazem (1 a 10). */
  quem_emails: string[];
  projeto_notion_page_id: string | null;
  /** "quem_pede" = a marca de quem pede (com mais de uma, ela escolhe). */
  bu: Area | "quem_pede";
  prioridade: PrioridadePedido;
  /** "pergunta" = a data que quem pede responde na pergunta `pergunta_id` (de data, obrigatória e sem "ainda não
   *  temos"); "dias_do_casamento" = `dias` antes (negativo) ou depois (positivo) do dia do casamento. */
  prazo: { tipo: "data_casamento" | "dias" | "sem" | "pergunta" | "dias_do_casamento"; dias?: number; pergunta_id?: string };
  /** Ex.: "Cobertura I {casal} I Pedido"; {casal} e {quem}. */
  titulo_modelo: string;
  /** Um pedido vivo por casamento (false = o mesmo casamento pode ter vários). */
  um_por_casamento: boolean;
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
  /** Quem pediu (ou o marketing) completa as respostas enquanto o pedido não foi encerrado. */
  pode_completar: boolean;
  /** As perguntas da versão em que foi pedido. */
  perguntas: Pergunta[];
  respostas_brutas: Record<string, Resposta>;
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
export const MAX_QUEM_RECEBE = 10;

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

export const MAX_PESSOAS_NO_PUBLICO = 300;

/** Quem pode pedir, conferido. Os antigos "empresas" e "times" valiam só pela lista deles: viram "combinado" só
 *  com ela (a outra lista guardada não passa a valer). */
export function limparPublico(x: unknown): Publico | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const tipo = o.tipo;
  if (tipo !== "todos" && tipo !== "combinado" && tipo !== "empresas" && tipo !== "times") return { erro: "Escolha quem pode pedir." };
  const empresas = Array.isArray(o.empresas) ? [...new Set(o.empresas.filter((e): e is string => typeof e === "string" && EMPRESAS.includes(e)))] : [];
  const times = Array.isArray(o.times)
    ? o.times
        .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
        .filter((t) => typeof t.id === "string" && TIME_RE.test(t.id))
        .map((t) => ({ id: t.id as string, nome: texto(t.nome, 120) || "Time" }))
        .filter((t, i, arr) => arr.findIndex((y) => y.id === t.id) === i)
        .slice(0, 50)
    : [];
  const pessoas = Array.isArray(o.pessoas)
    ? [...new Set(o.pessoas.map((e) => texto(e, 200).toLowerCase()).filter((e) => EMAIL_RE.test(e)))].slice(0, MAX_PESSOAS_NO_PUBLICO)
    : [];
  if (tipo === "empresas") return { tipo: "combinado", empresas, times: [], pessoas: [] };
  if (tipo === "times") return { tipo: "combinado", empresas: [], times, pessoas: [] };
  return { tipo, empresas, times, pessoas };
}

/**
 * `estrito` = para publicar (precisa de quem recebe). O rascunho aceita incompleto. Quem recebe vem em
 * `quem_emails` (a ordem vale); formulário antigo, só com `quem_email`, vira uma lista de uma pessoa.
 */
export function limparDestino(x: unknown, estrito: boolean): Destino | Erro {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const lista = Array.isArray(o.quem_emails) ? o.quem_emails : typeof o.quem_emails === "string" ? [o.quem_emails] : [o.quem_email];
  const quem: string[] = [];
  for (const e of lista.map((v) => texto(v, 200).toLowerCase()).filter(Boolean)) {
    if (!EMAIL_RE.test(e)) return { erro: `O e-mail de quem recebe não está certo (${e}).` };
    if (!quem.includes(e)) quem.push(e);
  }
  if (quem.length > MAX_QUEM_RECEBE) return { erro: `No máximo ${MAX_QUEM_RECEBE} pessoas recebem o pedido.` };
  if (estrito && !quem.length) return { erro: "Escolha a pessoa do marketing que recebe o pedido." };
  const bu = (AREAS.includes(o.bu as Area) || o.bu === "quem_pede" ? o.bu : "Institucional") as Destino["bu"];
  const prioridade = (PRIORIDADES.includes(o.prioridade as PrioridadePedido) ? o.prioridade : "media") as PrioridadePedido;
  const pr = (o.prazo && typeof o.prazo === "object" ? o.prazo : {}) as Record<string, unknown>;
  let prazo: Destino["prazo"] = { tipo: "sem" };
  if (pr.tipo === "data_casamento") prazo = { tipo: "data_casamento" };
  else if (pr.tipo === "dias") {
    const dias = Number(pr.dias);
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { erro: "O prazo em dias vai de 0 a 365." };
    prazo = { tipo: "dias", dias };
  } else if (pr.tipo === "pergunta") {
    // A pergunta ainda pode não ter sido escolhida no rascunho: publicar confere.
    prazo = { tipo: "pergunta", pergunta_id: typeof pr.pergunta_id === "string" && ID_PERGUNTA.test(pr.pergunta_id) ? pr.pergunta_id : "" };
  } else if (pr.tipo === "dias_do_casamento") {
    const dias = Number(pr.dias);
    if (!Number.isInteger(dias) || dias < -365 || dias > 365) return { erro: "O prazo pelo casamento vai de 365 dias antes a 365 dias depois." };
    prazo = { tipo: "dias_do_casamento", dias };
  }
  const projeto = typeof o.projeto_notion_page_id === "string" && o.projeto_notion_page_id.trim() ? o.projeto_notion_page_id.trim().slice(0, 100) : null;
  return {
    quem_email: quem[0] ?? "",
    quem_emails: quem,
    projeto_notion_page_id: projeto,
    bu,
    prioridade,
    prazo,
    titulo_modelo: texto(o.titulo_modelo, 200),
    um_por_casamento: o.um_por_casamento !== false,
  };
}

/** Destino de formulário novo (ou ilegível). */
export const destinoVazio = (): Destino => ({
  quem_email: "",
  quem_emails: [],
  projeto_notion_page_id: null,
  bu: "Institucional",
  prioridade: "media",
  prazo: { tipo: "sem" },
  titulo_modelo: "",
  um_por_casamento: true,
});

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
  if (!r.destino.quem_emails.length) return "Escolha a pessoa do marketing que recebe o pedido.";
  const p = r.publico;
  if (p.tipo === "combinado" && !p.empresas.length && !p.times.length && !p.pessoas.length) return "Escolha quem pode pedir: empresas, times ou pessoas.";
  const semOpcao = r.perguntas.find((x) => COM_OPCOES.includes(x.tipo) && (x.opcoes?.length ?? 0) < 2);
  if (semOpcao) return `"${semOpcao.rotulo}" precisa de pelo menos 2 opções.`;
  const prazo = r.destino.prazo;
  if (prazo.tipo === "pergunta") {
    const q = r.perguntas.find((x) => x.id === prazo.pergunta_id);
    if (!q) return "Escolha a pergunta de data que vira o prazo.";
    if (q.tipo !== "data") return `"${q.rotulo}" não é uma pergunta de data: o prazo precisa de uma pergunta de data.`;
    if (!q.obrigatoria) return `"${q.rotulo}" precisa ser obrigatória para virar o prazo.`;
    if (q.aceita_nao_temos) return "A pergunta do prazo não pode aceitar 'ainda não temos'.";
  }
  // Prazo pelo casamento sem a data do casamento nunca teria prazo.
  if ((prazo.tipo === "data_casamento" || prazo.tipo === "dias_do_casamento") && !r.perguntas.some((x) => x.preenche === "data_casamento")) {
    return "O prazo pelo casamento precisa de uma pergunta que preenche a data do casamento.";
  }
  return null;
}

// ── quem pode pedir ─────────────────────────────────────────────────────────────────────────

export type PessoaDoPublico = { email?: string | null; organizacao: string | null; times: { id: string }[] | null };

const empresasDe = (organizacao: string) => organizacao.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * A pessoa (da lista do TTARS) está no público do formulário: "todos", ou qualquer lista do combinado (empresa,
 * time ou ela mesma pelo e-mail). Quem só está no Teams entra por empresa ou time só em "todos"; escolhida pelo
 * e-mail, entra.
 */
export function estaNoPublico(p: PessoaDoPublico | null, publico: Publico): boolean {
  if (publico.tipo === "todos") return true;
  if (!p) return false;
  const email = (p.email ?? "").trim().toLowerCase();
  if (email && (publico.pessoas ?? []).includes(email)) return true;
  const org = p.organizacao ?? "";
  if (!org || org.startsWith(MARCA_DO_TEAMS)) return false;
  const minhas = empresasDe(org);
  if (publico.empresas.some((e) => minhas.includes(e))) return true;
  const meus = new Set((Array.isArray(p.times) ? p.times : []).map((t) => t?.id).filter(Boolean));
  return publico.times.some((t) => meus.has(t.id));
}

const MARCA_DA_EMPRESA: Record<string, Area> = { "Welcome Trips": "Trips", "Welcome Weddings": "Weddings", "Welcome Corporativo": "Corp" };

/** As marcas (áreas) de uma pessoa pela empresa dela no TTARS, na ordem de lá ("Welcome Group" não é marca). */
export function marcasDaOrganizacao(organizacao: string | null | undefined): Area[] {
  let org = organizacao ?? "";
  if (org.startsWith(MARCA_DO_TEAMS)) org = org.slice(MARCA_DO_TEAMS.length);
  return [...new Set(empresasDe(org).map((e) => MARCA_DA_EMPRESA[e]).filter((a): a is Area => !!a))];
}

/**
 * A área do pedido: a fixa do formulário ou, com "quem_pede", a marca de quem pede. Uma marca só: ela;
 * nenhuma: Institucional; mais de uma: a que a pessoa escolheu (precisa ser uma das dela).
 */
export function areaDoPedido(bu: Destino["bu"], marcas: Area[], escolhida: unknown): Area | Erro {
  if (bu !== "quem_pede") return bu;
  if (!marcas.length) return "Institucional";
  if (marcas.length === 1) return marcas[0];
  if (typeof escolhida === "string" && marcas.includes(escolhida as Area)) return escolhida as Area;
  return { erro: `Escolha a área do pedido: ${marcas.join(" ou ")}.` };
}

/** Um time do TTARS pode acompanhar pedidos deste público: um dos times escolhidos ou um time das empresas
 *  escolhidas. Pessoa avulsa não libera time. */
export function timeNoPublico(time: { id: string; organizacao: string | null }, publico: Publico): boolean {
  if (publico.tipo === "todos") return true;
  if (publico.times.some((t) => t.id === time.id)) return true;
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

/** Os e-mails da gente da Welcome no TTARS (30/09/2026: todos os ativos das empresas Welcome, tirando as contas
 *  de teste e o Robson, de growthway.online). */
const DOMINIOS_DA_WELCOME = ["welcometrips.com.br", "welcomeweddings.com.br"];

/** De fora da Welcome (ex.: o Robson): não conta nem é liberado pelo formulário (página aprovada, bloco 1). */
export function ehDeFora(email: string): boolean {
  const dominio = email.trim().toLowerCase().split("@")[1] ?? "";
  return !DOMINIOS_DA_WELCOME.includes(dominio);
}

// ── respostas ───────────────────────────────────────────────────────────────────────────────

const vazio = (v: Resposta["valor"] | undefined) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

/** A resposta de uma pergunta como aparece na ação e no Notion (o casamento sem o prefixo do quadro). */
export function textoDaResposta(p: Pergunta, r: Resposta | undefined): string {
  if (r?.nao_temos && p.aceita_nao_temos) return "ainda não temos";
  const v = r?.valor;
  if (vazio(v)) return "—";
  if (p.tipo === "casamento" && typeof v === "string") return casalDoTitulo(v) || v.trim();
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

/** "Lucas e William" → ["Lucas", "William"]; sem as duas pessoas claras, null (igual à janela do TTARS). */
export function pessoasDoCasal(casal: string | null | undefined): [string, string] | null {
  // O que vem entre parênteses ("(exemplo)", "(Cancún)") não é nome de ninguém (igual ao TTARS).
  const partes = (casal ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim()
    .split(/\s+(?:e|&)\s+/i)
    .map((p) => p.trim());
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  return [partes[0], partes[1]];
}

/** As duas pessoas do casal de um pedido: pelo casamento escolhido (como a janela do TTARS), senão pela
 *  resposta que preenche o casal. */
export function casalDoPedido(perguntas: Pergunta[], respostas: Record<string, Resposta>, cardTitulo: string | null | undefined): [string, string] | null {
  return pessoasDoCasal(casalDoTitulo(cardTitulo)) ?? pessoasDoCasal(respostaQuePreenche(perguntas, respostas, "casal"));
}

/** O rótulo como quem lê vê: o Instagram de cada pessoa do casal vira "Instagram de <nome>". */
export function rotuloDaPergunta(p: Pergunta, casal: [string, string] | null): string {
  if (p.tipo === "instagram" && p.pessoa && casal) return `Instagram de ${casal[p.pessoa - 1]}`;
  return p.rotulo;
}

/** A descrição: quem pediu e quando (dd/mm de Brasília) e uma linha por pergunta (resposta de várias linhas
 *  fica numa só, separada por " · "). Fica de fora o que já está escrito: quem preenche (1ª linha) e o
 *  casamento quando o nome do casal já vem numa pergunta. Rótulo que é pergunta perde o "?" antes do ":". */
export function descricaoDoPedido(
  perguntas: Pergunta[],
  respostas: Record<string, Resposta>,
  quem: string,
  diaMes: string,
  cardTitulo?: string | null,
): string {
  return [linhaDePedido(quem, diaMes), ...linhasDasRespostas(perguntas, respostas, cardTitulo).map((l) => l.linha)].join("\n");
}

/** Uma linha "Rótulo: resposta" por pergunta da descrição (o rótulo sem o "?" do fim). */
function linhasDasRespostas(perguntas: Pergunta[], respostas: Record<string, Resposta>, cardTitulo?: string | null) {
  const numaLinha = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" · ");
  const casal = casalDoPedido(perguntas, respostas, cardTitulo);
  const temNomeDoCasal = !!respostaQuePreenche(perguntas, respostas, "casal");
  return perguntas
    .filter((p) => p.tipo !== "automatico_quem_pede" && !(p.tipo === "casamento" && temNomeDoCasal))
    .map((p) => {
      const rotulo = rotuloDaPergunta(p, casal).replace(/\s*\?+\s*$/, "");
      return { id: p.id, rotulo, linha: `${rotulo}: ${numaLinha(textoDaResposta(p, respostas[p.id]))}` };
    });
}

export const linhaDePedido = (quem: string, diaMes: string) => `Pedido por ${quem} pelo TTARS, ${diaMes}`;

/**
 * A descrição depois de completar as respostas (mesma montagem, com a 1ª linha do dia em que foi pedido).
 * Nada que alguém escreveu se perde: o que veio depois do bloco do pedido (ex.: a nota do marketing na
 * coluna Text do Notion) fica; se o bloco foi mexido, troca só a linha de cada resposta que mudou (achada
 * pelo rótulo) e a que não achar vai no fim.
 */
export function descricaoAtualizada(
  atual: string | null | undefined,
  perguntas: Pergunta[],
  antes: Record<string, Resposta>,
  depois: Record<string, Resposta>,
  quem: string,
  diaMes: string,
  cardTitulo?: string | null,
): string {
  const velha = descricaoDoPedido(perguntas, antes, quem, diaMes, cardTitulo);
  const nova = descricaoDoPedido(perguntas, depois, quem, diaMes, cardTitulo);
  const texto = (atual ?? "").replace(/\r\n/g, "\n");
  if (!texto.trim() || texto === velha) return nova;
  if (texto.startsWith(`${velha}\n`)) return nova + texto.slice(velha.length);
  const linhas = texto.split("\n");
  const eram = linhasDasRespostas(perguntas, antes, cardTitulo);
  for (const n of linhasDasRespostas(perguntas, depois, cardTitulo)) {
    const a = eram.find((x) => x.id === n.id);
    if (a?.linha === n.linha) continue;
    let i = a ? linhas.findIndex((l) => l.trim() === a.linha) : -1;
    if (i < 0) i = linhas.findIndex((l) => l.startsWith(`${(a ?? n).rotulo}:`));
    if (i >= 0) linhas[i] = n.linha;
    else linhas.push(n.linha);
  }
  return linhas.join("\n");
}

/** Os rótulos (como quem lê vê) das respostas que mudaram, sem quem pede e o casamento (o servidor preenche). */
export function respostasQueMudaram(
  perguntas: Pergunta[],
  antes: Record<string, Resposta>,
  depois: Record<string, Resposta>,
  cardTitulo?: string | null,
): string[] {
  const casal = casalDoPedido(perguntas, depois, cardTitulo);
  return perguntas
    .filter((p) => p.tipo !== "automatico_quem_pede" && p.tipo !== "casamento")
    .filter((p) => textoDaResposta(p, antes[p.id]) !== textoDaResposta(p, depois[p.id]))
    .map((p) => rotuloDaPergunta(p, casal));
}

/** O prazo da ação (AAAA-MM-DD de Brasília) pelo destino do formulário (sem a data que ele usa: sem prazo). */
export function prazoDoPedido(destino: Destino, perguntas: Pergunta[], respostas: Record<string, Resposta>, agora: Date): string | null {
  const prazo = destino.prazo;
  const dia = (v: unknown) => (typeof v === "string" && DIA.test(v) ? v : null);
  if (prazo.tipo === "dias") return maisDiasBR(prazo.dias ?? 0, agora);
  if (prazo.tipo === "pergunta") return prazo.pergunta_id ? dia(respostas[prazo.pergunta_id]?.valor) : null;
  if (prazo.tipo === "data_casamento" || prazo.tipo === "dias_do_casamento") {
    const casamento = dia(respostaQuePreenche(perguntas, respostas, "data_casamento"));
    if (!casamento || prazo.tipo === "data_casamento") return casamento;
    // Conta no calendário a partir do dia do casamento (meio-dia de Brasília: nunca escorrega de dia).
    return maisDiasBR(prazo.dias ?? 0, `${casamento}T12:00:00-03:00`);
  }
  return null;
}

/** O prazo depende só das respostas (pergunta de data ou dia do casamento), não do dia em que foi pedido. */
export const prazoVemDasRespostas = (d: Destino) =>
  d.prazo.tipo === "pergunta" || d.prazo.tipo === "data_casamento" || d.prazo.tipo === "dias_do_casamento";

/** Encerrado (feito ou cancelado): quem pediu não completa mais as respostas, só comenta. */
export function pedidoEncerrado(status: string | null | undefined, statusNotion: string | null | undefined): boolean {
  return status === "concluida" || status === "cancelada" || (statusNotion ?? "").trim().toLowerCase() === "done";
}

/** Título do card sem os prefixos do quadro ("DW |", "DW l", "EW |", "W -", "Elopement |"; igual ao TTARS). */
export function casalDoTitulo(titulo: string | null | undefined): string {
  return (titulo ?? "")
    .replace(/^\s*(?:DW|EW|W|Elopement)\s*(?:\||-|–|l(?=\s))\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── situação ────────────────────────────────────────────────────────────────────────────────

/** Ação sem página no Notion ainda: o nome de lá que quer dizer a mesma coisa. */
const DO_ACOES_PARA_NOTION: Record<string, string> = {
  aberta: "Not started",
  em_andamento: "In progress",
  aguardando_aprovacao: "In approval",
  concluida: "Done",
};

/** A situação do pedido CRUA (quem traduz é a tela do TTARS, num lugar só): "cancelada", o nome do Notion
 *  quando a página existe ("Not started", "This Week"…), senão o nome de lá que equivale à situação da ação. */
export function situacaoDoPedido(status: string, statusNotion: string | null): string {
  if (status === "cancelada") return "cancelada";
  if (statusNotion?.trim()) return statusNotion.trim();
  return DO_ACOES_PARA_NOTION[status] ?? "Not started";
}

/** Só para o texto do erro de repetido (a tela usa o mesmo mapa, com as palavras da página aprovada). */
export function situacaoEmPortugues(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const m: Record<string, string> = {
    "not started": "Ainda não começou",
    "up next": "Próxima",
    "this week": "Esta semana",
    "in progress": "Fazendo",
    "in approval": "Esperando aprovação",
    "to day": "Hoje",
    today: "Hoje",
    daily: "Todo dia",
    locked: "Travada",
    done: "Feito",
    cancelada: "Cancelado",
    canceled: "Cancelado",
  };
  return m[t.toLowerCase()] ?? (t || "Ainda não começou");
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

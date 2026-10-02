// Assistente do Ações (TTARS): as regras puras — o retrato que o modelo lê, o que muda na
// hora e o que espera "Confirmar", e como desfazer. Testadas em agente-regras.test.ts.
//
// Regra (Vitor, 28/09/2026: "eu já pedi! qualquer coisa desfaz"): pedir já é a autorização.
// Tudo muda na hora, com Desfazer, inclusive ação que outra pessoa criou e muitas de uma vez.
// Só espera Confirmar trocar quem faz numa ação que outra pessoa criou: depois disso quem
// pediu pode perder o acesso a ela, e o Desfazer não alcança. Nunca apaga: desistir é cancelar.
import { dataCurtaBR, diaBR, ehDataValida, fimDoDiaBR } from "./data-br";
import type { Tarefa } from "./queries";
import { slugNome } from "./compartilhar";

export type Situacao = "aberta" | "em_andamento" | "aguardando_aprovacao" | "concluida" | "cancelada";
export const SITUACOES: Situacao[] = ["aberta", "em_andamento", "aguardando_aprovacao", "concluida", "cancelada"];
export const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;

const ROTULO_SITUACAO: Record<Situacao, string> = {
  aberta: "aberta",
  em_andamento: "em andamento",
  aguardando_aprovacao: "aguardando aprovação",
  concluida: "concluída",
  cancelada: "cancelada",
};

/** A tarefa como a tela a entrega (do ponto de vista de quem vê). */
export type TarefaVista = Tarefa & {
  compartilhada?: boolean;
  criador_nome?: string | null;
  projetos?: { id: string; nome: string }[];
  time_nome?: string | null;
  objetivo?: { id: string; nome: string } | null;
  reuniao_rotulo?: string | null;
  /** Quem vê está em "também fazem" (subresponsável). */
  faco_tambem?: boolean;
};

/** Pedido que o navegador refaz sozinho (Desfazer, Confirmar): sempre uma rota do Ações. */
export type Pedido = { metodo: "PATCH" | "DELETE" | "POST" | "PUT"; caminho: string; corpo?: Record<string, unknown> };

export function quemFazNaTela(t: TarefaVista): string {
  // Da lista de outra pessoa e não passada a quem vê: o "executar" é de quem criou, nunca "você".
  if (t.acao === "executar" && (!t.compartilhada || t.is_mine)) return "você";
  const principal = (t.pessoas ?? []).find((p) => (p as { principal?: boolean }).principal)?.nome;
  if (principal) return principal;
  const o = (t.owner ?? "").trim();
  return !o || o === "?" || o === "eu" ? "a definir" : o;
}

const TIPO: Record<string, string> = { executar: "eu faço", cobrar: "eu cobro", aguardar: "só aguardo" };

/** O papel de quem pergunta. Na ação da lista de outra pessoa que não foi passada a ela, o "cobrar" é de quem
 *  criou: sem isso, "o que estou cobrando?" trazia as ações dos colegas (ensaio de 02/10/2026). */
function papel(t: TarefaVista): string {
  if (t.compartilhada && !t.is_mine) return t.faco_tambem ? "faço junto" : "da lista de quem criou";
  return TIPO[t.acao] ?? t.acao;
}

export function diaDoPrazo(prazo: string | null | undefined): string | null {
  return prazo && ehDataValida(prazo) ? diaBR(prazo) : null;
}

/** Quando vence, já calculado (o modelo erra conta de data): "atrasada 2 dias", "hoje", "amanhã",
 *  "esta semana", "semana que vem", "depois" ou null sem prazo. Semana termina no domingo. */
export function quandoVence(prazo: string | null | undefined, hoje: string): string | null {
  const dia = diaDoPrazo(prazo);
  if (!dia) return null;
  const dias = Math.round((Date.parse(`${dia}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
  if (dias < 0) return dias === -1 ? "atrasada 1 dia" : `atrasada ${-dias} dias`;
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const ateDomingo = dow === 0 ? 0 : 7 - dow;
  if (dias <= ateDomingo) return "esta semana";
  if (dias <= ateDomingo + 7) return "semana que vem";
  return "depois";
}

/** Linha compacta da tarefa pro modelo. `ref` curto (t1, t2…) no lugar do id. `quemFazSouEu`: o nome de quem faz é
 *  o de quem pergunta (ação da lista de um colega com "Vitor" como quem faz vira "você"). */
export function linhaDoRetrato(ref: string, t: TarefaVista, hoje?: string, quemFazSouEu = false) {
  const fechada = t.status === "concluida" || t.status === "cancelada";
  return {
    ref,
    titulo: t.titulo,
    quem_faz: quemFazSouEu ? "você" : quemFazNaTela(t),
    tipo: papel(t),
    prazo: diaDoPrazo(t.prazo),
    ...(hoje && !fechada ? { vence: quandoVence(t.prazo, hoje) } : {}),
    situacao: ROTULO_SITUACAO[t.status as Situacao] ?? t.status,
    prioridade: t.prioridade,
    ...(t.projetos?.length ? { projetos: t.projetos.map((p) => p.nome) } : {}),
    ...(t.reuniao_rotulo ? { reuniao: t.reuniao_rotulo.slice(0, 80) } : {}),
    ...(t.compartilhada ? { criada_por: t.criador_nome ?? "colega" } : {}),
    ...(t.time_nome ? { time: t.time_nome } : {}),
    ...(t.objetivo ? { objetivo: t.objetivo.nome } : {}),
  };
}

/** Quem criou a tarefa é quem pede? (só ele apaga e só ele troca quem faz sem Confirmar) */
export const ehMinha = (t: TarefaVista) => !t.compartilhada;

export type Mudanca = {
  titulo: string | null;
  descricao: string | null;
  /** AAAA-MM-DD, "remover" ou null (não mexe). */
  prazo: string | null;
  prioridade: string | null;
  situacao: string | null;
  /** "eu faço", "eu cobro" ou "só aguardo" (o papel de quem criou a ação). */
  papel?: string | null;
};

const ACAO_DO_PAPEL: Record<string, Tarefa["acao"]> = { "eu faço": "executar", "eu cobro": "cobrar", "só aguardo": "aguardar" };

export type Montada = { corpo: Record<string, unknown>; desfazer: Record<string, unknown>; partes: string[] } | { erro: string };

/** Mudança pedida → corpo do PATCH, o corpo que desfaz e o texto do que muda. Não trata "quem". */
export function montarMudanca(t: TarefaVista, m: Mudanca): Montada {
  const corpo: Record<string, unknown> = {};
  const desfazer: Record<string, unknown> = {};
  const partes: string[] = [];
  if (m.titulo != null) {
    const titulo = m.titulo.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!titulo) return { erro: "título vazio" };
    if (titulo !== t.titulo) {
      corpo.titulo = titulo;
      desfazer.titulo = t.titulo;
      partes.push(`título agora é "${titulo}"`);
    }
  }
  if (m.descricao != null) {
    const d = m.descricao.trim() || null;
    corpo.descricao = d;
    desfazer.descricao = t.descricao ?? null;
    partes.push(d ? "descrição nova" : "sem descrição");
  }
  if (m.prazo != null) {
    if (m.prazo === "remover") {
      corpo.prazo = null;
      partes.push("sem prazo");
    } else {
      const fim = fimDoDiaBR(m.prazo);
      if (!fim) return { erro: `prazo inválido: ${m.prazo}` };
      corpo.prazo = fim;
      partes.push(`prazo ${dataCurtaBR(fim)}`);
    }
    corpo.prazo_text = null;
    desfazer.prazo = t.prazo ?? null;
    desfazer.prazo_text = t.prazo_text ?? null;
  }
  if (m.prioridade != null) {
    if (!(PRIORIDADES as readonly string[]).includes(m.prioridade)) return { erro: `prioridade inválida: ${m.prioridade}` };
    corpo.prioridade = m.prioridade;
    desfazer.prioridade = t.prioridade;
    partes.push(`prioridade ${m.prioridade === "media" ? "média" : m.prioridade}`);
  }
  if (m.situacao != null) {
    if (!SITUACOES.includes(m.situacao as Situacao)) return { erro: `situação inválida: ${m.situacao}` };
    if (m.situacao !== t.status) {
      corpo.status = m.situacao;
      desfazer.status = t.status;
      partes.push(ROTULO_SITUACAO[m.situacao as Situacao]);
    }
  }
  if (m.papel != null) {
    const acao = ACAO_DO_PAPEL[m.papel];
    if (!acao) return { erro: `papel inválido: ${m.papel}` };
    if (acao !== t.acao) {
      corpo.acao = acao;
      // "eu faço" passa a ação para quem criou: o Desfazer devolve também quem fazia.
      Object.assign(desfazer, { acao: t.acao, owner: t.owner });
      partes.push(m.papel);
    }
  }
  return { corpo, desfazer, partes };
}

/** O que precisa de "Confirmar" antes (ver regra no topo): só trocar quem faz numa ação de outra pessoa. */
export function precisaConfirmar(t: TarefaVista, corpo: Record<string, unknown>): boolean {
  return !ehMinha(t) && ["responsavel_email", "owner", "acao", "responsavel_user_id"].some((k) => k in corpo);
}

/** Desfazer a troca de quem faz: volta como estava gravado (só pra quem criou). */
export function desfazerQuem(t: TarefaVista): Record<string, unknown> {
  return { owner: t.owner, acao: t.acao, responsavel_user_id: t.responsavel_user_id ?? null };
}

export function tituloCurto(s: string, max = 70): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A mesma linha em texto corrido, para listas longas (o acervo): chave repetida em cada linha custaria o dobro. */
export function linhaCorrida(l: ReturnType<typeof linhaDoRetrato>, detalhe?: string | null): string {
  return [
    l.ref,
    l.titulo,
    `quem faz: ${l.quem_faz} (${l.tipo})`,
    l.prazo ? `prazo ${l.prazo}${l.vence ? `, ${l.vence}` : ""}` : null,
    l.situacao !== "aberta" ? l.situacao : null,
    l.reuniao ? `reunião: ${l.reuniao}` : null,
    l.criada_por ? `lista de ${l.criada_por}` : null,
    l.projetos ? `projeto: ${l.projetos.join(", ")}` : null,
    l.time ? `time: ${l.time}` : null,
    detalhe ? `detalhe: ${tituloCurto(detalhe, 110)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

// ── Memória entre perguntas (Vitor, 02/10/2026: "o assistente tá MUITO burro") ──────────
// A conversa mora no navegador e cada pergunta remonta o retrato do zero. O que apareceu na tela com
// cada resposta volta na pergunta seguinte (ids em `acoes`); sem isso, "você só mandou 8, manda todas"
// já não achava as ações que vieram de reuniões de colegas e o Assistente voltava para as 3 da lista.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids das ações que apareceram com as respostas anteriores, das mais novas para as mais velhas, sem repetir. */
export function idsDasFalas<F extends { quem: string; acoes?: unknown }>(falas: F[], max = 150): string[] {
  const ids = new Set<string>();
  for (let i = falas.length - 1; i >= 0; i--) {
    const { quem, acoes } = falas[i];
    if (quem !== "assistente" || !Array.isArray(acoes)) continue;
    for (const id of acoes) {
      if (ids.size >= max) return [...ids];
      if (typeof id === "string" && UUID_RE.test(id)) ids.add(id.toLowerCase());
    }
  }
  return [...ids];
}

/** A resposta anterior como o modelo a relê: no fim, as refs do que apareceu na tela com ela. */
export function anotarNaTela(texto: string, refs: string[]): string {
  return refs.length ? `${texto}\n[na tela: ${refs.join(", ")}]` : texto;
}

/** Rede de segurança: nem a marca [na tela: …] (se o modelo imitar) nem ref interna (t3, p1) chegam à pessoa. */
export function limparRefs(texto: string): string {
  return texto
    .replace(/\s*[[(]na tela:[^\])]*[\])]/gi, "")
    .replace(/\s*[[(](?:[tpr]\d+(?:\s*,\s*)?)+[\])]/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

// ── Limite de pessoa na procura (Vitor, 02/10/2026: "Que porra é essa") ──────────────────
// "Tem algumas reuniões que falei em fazer coisas no CRM" virava "só as que o Vitor faz, da lista dele": 24 das 237
// ações entravam na escolha e voltavam 4, quando o assunto tem mais de 50. Filtro de pessoa só vale com as palavras
// dela que limitam; "o que falei, falamos ou combinamos nas reuniões" é o assunto, de qualquer pessoa.

const PALAVRAS_QUE_LIMITAM = [
  /\b(?:minhas?|meus?)\b(?! (?:reunioes|reuniao|times?|projetos?|areas?)\b)/, // "só as minhas", "algo meu"; não "minhas reuniões"
  /\b(?:comigo|pra mim|para mim|de mim|a mim|meu nome|sou eu|sou responsavel)\b/,
  /\b(?:me devem?|devo|devemos|atribuid[oa]s?|prometi|prometemos|fiquei de|fico de)\b/,
  /\beu (?:faco|fiz|faria|preciso|vou|tenho que)\b/,
  /\b(?:dos|de) (?:outros|colegas)\b|\boutras? pessoas?\b/,
];

const palavrasDe = (s: string | null | undefined) => slugNome(s).replace(/-/g, " ");

/** As palavras limitam a procura por pessoa ("só as minhas", "o que eu devo ao Tiago", "com o meu nome", um nome)? */
export function limitaPorPessoa(palavras: string | null | undefined, nomes: string[]): boolean {
  const s = palavrasDe(palavras);
  if (!s) return false;
  if (PALAVRAS_QUE_LIMITAM.some((re) => re.test(s))) return true;
  const primeiros = new Set(nomes.map((n) => slugNome(n).split("-")[0]).filter((x) => x.length >= 3));
  return s.split(" ").some((p) => primeiros.has(p));
}

/** As palavras que o modelo citou estão numa fala da pessoa (fora de ordem, sem acento e pontuação, vale)? */
export function ditoPelaPessoa(palavras: string | null | undefined, falas: string[]): boolean {
  const ditas = palavrasDe(palavras).split(" ").filter(Boolean);
  return ditas.length > 0 && falas.some((f) => {
    const naFala = new Set(palavrasDe(f).split(" "));
    return ditas.every((p) => naFala.has(p));
  });
}

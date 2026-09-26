// Assistente do Ações (TTARS): as regras puras — o retrato que o modelo lê, o que muda na
// hora e o que espera "Confirmar", e como desfazer. Testadas em agente-regras.test.ts.
//
// Regra (pedido do Vitor, 26/09/2026, e o mesmo desenho do Coach): a tarefa que a pessoa
// criou muda na hora, com Desfazer; tarefa de outra pessoa, ou mais de 3 conclusões ou
// cancelamentos de uma vez, espera Confirmar. Nunca apaga: desistir é cancelar.
import { dataCurtaBR, diaBR, ehDataValida, fimDoDiaBR } from "./data-br";
import type { Tarefa } from "./queries";

export type Situacao = "aberta" | "em_andamento" | "aguardando_aprovacao" | "concluida" | "cancelada";
export const SITUACOES: Situacao[] = ["aberta", "em_andamento", "aguardando_aprovacao", "concluida", "cancelada"];
export const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
export const LOTE_SEM_CONFIRMAR = 3;

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
  reuniao_rotulo?: string | null;
};

/** Pedido que o navegador refaz sozinho (Desfazer, Confirmar): sempre uma rota do Ações. */
export type Pedido = { metodo: "PATCH" | "DELETE" | "POST"; caminho: string; corpo?: Record<string, unknown> };

export function quemFazNaTela(t: TarefaVista): string {
  if (t.acao === "executar") return "você";
  const principal = (t.pessoas ?? []).find((p) => (p as { principal?: boolean }).principal)?.nome;
  if (principal) return principal;
  const o = (t.owner ?? "").trim();
  return !o || o === "?" || o === "eu" ? "a definir" : o;
}

const TIPO: Record<string, string> = { executar: "eu faço", cobrar: "eu cobro", aguardar: "só aguardo" };

export function diaDoPrazo(prazo: string | null | undefined): string | null {
  return prazo && ehDataValida(prazo) ? diaBR(prazo) : null;
}

/** Linha compacta da tarefa pro modelo. `ref` curto (t1, t2…) no lugar do id. */
export function linhaDoRetrato(ref: string, t: TarefaVista) {
  return {
    ref,
    titulo: t.titulo,
    quem_faz: quemFazNaTela(t),
    tipo: TIPO[t.acao] ?? t.acao,
    prazo: diaDoPrazo(t.prazo),
    situacao: ROTULO_SITUACAO[t.status as Situacao] ?? t.status,
    prioridade: t.prioridade,
    ...(t.projetos?.length ? { projetos: t.projetos.map((p) => p.nome) } : {}),
    ...(t.reuniao_rotulo ? { reuniao: t.reuniao_rotulo.slice(0, 80) } : {}),
    ...(t.compartilhada ? { criada_por: t.criador_nome ?? "colega" } : {}),
  };
}

/** Quem criou a tarefa é quem pede? (só o criador muda sem confirmar e só ele apaga) */
export const ehMinha = (t: TarefaVista) => !t.compartilhada;

export type Mudanca = {
  titulo: string | null;
  descricao: string | null;
  /** AAAA-MM-DD, "remover" ou null (não mexe). */
  prazo: string | null;
  prioridade: string | null;
  situacao: string | null;
};

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
  return { corpo, desfazer, partes };
}

/** O que precisa de "Confirmar" antes (ver regra no topo). */
export function precisaConfirmar(t: TarefaVista, corpo: Record<string, unknown>, fechandoNoLote: number): boolean {
  if (!ehMinha(t)) return true;
  const fecha = corpo.status === "concluida" || corpo.status === "cancelada";
  return fecha && fechandoNoLote > LOTE_SEM_CONFIRMAR;
}

/** Desfazer a troca de quem faz: volta como estava gravado (só pra quem criou). */
export function desfazerQuem(t: TarefaVista): Record<string, unknown> {
  return { owner: t.owner, acao: t.acao, responsavel_user_id: t.responsavel_user_id ?? null };
}

export function tituloCurto(s: string, max = 70): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

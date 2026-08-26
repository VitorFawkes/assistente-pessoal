// Lógica da experiência nova do Quadro: as 4 situações, filtros, ordenação e
// agrupamento. Tudo puro (sem React, sem banco) pra poder testar sozinho.
import type { Tarefa } from "./queries";

export type Situacao = "aberta" | "em_andamento" | "aguardando_aprovacao" | "concluida";

export const SITUACOES: { valor: Situacao; rotulo: string }[] = [
  { valor: "aberta", rotulo: "A fazer" },
  { valor: "em_andamento", rotulo: "Fazendo" },
  { valor: "aguardando_aprovacao", rotulo: "Aguardando aprovação" },
  { valor: "concluida", rotulo: "Feito" },
];

/** Ordem das colunas no Kanban — decisão do Vitor (21/08/2026). */
export const ORDEM_KANBAN: Situacao[] = ["aberta", "em_andamento", "aguardando_aprovacao", "concluida"];

export const rotuloSituacao = (s: string): string =>
  SITUACOES.find((x) => x.valor === s)?.rotulo ?? "A fazer";

export type FaixaPrazo = "vencida" | "hoje" | "semana" | "depois" | "semprazo" | "feito";

export function faixaDoPrazo(t: Tarefa, agora = new Date()): FaixaPrazo {
  if (t.status === "concluida") return "feito";
  if (!t.prazo) return "semprazo";
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const d = new Date(t.prazo);
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((dia.getTime() - hoje.getTime()) / 86_400_000);
  if (dias < 0) return "vencida";
  if (dias === 0) return "hoje";
  if (dias <= 7) return "semana";
  return "depois";
}

export const donoDe = (t: Tarefa): string | null =>
  t.pessoas.find((p) => p.principal)?.nome ?? null;

export const relacionadasDe = (t: Tarefa): string[] =>
  t.pessoas.filter((p) => !p.principal).map((p) => p.nome);

export const envolve = (t: Tarefa, nome: string): boolean =>
  nome === "__sem__" ? !donoDe(t) : t.pessoas.some((p) => p.nome === nome);

export type Filtros = {
  busca: string;
  prazo: FaixaPrazo | "todas";
  pessoa: string;
  tema: string;
  situacao: string;
  reuniao: string;
  anexos: "" | "com" | "sem";
  concluidas: boolean;
};

export const FILTROS_VAZIOS: Filtros = {
  busca: "",
  prazo: "todas",
  pessoa: "",
  tema: "",
  situacao: "",
  reuniao: "",
  anexos: "",
  concluidas: true,
};

export const temFiltro = (f: Filtros): boolean =>
  !!f.busca || f.prazo !== "todas" || !!f.pessoa || !!f.tema || !!f.situacao ||
  !!f.reuniao || !!f.anexos || !f.concluidas;

const textoDe = (t: Tarefa): string =>
  [t.titulo, t.descricao, t.depende_de, t.frente, t.owner,
   t.pessoas.map((p) => p.nome).join(" "), t.meeting_summary]
    .filter(Boolean).join(" ").toLowerCase();

/** Passa nos filtros? `ignorar` deixa um filtro de fora (pra contar os chips). */
export function passa(t: Tarefa, f: Filtros, agora = new Date(), ignorar?: keyof Filtros): boolean {
  if (ignorar !== "concluidas" && !f.concluidas && t.status === "concluida") return false;
  if (ignorar !== "prazo" && f.prazo !== "todas" && faixaDoPrazo(t, agora) !== f.prazo) return false;
  if (ignorar !== "pessoa" && f.pessoa && !envolve(t, f.pessoa)) return false;
  if (ignorar !== "tema" && f.tema && (t.frente ?? "") !== f.tema) return false;
  if (ignorar !== "situacao" && f.situacao && t.status !== f.situacao) return false;
  if (ignorar !== "reuniao" && f.reuniao) {
    if (f.reuniao === "__mao__") { if (t.meeting_id) return false; }
    else if (t.meeting_id !== f.reuniao) return false;
  }
  if (ignorar !== "anexos" && f.anexos) {
    const tem = t.anexos.length > 0;
    if (f.anexos === "com" && !tem) return false;
    if (f.anexos === "sem" && tem) return false;
  }
  if (ignorar !== "busca" && f.busca && !textoDe(t).includes(f.busca.toLowerCase())) return false;
  return true;
}

export type Ordenacao =
  | "manual" | "prazo" | "prazo_desc" | "pessoa" | "tema" | "situacao"
  | "reuniao" | "titulo" | "recentes";

const PESO_SITUACAO: Record<string, number> = {
  em_andamento: 0, aguardando_aprovacao: 1, aberta: 2, concluida: 3, cancelada: 4,
};

const quandoVence = (t: Tarefa): number =>
  t.prazo ? new Date(t.prazo).getTime() : Number.POSITIVE_INFINITY;

export function comparar(a: Tarefa, b: Tarefa, ordem: Ordenacao): number {
  const semA = !a.prazo, semB = !b.prazo;
  switch (ordem) {
    case "manual": {
      const ma = a.quadro_ordem ?? a.ordem ?? 0;
      const mb = b.quadro_ordem ?? b.ordem ?? 0;
      return ma !== mb ? ma - mb : quandoVence(a) - quandoVence(b);
    }
    case "prazo_desc":
      if (semA !== semB) return semA ? 1 : -1;   // sem prazo sempre no fim
      return quandoVence(b) - quandoVence(a);
    case "pessoa": {
      const pa = donoDe(a) ?? "zzz", pb = donoDe(b) ?? "zzz";
      return pa !== pb ? pa.localeCompare(pb, "pt-BR") : quandoVence(a) - quandoVence(b);
    }
    case "tema": {
      const ta = a.frente ?? "zzz", tb = b.frente ?? "zzz";
      return ta !== tb ? ta.localeCompare(tb, "pt-BR") : quandoVence(a) - quandoVence(b);
    }
    case "situacao": {
      const sa = PESO_SITUACAO[a.status] ?? 9, sb = PESO_SITUACAO[b.status] ?? 9;
      return sa !== sb ? sa - sb : quandoVence(a) - quandoVence(b);
    }
    case "reuniao": {
      const ra = a.meeting_recorded_at ?? "zzz", rb = b.meeting_recorded_at ?? "zzz";
      return ra !== rb ? ra.localeCompare(rb) : quandoVence(a) - quandoVence(b);
    }
    case "titulo":
      return a.titulo.localeCompare(b.titulo, "pt-BR");
    case "recentes":
      return b.created_at.localeCompare(a.created_at);
    default: // prazo: mais antiga primeiro, sem prazo no fim
      if (semA !== semB) return semA ? 1 : -1;
      return quandoVence(a) - quandoVence(b);
  }
}

export type VerPor = "nada" | "situacao" | "pessoa" | "prazo" | "tema";

export type Grupo = { chave: string; rotulo: string; nota?: string; tarefas: Tarefa[] };

const ROTULO_PRAZO: Record<FaixaPrazo, string> = {
  vencida: "Atrasadas", hoje: "Hoje", semana: "Esta semana",
  depois: "Depois", semprazo: "Sem prazo", feito: "Feitas",
};

/** Agrupa mantendo a ordem já aplicada na lista. Ninguém some: sem dono e sem
 *  tema viram grupo próprio. */
export function agrupar(tarefas: Tarefa[], modo: VerPor, agora = new Date()): Grupo[] {
  if (modo === "nada") return [{ chave: "tudo", rotulo: "Todas as tarefas", tarefas }];

  const mapa = new Map<string, Grupo>();
  const põe = (chave: string, rotulo: string, t: Tarefa, nota?: string) => {
    if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo, nota, tarefas: [] });
    mapa.get(chave)!.tarefas.push(t);
  };

  for (const t of tarefas) {
    if (modo === "situacao") põe(t.status, rotuloSituacao(t.status), t);
    else if (modo === "pessoa") {
      const d = donoDe(t);
      põe(d ?? "__sem__", d ?? "Sem dono", t, d ? undefined : "alguém precisa puxar");
    } else if (modo === "tema") {
      const tema = t.frente;
      põe(tema ?? "__sem__", tema ?? "Sem tema", t, tema ? undefined : "escreva um tema pra organizar");
    } else {
      const faixa = faixaDoPrazo(t, agora);
      põe(faixa, ROTULO_PRAZO[faixa], t,
        faixa === "vencida" ? "resolver ou reagendar" : faixa === "semprazo" ? "definir uma data tira daqui" : undefined);
    }
  }

  const grupos = [...mapa.values()];
  if (modo === "situacao") {
    grupos.sort((a, b) => ORDEM_KANBAN.indexOf(a.chave as Situacao) - ORDEM_KANBAN.indexOf(b.chave as Situacao));
  } else if (modo === "prazo") {
    const ordem: FaixaPrazo[] = ["vencida", "hoje", "semana", "depois", "semprazo", "feito"];
    grupos.sort((a, b) => ordem.indexOf(a.chave as FaixaPrazo) - ordem.indexOf(b.chave as FaixaPrazo));
  } else {
    grupos.sort((a, b) =>
      a.chave === "__sem__" ? 1 : b.chave === "__sem__" ? -1 : a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }
  return grupos;
}

/** No Kanban toda coluna aparece, mesmo vazia. */
export function colunasKanban(tarefas: Tarefa[]): Grupo[] {
  const porStatus = agrupar(tarefas, "situacao");
  return ORDEM_KANBAN.map(
    (s) => porStatus.find((g) => g.chave === s) ?? { chave: s, rotulo: rotuloSituacao(s), tarefas: [] },
  );
}

// ── Como o quadro fala de gente e de data ──────────────────────────────

const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const dd = (n: number) => String(n).padStart(2, "0");

/** "sex 14/08" */
export function dataCurta(iso: string): string {
  const d = new Date(iso);
  return `${DIA_CURTO[d.getDay()]} ${dd(d.getDate())}/${dd(d.getMonth() + 1)}`;
}

/** O selo de prazo do quadro, na fala do rascunho: "venceu sex 14/08",
 *  "hoje, qui 20/08", "amanhã, sex 21/08", "seg 24/08", "sem prazo". */
export function rotuloPrazo(t: Tarefa, agora = new Date()): string {
  if (t.status === "concluida")
    return t.concluida_em ? `feito ${dataCurta(t.concluida_em)}` : "feito";
  if (!t.prazo) return "sem prazo";
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const d = new Date(t.prazo);
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((dia.getTime() - hoje.getTime()) / 86_400_000);
  const curta = dataCurta(t.prazo);
  if (dias < 0) return `venceu ${curta}`;
  if (dias === 0) return `hoje, ${curta}`;
  if (dias === 1) return `amanhã, ${curta}`;
  return curta;
}

/** "GI" — as duas primeiras letras, como no rascunho. */
export const iniciais = (nome: string): string =>
  nome.trim().slice(0, 2).toUpperCase() || "—";

/** Classe da paleta de pessoa (p0..p7). A cor da pessoa só vive no avatar. */
export function corDaPessoa(nome: string | null | undefined): string {
  const n = (nome ?? "").trim().toLowerCase();
  if (!n) return "p-sem";
  let soma = 0;
  for (let i = 0; i < n.length; i++) soma = (soma * 31 + n.charCodeAt(i)) % 997;
  return `p${soma % 8}`;
}

export type PessoaDoQuadro = { nome: string; chave: string; abertas: number; atrasadas: number };

/** Quem está no quadro, com quantas tarefas abertas e quantas atrasadas.
 *  Conta como o rascunho: pelo dono, mais um balde de "Sem dono". */
export function pessoasDoQuadro(tarefas: Tarefa[], agora = new Date()): PessoaDoQuadro[] {
  const mapa = new Map<string, PessoaDoQuadro>();
  const põe = (chave: string, nome: string, t: Tarefa) => {
    if (!mapa.has(chave)) mapa.set(chave, { nome, chave, abertas: 0, atrasadas: 0 });
    const p = mapa.get(chave)!;
    if (t.status !== "concluida" && t.status !== "cancelada") p.abertas++;
    if (faixaDoPrazo(t, agora) === "vencida") p.atrasadas++;
  };
  for (const t of tarefas) {
    const d = donoDe(t);
    põe(d ?? "__sem__", d ?? "Sem dono", t);
  }
  const lista = [...mapa.values()];
  lista.sort((a, b) =>
    a.chave === "__sem__" ? 1 : b.chave === "__sem__" ? -1 : b.abertas - a.abertas,
  );
  return lista;
}

/** Os números da faixa de resumo: atrasadas, até sexta, fazendo e progresso. */
export function numerosDoQuadro(tarefas: Tarefa[], agora = new Date()) {
  let atrasadas = 0, ateSexta = 0, fazendo = 0, feitas = 0;
  for (const t of tarefas) {
    const faixa = faixaDoPrazo(t, agora);
    if (faixa === "vencida") atrasadas++;
    if (faixa === "hoje" || faixa === "semana") ateSexta++;
    if (t.status === "em_andamento") fazendo++;
    if (t.status === "concluida") feitas++;
  }
  return {
    atrasadas,
    ateSexta,
    fazendo,
    feitas,
    total: tarefas.length,
    porcento: tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0,
  };
}

// Reunião gravada no Teams → reunião do Ações (pedido do Vitor, 27/09/2026: "Se a pessoa gravar
// a reunião pelo teams, conseguimos que vá para o mesmo fluxo que se fosse pela aba do ttars?" e
// "Pode ser a opção 1, mas quem estava nela pode conseguir achar ela e ver as tarefas pra puxar").
//
// O TTARS lê o Teams (as contas Microsoft ligadas lá) e manda para cá; aqui a reunião nasce na
// conta de quem MARCOU, aberta só para quem estava nela. Regras puras, testadas em teams.test.ts.

export type Candidato = {
  /** Id do compromisso na agenda de quem marcou (cada ocorrência de reunião repetida tem o seu). */
  chave: string;
  organizador: string;
  convidados: string[];
  inicio: string;
  fim: string;
  assunto: string | null;
};

export type ContextoDaDecisao = {
  /** E-mails de quem usa o Ações (liberado pelo admin, ou admin). */
  liberados: Set<string>;
  /** E-mails das pessoas da Welcome (a lista do TTARS). */
  welcome: Set<string>;
  /** `organizador|chave` das reuniões do Teams que já estão aqui. */
  jaTem: Set<string>;
  /** Começo (ms) das gravações feitas pela aba ou pelo celular, por e-mail de quem gravou. */
  gravadasAqui: Map<string, number[]>;
};

// Gravação pela aba que começou até 15 min antes do horário marcado conta como a mesma reunião.
const FOLGA_DA_GRAVACAO_MS = 15 * 60_000;

export const normalizarEmail = (e: string | null | undefined) => String(e ?? "").trim().toLowerCase();

/** Quem da Welcome estava na reunião: quem marcou primeiro, depois os convidados. */
export function pessoasDaReuniao(c: Candidato, welcome: Set<string>): string[] {
  const todas = [normalizarEmail(c.organizador), ...c.convidados.map(normalizarEmail)];
  return [...new Set(todas)].filter((e) => welcome.has(e));
}

export function decidir(c: Candidato, ctx: ContextoDaDecisao): { quero: boolean; motivo: string } {
  const org = normalizarEmail(c.organizador);
  if (!ctx.welcome.has(org)) return { quero: false, motivo: "quem marcou não é da Welcome" };
  if (!pessoasDaReuniao(c, ctx.welcome).some((e) => ctx.liberados.has(e))) {
    return { quero: false, motivo: "ninguém da reunião usa o Ações" };
  }
  if (ctx.jaTem.has(`${org}|${c.chave}`)) return { quero: false, motivo: "já está no Ações" };
  const inicio = Date.parse(c.inicio);
  const fim = Date.parse(c.fim);
  const gravou = (ctx.gravadasAqui.get(org) ?? []).some((t) => t >= inicio - FOLGA_DA_GRAVACAO_MS && t <= fim);
  if (gravou) return { quero: false, motivo: "quem marcou já gravou pelo Ações" };
  return { quero: true, motivo: "nova" };
}

// ── a transcrição do Teams (.vtt com o nome de quem fala) ──────────────────────────────────

export type Legenda = { criado: string; vtt: string };
export type Segmento = { speaker: string; start: number; end: number; text: string };
export type Conversa = {
  segments: Segmento[];
  /** Letra → nome, como a tela de "quem falou" guarda. */
  labels: Record<string, string>;
  /** "Nome: fala", uma fala por linha. */
  texto: string;
  duracao: number;
  letras: number;
};

const TEMPO = /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

function segundos(t: string): number {
  const partes = t.replace(",", ".").split(":").map(Number);
  return partes.reduce((acc, p) => acc * 60 + p, 0);
}

/** Nome como a Microsoft mostra, sem o que vem depois de "|" nem "(Convidado)". */
export function nomeLimpo(bruto: string): string {
  return bruto
    .replace(/\s*\|.*$/, "")
    .replace(/\s*\((?:convidado|convidada|guest|externo|externa|external|unverified)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Fala = { quem: string | null; inicio: number; fim: number; texto: string };

/** As falas de uma transcrição, com o tempo desde o começo DELA. */
export function lerLegenda(vtt: string): Fala[] {
  const falas: Fala[] = [];
  const blocos = vtt.replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/);
  for (const bloco of blocos) {
    const linhas = bloco.split("\n");
    const i = linhas.findIndex((l) => TEMPO.test(l));
    if (i < 0) continue;
    const m = TEMPO.exec(linhas[i])!;
    let corpo = linhas.slice(i + 1).join(" ").trim();
    if (!corpo) continue;
    let quem: string | null = null;
    const voz = /^<v(?:\.[^\s>]*)?\s+([^>]+)>/i.exec(corpo);
    if (voz) {
      quem = nomeLimpo(voz[1]) || null;
      corpo = corpo.slice(voz[0].length);
    }
    const texto = corpo.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!texto) continue;
    falas.push({ quem, inicio: segundos(m[1]), fim: segundos(m[2]), texto });
  }
  return falas;
}

function letra(n: number): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return n < 26 ? abc[n] : abc[Math.floor(n / 26) - 1] + abc[n % 26];
}

/**
 * Junta as transcrições da reunião (parou e voltou a gravar = mais de uma) numa conversa só:
 * a segunda começa na hora em que foi criada, contada desde a primeira. Cada nome vira uma
 * letra (a mesma forma da gravação pela aba), com o nome já escolhido.
 */
export function montarConversa(legendas: Legenda[]): Conversa {
  const ordem = [...legendas].sort((a, b) => a.criado.localeCompare(b.criado));
  const zero = ordem.length ? Date.parse(ordem[0].criado) : 0;
  const letraDe = new Map<string, string>();
  const labels: Record<string, string> = {};
  const segments: Segmento[] = [];
  let anterior: string | null = null;
  for (const l of ordem) {
    const desloc = Math.max(0, (Date.parse(l.criado) - zero) / 1000);
    for (const f of lerLegenda(l.vtt)) {
      // Fala sem nome continua de quem falava antes; no começo, vira "Participante".
      const nome = f.quem ?? (anterior ? labels[anterior] : "Participante");
      let sp = letraDe.get(nome);
      if (!sp) {
        sp = letra(letraDe.size);
        letraDe.set(nome, sp);
        labels[sp] = nome;
      }
      const start = Math.round((f.inicio + desloc) * 100) / 100;
      const end = Math.round((f.fim + desloc) * 100) / 100;
      const ultimo = segments[segments.length - 1];
      if (ultimo && ultimo.speaker === sp) {
        ultimo.end = Math.max(ultimo.end, end);
        ultimo.text += ` ${f.texto}`;
      } else {
        segments.push({ speaker: sp, start, end, text: f.texto });
      }
      anterior = sp;
    }
  }
  const texto = segments.map((s) => `${labels[s.speaker]}: ${s.text}`).join("\n");
  const falado = segments.reduce((n, s) => n + s.text.length, 0);
  return {
    segments,
    labels,
    texto,
    duracao: Math.round(segments.reduce((m, s) => Math.max(m, s.end), 0)),
    letras: falado,
  };
}

/** Conversa curta demais para virar reunião (gravou sem querer, ninguém falou). */
export const LETRAS_MINIMAS = 400;

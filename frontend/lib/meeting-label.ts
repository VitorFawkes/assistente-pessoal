// Nome curto e legível de uma reunião.
//
// O `summary` que a IA gera é um parágrafo e TODOS começam igual ("Reunião
// entre Vitor e…", "Reunião interna focada em…", "Conversa 1:1 entre Vitor
// e…"). Em qualquer lista, filtro ou chip o texto é cortado antes de chegar
// na parte que distingue uma reunião da outra — o resultado é uma coluna de
// itens visualmente idênticos. Aqui a abertura genérica é removida e sobra o
// assunto; a data entra junto porque é o que o usuário usa pra se localizar.

import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { SP_TZ } from "./utils";

// Só mexe em texto que COMEÇA com um substantivo de reunião — se o resumo já
// começar pelo assunto, não há abertura genérica pra tirar.
const ABRE_COM_REUNIAO = /^(reuni(ão|ao|ões|oes)|conversa|call|bate[- ]papo)\b/i;

// Marcadores que anunciam o assunto, do mais informativo pro menos. Só valem
// perto do começo (senão cortariam no meio do próprio assunto).
const MARCADORES: RegExp[] = [
  /\bfocad[ao]s?\s+(em|na|no|nas|nos)\s+/i,
  /\btratam?\s+de\s+/i,
  /\bsobre\s+/i,
  /\bpara\s+/i,
  /\bentre\s+/i,
  /\bcom\s+/i,
  /\bde\s+/i,
];
const ALCANCE_MARCADOR = 70;

// Artigos e sobras que ficam feios abrindo o rótulo.
const SOBRA_INICIAL = /^(uma?|os?|as?)\s+/i;

// Corta na primeira fronteira de oração — o assunto costuma estar na
// primeira. Vírgula NÃO corta: "marketing, qualificação de leads" é uma
// enumeração que ainda distingue a reunião.
const FRONTEIRA = /[.;]/;

const MIN_UTIL = 14;

function limpar(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Assunto da reunião sem a abertura genérica. Sem data — use
 * `meetingLabel` pra montar o rótulo completo.
 */
export function meetingSubject(summary: string | null | undefined): string {
  const base = limpar(summary ?? "");
  if (!base) return "";

  let s = base;
  if (ABRE_COM_REUNIAO.test(base)) {
    for (const re of MARCADORES) {
      const m = base.match(re);
      if (!m || m.index === undefined || m.index > ALCANCE_MARCADOR) continue;
      const resto = limpar(base.slice(m.index + m[0].length));
      if (resto.length >= MIN_UTIL) {
        s = resto;
        break;
      }
    }
  }

  s = limpar(s.replace(SOBRA_INICIAL, "")) || s;

  const corte = limpar(s.split(FRONTEIRA)[0]);
  if (corte.length >= MIN_UTIL) s = corte;

  if (!s) return base;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "10/ago" — curto o bastante pra caber junto do assunto. */
export function meetingDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, SP_TZ, "dd/MMM", { locale: ptBR }).replace(".", "");
}

/**
 * Rótulo de uma linha: "10/ago · Diagnóstico do outbound da Welcome".
 * É o que aparece em filtro, chip e cabeçalho de grupo.
 */
export function meetingLabel(
  summary: string | null | undefined,
  recordedAt: string | null | undefined,
  opts?: { semData?: boolean },
): string {
  const assunto = meetingSubject(summary) || "Reunião";
  const data = opts?.semData ? "" : meetingDateShort(recordedAt);
  return data ? `${data} · ${assunto}` : assunto;
}

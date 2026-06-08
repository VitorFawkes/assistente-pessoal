import type { Acao } from "./queries";

const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
const ACOES = ["executar", "cobrar", "aguardar"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

export type Confidence = (typeof CONFIDENCES)[number];

// O que o GPT devolve (cru, não confiável).
export type RawDraft = {
  titulo?: string;
  descricao?: string | null;
  owner?: string;
  acao?: string;
  prazo?: string | null;
  prazo_text?: string | null;
  prioridade?: string;
  area_raw?: string | null;
  pessoas?: string[];
  confidence?: string;
  confidence_rationale?: string;
};

export type CaptureDraft = {
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: Acao;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof PRIORIDADES)[number];
  area_raw: string | null;
  pessoas: string[];
  confidence: Confidence;
  confidence_rationale: string;
};

function oneOf<T extends readonly string[]>(list: T, v: unknown, dflt: T[number]): T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : dflt;
}

export function normalizeDraft(raw: RawDraft): CaptureDraft {
  return {
    titulo: (raw.titulo ?? "").trim(),
    descricao: raw.descricao?.trim() || null,
    owner: (raw.owner ?? "vitor").trim() || "vitor",
    acao: oneOf(ACOES, raw.acao, "executar"),
    prazo: raw.prazo ?? null,
    prazo_text: raw.prazo_text?.trim() || null,
    prioridade: oneOf(PRIORIDADES, raw.prioridade, "media"),
    area_raw: raw.area_raw?.trim() || null,
    pessoas: Array.isArray(raw.pessoas) ? raw.pessoas.map((p) => String(p).trim()).filter(Boolean) : [],
    confidence: oneOf(CONFIDENCES, raw.confidence, "low"),
    confidence_rationale: (raw.confidence_rationale ?? "").trim(),
  };
}

export function precisaRevisao(d: Pick<CaptureDraft, "confidence" | "prazo" | "prazo_text">): boolean {
  if (d.confidence !== "high") return true;
  if (d.prazo_text && !d.prazo) return true; // disse "semana que vem" mas não resolveu data
  return false;
}

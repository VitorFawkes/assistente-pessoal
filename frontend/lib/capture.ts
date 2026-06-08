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

export type CaptureCtx = {
  hoje: string; // "2026-06-08"
  tz: string; // "America/Sao_Paulo"
  frentes: { nome: string }[];
  owners: { name: string; is_me: boolean }[];
};

const CAPTURE_MODEL = process.env.CAPTURE_MODEL || "gpt-5.1";

const SYSTEM_PROMPT = `Você converte UMA frase solta do Vitor em UMA tarefa estruturada (JSON).

REGRAS:
- Extraia SÓ a tarefa principal. Se houver duas coisas, escolha a mais importante e ignore o resto.
- PRESERVE as palavras do Vitor no "titulo". NÃO parafraseie, não floreie. Tire data/pessoa/prioridade de DENTRO do título (elas viram campos), deixando o título enxuto. Ex.: "ligar pro contador sexta de manhã" → titulo "ligar pro contador" (NUNCA "Realizar contato telefônico com o contador").
- "acao": "executar" se o próprio Vitor faz (ou owner=vitor); "cobrar" se outra pessoa faz e o Vitor precisa acompanhar/cobrar; "aguardar" se outra pessoa faz sozinha e o Vitor não precisa cobrar. Na dúvida em delegação, use "cobrar".
- "owner": coerente com "acao". Se acao="executar", owner="vitor". Se acao="cobrar" ou "aguardar", owner é a PESSOA que vai executar (NUNCA "vitor") — use o nome citado, ou "?" se foi alguém sem nome.
- "prazo": resolva expressões em pt-BR relativas a HOJE (no fuso informado) pra ISO 8601 com hora 23:59 local; null se não houver prazo. "prazo_text": o texto literal dito ("sexta de manhã", "semana que vem").
- "prioridade": baixa/media/alta/urgente pelo tom ("hoje/agora/asap"→urgente; "amanhã/antes da call"→alta; default media; "talvez/algum dia"→baixa).
- "area_raw": escolha UM nome da lista de áreas fornecida se encaixar; senão proponha um nome curto novo; null se nada se aplica.
- "pessoas": só NOMES PRÓPRIOS de pessoas citadas e envolvidas (sem "vitor"). NÃO inclua papéis/genéricos como "contador", "investidor", "cliente" nem "?".
- "confidence": "high" só se título, owner e prazo estão claros; senão "medium"/"low". "confidence_rationale": 1 linha.

Responda APENAS com JSON: {titulo, descricao, owner, acao, prazo, prazo_text, prioridade, area_raw, pessoas, confidence, confidence_rationale}.`;

export async function parseCapture(raw: string, ctx: CaptureCtx): Promise<CaptureDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente no ambiente");

  const userPayload = {
    texto: raw,
    hoje: ctx.hoje,
    tz: ctx.tz,
    areas: ctx.frentes.map((f) => f.nome),
    pessoas_conhecidas: ctx.owners.map((o) => o.name),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CAPTURE_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: resposta sem conteúdo");
  return normalizeDraft(JSON.parse(content) as RawDraft);
}

import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "./db";
import { audioCostUsd, requestCostUsd, type RequestUsage } from "./coach/pricing";

/**
 * Ledger of every paid AI call (table ai_usage, append-only). A call is recorded once, by `ref`; recording never
 * throws, so a ledger failure never breaks the feature that spent.
 */
export const AGENTS = {
 coach_conversa: { nome: "Coach — conversa", descricao: "Conselho, prioridades e objetivos, com o conferente" },
 coach_assistente: { nome: "Assistente — perguntas", descricao: "Acha e responde sobre tarefas, pessoas, reuniões e agenda" },
 coach_leitor: { nome: "Leitor de pedidos", descricao: "Lê cada mensagem, muda tarefas e escolhe o caminho" },
 coach_mensagens: { nome: "Mensagens automáticas", descricao: "8h, 18h, cobrança e depois da reunião" },
 coach_revisao: { nome: "Revisão de sexta", descricao: "Revisão semanal do Coach" },
 coach_analise: { nome: "Coach — leitura de reuniões", descricao: "Leitura das reuniões para o Coach" },
 coach_busca: { nome: "Coach — busca por significado", descricao: "Vetores das reuniões para a busca do Coach" },
 coach_outros: { nome: "Coach — outros", descricao: "Chamadas do Coach sem categoria" },
 reuniao_relatorio: { nome: "Relatório da reunião", descricao: "Resumo e próximos passos de cada reunião" },
 reuniao_tarefas: { nome: "Tarefas da reunião", descricao: "Tarefas tiradas de cada reunião (3 leituras e o juiz)" },
 reuniao_outros: { nome: "Reuniões — outros", descricao: "Outras etapas de IA no processamento das reuniões" },
 tarefas_repetidas: { nome: "Tarefas repetidas", descricao: "Compara tarefas novas com as de reuniões anteriores" },
 transcricao: { nome: "Transcrição das reuniões", descricao: "Áudio das reuniões virando texto (AssemblyAI)" },
 ditado: { nome: "Ditado e captura", descricao: "Tarefa criada por voz ou texto" },
 whatsapp_audio: { nome: "Áudios no WhatsApp", descricao: "Áudios mandados ao Coach no WhatsApp" },
 nomes_falantes: { nome: "Nomes de quem falou", descricao: "Sugestão de quem é cada voz pelo conteúdo" },
} as const;
export type AgentKey = keyof typeof AGENTS;

export type UsageEntry = {
 ref: string;
 agent: AgentKey;
 provider: string;
 model: string;
 source: "app" | "n8n" | "mac";
 userId?: string | null;
 meetingId?: string | null;
 inputTokens?: number;
 cachedTokens?: number;
 cacheWriteTokens?: number;
 outputTokens?: number;
 audioSeconds?: number;
 costUsd: number;
 basis: "medido" | "estimado";
 note?: string | null;
 occurredAt?: Date | string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (n: number | undefined) => Math.max(0, Math.round(Number.isFinite(n) ? n! : 0));

type UsageContext = { userId?: string | null; meetingId?: string | null };
const context = new AsyncLocalStorage<UsageContext>();
/** Who and which meeting the AI calls inside `fn` are for, so deep helpers record them without extra parameters. */
export function withUsageContext<T>(ctx: UsageContext, fn: () => T): T {
 return context.run({ ...context.getStore(), ...ctx }, fn);
}

/**
 * Records one call; a replay with the same ref is ignored. Returns whether a row was written. `strict` rethrows a
 * database failure, for a reader that must not move past what it could not record.
 */
export async function recordAiUsage(entry: UsageEntry, options: { strict?: boolean } = {}): Promise<boolean> {
 const ctx = context.getStore() ?? {};
 const userId = entry.userId ?? ctx.userId ?? null, meetingId = entry.meetingId ?? ctx.meetingId ?? null;
 try {
  const rows = await query(
   `INSERT INTO ai_usage (ref,user_id,meeting_id,agent,provider,model,source,input_tokens,cached_tokens,cache_write_tokens,output_tokens,audio_seconds,cost_usd,basis,note,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (ref) DO NOTHING RETURNING id`,
   [entry.ref.slice(0, 300), userId && uuid.test(userId) ? userId : null, meetingId && uuid.test(meetingId) ? meetingId : null,
    entry.agent, entry.provider.slice(0, 40), entry.model.slice(0, 100), entry.source,
    count(entry.inputTokens), count(entry.cachedTokens), count(entry.cacheWriteTokens), count(entry.outputTokens),
    Math.max(0, Number(entry.audioSeconds) || 0), Math.max(0, Number(entry.costUsd) || 0).toFixed(6), entry.basis, entry.note?.slice(0, 300) ?? null,
    new Date(entry.occurredAt ?? Date.now()).toISOString()],
  );
  return rows.length > 0;
 } catch (error) {
  if (options.strict) throw error;
  console.error("ai usage record failed", entry.agent, error instanceof Error ? error.message : "");
  return false;
 }
}

/** Coach telemetry purposes → agents (the same mapping the 0041 backfill uses). */
export function coachAgent(purpose: string): AgentKey {
 if (purpose === "chat") return "coach_conversa";
 if (purpose.startsWith("checkin")) return "coach_mensagens";
 const map: Record<string, AgentKey> = { quick: "coach_assistente", tasks: "coach_leitor", weekly: "coach_revisao", analysis: "coach_analise", embedding: "coach_busca" };
 return map[purpose] ?? "coach_outros";
}

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };
type ResponsesUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };

/** Token usage of a Chat Completions, Responses or Embeddings reply, in one shape; null when the reply has none. */
export function tokenUsage(usage: unknown): RequestUsage | null {
 if (!usage || typeof usage !== "object") return null;
 const u = usage as ChatUsage & ResponsesUsage;
 const input = u.input_tokens ?? u.prompt_tokens;
 if (typeof input !== "number") return null;
 const details = u.input_tokens_details ?? u.prompt_tokens_details ?? {};
 return { inputTokens: input, cachedTokens: details.cached_tokens ?? 0, cacheWriteTokens: details.cache_write_tokens ?? 0, outputTokens: u.output_tokens ?? u.completion_tokens ?? 0 };
}

/** One OpenAI token call: measured when the reply reported usage; otherwise nothing is invented and the call is noted. */
export function openAiCall(model: string, usage: unknown): Pick<UsageEntry, "provider" | "model" | "inputTokens" | "cachedTokens" | "cacheWriteTokens" | "outputTokens" | "costUsd" | "basis" | "note"> {
 const tokens = tokenUsage(usage);
 if (!tokens) return { provider: "openai", model, costUsd: 0, basis: "estimado", note: "A resposta não informou o consumo." };
 return { provider: "openai", model, ...tokens, costUsd: requestCostUsd(model, tokens), basis: "medido", note: null };
}

/** An OpenAI transcription, billed by the seconds the reply reports (usage.type "duration"). */
export function openAiTranscription(model: string, usage: unknown): Pick<UsageEntry, "provider" | "model" | "audioSeconds" | "costUsd" | "basis" | "note"> {
 const u = usage as { type?: string; seconds?: number } | null | undefined;
 if (u?.type === "duration" && typeof u.seconds === "number" && u.seconds >= 0)
  return { provider: "openai", model, audioSeconds: u.seconds, costUsd: audioCostUsd("openai", model, u.seconds), basis: "medido", note: null };
 return { provider: "openai", model, costUsd: 0, basis: "estimado", note: "A resposta não informou a duração cobrada." };
}

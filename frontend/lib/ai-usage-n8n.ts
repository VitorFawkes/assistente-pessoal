import { query } from "./db";
import { openAiCall, recordAiUsage, type AgentKey, type UsageEntry } from "./ai-usage";
import { audioCostUsd, requestCostUsd } from "./coach/pricing";

/**
 * Reads what the Ações workflows in n8n spent (meeting reports, tasks, transcription) from n8n's own execution
 * records, through its API, read-only. n8n keeps executions for about two weeks; the cron reads them every 15 minutes.
 */
type Json = Record<string, unknown>;
type NodeRun = { startTime?: number; metadata?: { tokenUsage?: Json; parentExecution?: { executionId?: string } }; data?: { main?: ({ json?: Json }[] | null)[] } };
export type N8nExecution = {
 id: string; workflowId: string; status?: string; finished?: boolean; startedAt?: string; stoppedAt?: string | null;
 workflowData?: { name?: string; nodes?: { name: string; type: string; parameters?: Json }[] };
 data?: { resultData?: { runData?: Record<string, NodeRun[]> } };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPTION_MODEL = "universal-3-5-pro";
const STUCK_MS = 6 * 3600_000;

function agentFor(workflow: string, node: string): AgentKey {
 if (/relat[oó]rio/i.test(workflow)) return "reuniao_relatorio";
 if (/distill|judge|juiz|fanout|tarefa|extract/i.test(node)) return "reuniao_tarefas";
 if (/summary|relat|resumo|stage a/i.test(node)) return "reuniao_relatorio";
 return "reuniao_outros";
}

function modelOf(parameters: Json | undefined, json?: Json): string {
 const raw = parameters?.modelId ?? parameters?.model;
 const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as Json).value : undefined;
 if (typeof value === "string" && value && !value.startsWith("=")) return value;
 return typeof json?.model === "string" ? json.model : "desconhecido";
}

function items(run: NodeRun): Json[] {
 return (run.data?.main ?? []).flatMap(out => (out ?? []).map(item => item.json ?? {}));
}

/** First meeting and user this execution worked on, as its nodes carried them. */
function owner(runData: Record<string, NodeRun[]>): { meetingId: string | null; userId: string | null } {
 let meetingId: string | null = null, userId: string | null = null;
 for (const runs of Object.values(runData)) for (const run of runs) for (const json of items(run)) {
  const headers = json.headers as Json | undefined;
  const candidates = [json.meeting_id, json.user_id, headers?.["x-user-id"]];
  if (!meetingId && typeof candidates[0] === "string" && uuid.test(candidates[0])) meetingId = candidates[0];
  for (const u of candidates.slice(1)) if (!userId && typeof u === "string" && uuid.test(u)) userId = u;
  if (meetingId && userId) return { meetingId, userId };
 }
 return { meetingId, userId };
}

/** Seconds AssemblyAI billed for the audio the Mac sent: the uploaded audio has its silences removed, so it ends with the last utterance. */
function transcription(body: Json): { seconds: number; basis: "medido" | "estimado"; note: string } | null {
 if (String(body.silent) === "true") return null;
 let segments: { end?: number }[] = [];
 try { segments = typeof body.segments === "string" ? JSON.parse(body.segments) : Array.isArray(body.segments) ? body.segments as { end?: number }[] : []; } catch { segments = []; }
 const end = Math.max(0, ...segments.map(s => (typeof s?.end === "number" && Number.isFinite(s.end) ? s.end : 0)));
 if (end > 0) return { seconds: Math.ceil(end), basis: "estimado", note: "Duração cobrada ≈ fim da última fala (o áudio vai sem os silêncios)." };
 const duration = Number(body.duration_seconds);
 return duration > 0 ? { seconds: duration, basis: "estimado", note: "Sem falas marcadas: duração do arquivo inteiro (pode estar acima da cobrança)." } : null;
}

/**
 * Every paid call inside one execution. A node run copied into a retry keeps its start time, so its ref repeats and
 * the ledger counts it once.
 */
export function extractN8nUsage(execution: N8nExecution): { entries: UsageEntry[]; meetingId: string | null; userId: string | null; parentExecutionId: string | null } {
 const runData = execution.data?.resultData?.runData ?? {};
 const workflow = execution.workflowData?.name ?? "";
 const nodes = new Map((execution.workflowData?.nodes ?? []).map(n => [n.name, n]));
 const { meetingId, userId } = owner(runData);
 const entries: UsageEntry[] = [];
 let parentExecutionId: string | null = null;
 for (const [name, runs] of Object.entries(runData)) {
  const node = nodes.get(name);
  const type = node?.type ?? "";
  runs.forEach((run, runIndex) => {
   const parent = run.metadata?.parentExecution?.executionId;
   if (parent && !parentExecutionId) parentExecutionId = String(parent);
   const base = `n8n:${execution.workflowId}:${name}:${runIndex}:${run.startTime ?? execution.startedAt ?? ""}`;
   const occurredAt = run.startTime ? new Date(run.startTime) : new Date(execution.startedAt ?? Date.now());
   const common = { source: "n8n" as const, occurredAt };
   if (/openAi|lmChat/i.test(type)) {
    const usage = run.metadata?.tokenUsage ?? {};
    const input = Number(usage.inputTokens ?? usage.promptTokens ?? 0), output = Number(usage.outputTokens ?? usage.completionTokens ?? 0);
    if (!input && !output) return;
    const model = modelOf(node?.parameters);
    const tokens = { inputTokens: input, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: output };
    entries.push({ ...common, ref: base, agent: agentFor(workflow, name), provider: "openai", model, ...tokens, costUsd: requestCostUsd(model, tokens), basis: "estimado",
     note: "O n8n não informa o cache: entrada contada pelo preço cheio." });
    return;
   }
   if (/httpRequest/i.test(type) && /api\.openai\.com/.test(String(node?.parameters?.url ?? ""))) {
    items(run).forEach((json, itemIndex) => {
     if (!json.usage) return;
     const model = modelOf(undefined, json);
     entries.push({ ...common, ref: `${base}:${itemIndex}`, agent: agentFor(workflow, name), ...openAiCall(model, json.usage) });
    });
    return;
   }
   if (/\.webhook$/i.test(type) && /audio ingest/i.test(workflow)) {
    const body = items(run)[0]?.body as Json | undefined;
    const t = body ? transcription(body) : null;
    if (!t) return;
    entries.push({ ...common, ref: `${base}:transcricao`, agent: "transcricao", provider: "assemblyai", model: TRANSCRIPTION_MODEL, source: "mac",
     audioSeconds: t.seconds, costUsd: audioCostUsd("assemblyai", TRANSCRIPTION_MODEL, t.seconds, true), basis: t.basis, note: t.note });
   }
  });
 }
 return { entries: entries.map(e => ({ ...e, meetingId: e.meetingId ?? meetingId, userId: e.userId ?? userId })), meetingId, userId, parentExecutionId };
}

type Api = (path: string) => Promise<unknown>;
function n8nApi(): Api | null {
 const key = process.env.N8N_API_KEY;
 if (!key) return null;
 const base = (process.env.N8N_API_URL || "http://n8n:5678").replace(/\/$/, "");
 return async path => {
  const res = await fetch(`${base}/api/v1${path}`, { headers: { "X-N8N-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`n8n ${res.status}`);
  return res.json();
 };
}

/**
 * Reads the finished executions not read yet, oldest first, and records their calls. An execution still running
 * stops the reading of that workflow, so it is read whole next time.
 */
export async function syncN8nUsage(opts: { deadline?: number; maxExecutions?: number; api?: Api } = {}): Promise<{ read: number; recorded: number; skipped?: string }> {
 const api = opts.api ?? n8nApi();
 if (!api) return { read: 0, recorded: 0, skipped: "sem chave do n8n" };
 const deadline = opts.deadline ?? Date.now() + 60_000, max = opts.maxExecutions ?? 25;
 const workflows = ((await api("/workflows?limit=250")) as { data?: { id: string; name: string }[] }).data?.filter(w => /^acoes\s*-/i.test(w.name)) ?? [];
 let read = 0, recorded = 0;
 const parents = new Map<string, { meetingId: string | null; userId: string | null }>();
 for (const workflow of workflows) {
  const source = `n8n:${workflow.id}`;
  const last = Number((await query<{ last_id: string }>("SELECT last_id FROM ai_usage_sync WHERE source=$1", [source]))[0]?.last_id ?? 0);
  const pending: { id: string; finished: boolean }[] = [];
  let cursor: string | undefined;
  do {
   const page = (await api(`/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)) as { data?: { id: string; status?: string; startedAt?: string | null; stoppedAt?: string | null }[]; nextCursor?: string | null };
   const rows = page.data ?? [];
   // An execution left "running" for hours (n8n restarted mid-run) is read as it is, so it never blocks the ones after it.
   const stuck = (row: { startedAt?: string | null }) => !!row.startedAt && Date.now() - Date.parse(row.startedAt) > STUCK_MS;
   for (const row of rows) if (Number(row.id) > last) pending.push({ id: row.id, finished: (!!row.stoppedAt && !["running", "waiting", "new"].includes(String(row.status))) || stuck(row) });
   // Keeps paging while a page still has unread executions, whatever order the pages come in.
   cursor = rows.some(row => Number(row.id) > last) ? page.nextCursor ?? undefined : undefined;
  } while (cursor && Date.now() < deadline);
  pending.sort((a, b) => Number(a.id) - Number(b.id));
  for (const item of pending) {
   if (!item.finished || read >= max || Date.now() > deadline) break;
   const execution = (await api(`/executions/${encodeURIComponent(item.id)}?includeData=true`)) as N8nExecution;
   const found = extractN8nUsage(execution);
   parents.set(item.id, { meetingId: found.meetingId, userId: found.userId });
   let who = { meetingId: found.meetingId, userId: found.userId };
   if (found.parentExecutionId && (!who.meetingId || !who.userId)) {
    if (!parents.has(found.parentExecutionId)) {
     const parent = await (api(`/executions/${encodeURIComponent(found.parentExecutionId)}?includeData=true`) as Promise<N8nExecution>).then(extractN8nUsage).catch(() => null);
     parents.set(found.parentExecutionId, { meetingId: parent?.meetingId ?? null, userId: parent?.userId ?? null });
    }
    const parent = parents.get(found.parentExecutionId)!;
    who = { meetingId: who.meetingId ?? parent.meetingId, userId: who.userId ?? parent.userId };
   }
   for (const entry of found.entries) if (await recordAiUsage({ ...entry, meetingId: entry.meetingId ?? who.meetingId, userId: entry.userId ?? who.userId }, { strict: true })) recorded++;
   await query("INSERT INTO ai_usage_sync(source,last_id,updated_at) VALUES($1,$2,now()) ON CONFLICT(source) DO UPDATE SET last_id=GREATEST(ai_usage_sync.last_id,EXCLUDED.last_id),updated_at=now()", [source, Number(item.id)]);
   read++;
  }
 }
 return { read, recorded };
}

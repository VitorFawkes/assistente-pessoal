import { afterEach, expect, spyOn, test } from "bun:test";
import * as db from "./db";
import * as ledger from "./ai-usage";
import { extractN8nUsage, syncN8nUsage, type N8nExecution } from "./ai-usage-n8n";

const USER = "7740e829-9462-416b-81a1-b787e23ba9b2", MEETING = "060bf468-d251-4227-967a-65341879b125";
const spies: { mockRestore(): void }[] = [];
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

/** Shaped like a real "Acoes - Audio Ingest" execution (no meeting content). */
function ingest(id: string, opts: { segments?: string; silent?: string; webhookStart?: number; distillerStart?: number } = {}): N8nExecution {
 return {
  id, workflowId: "WF_INGEST", status: "success", finished: true, startedAt: "2026-09-25T15:00:31.456Z", stoppedAt: "2026-09-25T15:03:39.975Z",
  workflowData: { name: "Acoes - Audio Ingest", nodes: [
   { name: "1. Webhook", type: "n8n-nodes-base.webhook" },
   { name: "3. Prepare Metadata", type: "n8n-nodes-base.code" },
   { name: "Distiller", type: "@n8n/n8n-nodes-langchain.openAi", parameters: { modelId: { __rl: true, mode: "id", value: "gpt-6-luna" } } },
   { name: "Judge", type: "@n8n/n8n-nodes-langchain.openAi", parameters: { modelId: { value: "gpt-6-luna" } } },
   { name: "Stage A Summary", type: "n8n-nodes-base.executeWorkflow" },
  ] },
  data: { resultData: { runData: {
   "1. Webhook": [{ startTime: opts.webhookStart ?? 1790345011733, data: { main: [[{ json: { headers: { "x-user-id": USER }, body: { duration_seconds: "2782", silent: opts.silent ?? "false", segments: opts.segments ?? JSON.stringify([{ speaker: "A", start: 0, end: 51.88 }, { speaker: "B", start: 51.88, end: 2769.051 }]) } } }]] } }],
   "3. Prepare Metadata": [{ startTime: 1790345011800, data: { main: [[{ json: { meeting_id: MEETING, user_id: USER } }]] } }],
   Distiller: [{ startTime: opts.distillerStart ?? 1790348431477, metadata: { tokenUsage: { inputTokens: 40683, outputTokens: 14295 } }, data: { main: [[{ json: { message: {} } }]] } }],
   Judge: [{ startTime: 1790348591157, metadata: { tokenUsage: { inputTokens: 1686, outputTokens: 889 } }, data: { main: [[{ json: { message: {} } }]] } }],
   "Stage A Summary": [{ startTime: 1790345012000, metadata: {}, data: { main: [[{ json: { relatorio_custo_usd: 0.0084 } }]] } }],
  } } },
 };
}
function report(id: string, parent: string): N8nExecution {
 const call = (n: number) => ({ id: `resp_${n}`, model: "gpt-6-luna-2026-08-14", usage: { input_tokens: 10312, output_tokens: 5354, input_tokens_details: { cached_tokens: 10309, cache_write_tokens: 0 } } });
 return {
  id, workflowId: "WF_REPORT", status: "success", finished: true, startedAt: "2026-09-25T14:03:31.000Z", stoppedAt: "2026-09-25T14:10:00.000Z",
  workflowData: { name: "Acoes - Relatorio Luna", nodes: [
   { name: "Recebe reunião", type: "n8n-nodes-base.executeWorkflowTrigger" },
   { name: "Luna extrai", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://api.openai.com/v1/responses" } },
   { name: "Monta relatório", type: "n8n-nodes-base.code" },
  ] },
  data: { resultData: { runData: {
   "Recebe reunião": [{ startTime: 1790345010936, metadata: { parentExecution: { executionId: parent } }, data: { main: [[{ json: {} }]] } }],
   "Luna extrai": [{ startTime: 1790345035384, data: { main: [[{ json: call(1) }]] } }],
   "Monta relatório": [{ startTime: 1790345480000, data: { main: [[{ json: { usage: { input_tokens: 1 } } }]] } }],
  } } },
 };
}

test("a meeting's calls in n8n: transcription by the last utterance, tasks by n8n's token count, owner from the execution", () => {
 const { entries, meetingId, userId } = extractN8nUsage(ingest("104527"));
 expect([meetingId, userId]).toEqual([MEETING, USER]);
 expect(entries.map(e => [e.agent, e.model, e.source, e.basis])).toEqual([
  ["transcricao", "universal-3-5-pro", "mac", "estimado"], ["reuniao_tarefas", "gpt-6-luna", "n8n", "estimado"], ["reuniao_tarefas", "gpt-6-luna", "n8n", "estimado"]]);
 expect(entries[0]).toMatchObject({ audioSeconds: 2770, meetingId: MEETING, userId: USER });
 expect(entries[0].costUsd).toBeCloseTo(2770 / 3600 * 0.23, 10);
 expect(entries[1].costUsd).toBeCloseTo((40683 * 0.1 + 14295 * 0.5) / 1e6, 10);
 // The sub-workflow call itself is not a paid call; the report flow is read on its own.
 expect(entries.some(e => e.ref.includes("Stage A"))).toBe(false);
});

test("a silent recording cost nothing; without utterances the file length is used and said so", () => {
 expect(extractN8nUsage(ingest("1", { silent: "true" })).entries.filter(e => e.agent === "transcricao")).toEqual([]);
 const noSegments = extractN8nUsage(ingest("2", { segments: "[]" })).entries.find(e => e.agent === "transcricao")!;
 expect(noSegments).toMatchObject({ audioSeconds: 2782, basis: "estimado" });
 expect(noSegments.note).toContain("arquivo inteiro");
});

test("a retry repeats the copied runs with the same ref, so the ledger counts them once", () => {
 const original = extractN8nUsage(ingest("104523", { distillerStart: 1790345100000 })).entries.map(e => e.ref);
 const retry = extractN8nUsage(ingest("104527")).entries.map(e => e.ref);
 expect(retry.filter(ref => original.includes(ref))).toEqual([retry[0], retry[2]]); // webhook and judge copied; the distiller ran again
});

test("the report flow is priced from each reply's own usage and points to its parent execution", () => {
 const { entries, parentExecutionId, meetingId } = extractN8nUsage(report("104524", "104523"));
 expect(parentExecutionId).toBe("104523");
 expect(meetingId).toBeNull();
 expect(entries).toHaveLength(1);
 expect(entries[0]).toMatchObject({ agent: "reuniao_relatorio", model: "gpt-6-luna-2026-08-14", inputTokens: 10312, cachedTokens: 10309, basis: "medido" });
 expect(entries[0].costUsd).toBeCloseTo((3 * 0.1 + 10309 * 0.01 + 5354 * 0.5) / 1e6, 12);
});

test("reading: only Ações workflows, oldest first, owner taken from the parent, stops at a running execution", async () => {
 const recorded: ledger.UsageEntry[] = [];
 const cursor: Record<string, number> = { "n8n:WF_INGEST": 104500 };
 spies.push(spyOn(ledger, "recordAiUsage").mockImplementation(async entry => { recorded.push(entry); return true; }));
 spies.push(spyOn(db, "query").mockImplementation((async (sql: string, values: unknown[] = []) => {
  if (sql.startsWith("SELECT last_id")) return cursor[String(values[0])] ? [{ last_id: String(cursor[String(values[0])]) }] : [];
  cursor[String(values[0])] = Number(values[1]);
  return [];
 }) as typeof db.query));
 const executions: Record<string, N8nExecution> = { "104523": ingest("104523"), "104524": report("104524", "104523"), "104527": ingest("104527") };
 const fetched: string[] = [];
 const api = async (path: string) => {
  fetched.push(path);
  if (path.startsWith("/workflows")) return { data: [{ id: "WF_INGEST", name: "Acoes - Audio Ingest" }, { id: "WF_REPORT", name: "Acoes - Relatorio Luna" }, { id: "OTHER", name: "SDR TESTE" }] };
  if (path.includes("workflowId=WF_INGEST")) return { data: [{ id: "104530", status: "running", stoppedAt: null }, { id: "104527", status: "success", stoppedAt: "x" }, { id: "104523", status: "error", stoppedAt: "x" }, { id: "104400", status: "success", stoppedAt: "x" }] };
  if (path.includes("workflowId=WF_REPORT")) return { data: [{ id: "104524", status: "success", stoppedAt: "x" }] };
  return executions[path.match(/executions\/(\d+)/)![1]];
 };
 const result = await syncN8nUsage({ api });
 expect(fetched.some(p => p.includes("OTHER"))).toBe(false);
 expect(fetched.filter(p => p.includes("/executions/"))).toEqual(["/executions/104523?includeData=true", "/executions/104527?includeData=true", "/executions/104524?includeData=true"]);
 expect(cursor).toEqual({ "n8n:WF_INGEST": 104527, "n8n:WF_REPORT": 104524 });
 expect(result.read).toBe(3);
 const reportEntry = recorded.find(e => e.agent === "reuniao_relatorio")!;
 expect([reportEntry.meetingId, reportEntry.userId]).toEqual([MEETING, USER]);
});

test("without the n8n key nothing is read", async () => {
 const old = process.env.N8N_API_KEY; delete process.env.N8N_API_KEY;
 try { expect(await syncN8nUsage()).toEqual({ read: 0, recorded: 0, skipped: "sem chave do n8n" }); } finally { if (old !== undefined) process.env.N8N_API_KEY = old; }
});

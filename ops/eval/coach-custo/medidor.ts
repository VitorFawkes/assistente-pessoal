// Medidor de custo do Coach. Roda cenários reais numa cópia local (pglite) do banco de produção,
// troca a OpenAI por uma resposta falsa (custo zero) e conta os tokens exatos de cada pedido com
// o contador gratuito /v1/responses/input_tokens. Nada aqui chama um modelo pago.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";

export const FRONT = new URL("../../../frontend", import.meta.url).pathname;
const DB = new URL("../../../db", import.meta.url).pathname;

export type Captured = { body: Record<string, any> };
/** Choices the fake model makes for enum fields, e.g. { lane: "tarefas" } sends chats down the cheap lane. */
export const fakeChoices: Record<string, string> = {};
/** Items the fake model returns for array fields, e.g. { consultas: [...] } is the plan the fake planner hands back. */
export const fakeArrays: Record<string, unknown[]> = {};
export const captured: Captured[] = [];
export const realFetch = globalThis.fetch.bind(globalThis);

/** Smallest answer that satisfies the strict schema; the verifier always approves. */
function minimal(schema: any, key = ""): unknown {
 if (!schema || typeof schema !== "object") return null;
 if (Array.isArray(schema.enum)) return fakeChoices[key] && schema.enum.includes(fakeChoices[key]) ? fakeChoices[key] : key === "intent" ? "none" : schema.enum[0];
 if (schema.anyOf) return minimal(schema.anyOf[0], key);
 switch (schema.type) {
  case "object": return Object.fromEntries((schema.required || Object.keys(schema.properties || {})).map((k: string) => [k, minimal(schema.properties?.[k], k)]));
  case "array": return fakeArrays[key] ?? Array.from({ length: schema.minItems || 0 }, () => minimal(schema.items, key));
  case "string": return key === "answer" ? "Resposta de teste do medidor." : key === "headline" ? "Teste" : "x".repeat(schema.minLength || 0);
  case "boolean": return key === "supported";
  case "integer": case "number": return schema.minimum ?? 0;
  default: return null;
 }
}

/** Replaces the OpenAI calls of the Coach; anything else (calendar) goes to the network as usual. */
export function fakeOpenAI() {
 globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.openai.com/v1/responses")) {
   const body = JSON.parse(init.body);
   captured.push({ body });
   const text = JSON.stringify(minimal(body.text?.format?.schema));
   return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
  }
  if (url.startsWith("https://api.openai.com/v1/embeddings")) return Response.json({ data: [{ embedding: Array.from({ length: 1536 }, (_, i) => Math.sin(i + 1) / 40) }] });
  if (url.includes("api.openai.com")) throw new Error("chamada OpenAI inesperada: " + url);
  return realFetch(input, init);
 }) as typeof fetch;
}

let db: PGlite | null = null;
let server: PGLiteSocketServer | null = null;
/**
 * Fresh copy of the dump, turned back to the scenario's time: messages, memories, agreements and
 * reviews created later are removed, and so is the cost ledger (a replay must not hit the daily cap).
 */
export async function freshMirror(dump: string, port: number, at: string, read?: (db: PGlite) => Promise<void>) {
 const pool = (globalThis as any).__pgPool; (globalThis as any).__pgPool = undefined;
 if (pool) { pool.on?.("error", () => {}); await pool.end().catch(() => {}); }
 if (server) await server.stop();
 if (db) await db.close();
 db = await PGlite.create({ extensions: { pgcrypto } });
 await db.exec(readFileSync(dump, "utf8"));
 await db.exec(`SET search_path = public; CREATE ROLE app_tenant; CREATE ROLE app_writer;
  GRANT USAGE ON SCHEMA public TO app_tenant; GRANT ALL ON ALL TABLES IN SCHEMA public TO app_tenant; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
  UPDATE coach_jobs SET status='cancelled', lease_token=NULL, lease_until=NULL WHERE status IN ('queued','running');`);
 await db.exec(readFileSync(`${DB}/0040_coach_model_runs_cost.sql`, "utf8"));
 if (read) await read(db);
 const cut = at.replace(/'/g, "");
 await db.exec(`DELETE FROM coach_model_runs;
  DELETE FROM coach_messages WHERE created_at > '${cut}'::timestamptz; DELETE FROM coach_memories WHERE created_at > '${cut}'::timestamptz;
  DELETE FROM coach_commitments WHERE created_at > '${cut}'::timestamptz; DELETE FROM coach_reviews WHERE created_at > '${cut}'::timestamptz;
  RESET ALL; SET ROLE app_tenant;`);
 server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 } as any);
 await server.start();
}

/** Exact input tokens of one request, from OpenAI's free counter (the key must be real; no model runs). */
export async function countTokens(body: Record<string, any>, key: string): Promise<number> {
 const payload: Record<string, unknown> = { model: body.model, input: body.input };
 for (const field of ["tools", "text", "reasoning", "tool_choice", "parallel_tool_calls"]) if (body[field] !== undefined) payload[field] = body[field];
 const res = await realFetch("https://api.openai.com/v1/responses/input_tokens", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
 const json: any = await res.json();
 if (!res.ok) throw new Error("contador recusou o pedido: " + JSON.stringify(json).slice(0, 400));
 return json.input_tokens;
}

/** Characters per part of one request: instructions, each key of the context package, tools and schema. */
export function sections(body: Record<string, any>): Record<string, number> {
 const out: Record<string, number> = {};
 const add = (k: string, v: number) => { out[k] = (out[k] || 0) + v; };
 for (const item of body.input || []) {
  if (item.role === "system" || item.role === "developer") { add("(instruções)", JSON.stringify(item.content).length); continue; }
  if (item.role !== "user") { add("(leituras de ferramenta)", JSON.stringify(item).length); continue; }
  let data: any; try { data = JSON.parse(item.content); } catch { add("(mensagem)", String(item.content).length); continue; }
  for (const [k, v] of Object.entries(data ?? {})) {
   if (k === "data" && v && typeof v === "object") { for (const [k2, v2] of Object.entries(v)) add(k2, JSON.stringify(v2 ?? null).length); continue; }
   add(k, JSON.stringify(v ?? null).length);
  }
 }
 if (body.tools) add("(ferramentas)", JSON.stringify(body.tools).length);
 if (body.text?.format) add("(formato da resposta)", JSON.stringify(body.text.format).length);
 return out;
}

export function kindOf(body: Record<string, any>) {
 const props = body.text?.format?.schema?.properties ?? {};
 return props.supported ? "verificador" : props.intent ? "leitor-tarefas" : props.consultas ? "planejador" : props.answer && Object.keys(props).length === 1 ? "assistente" : "principal";
}

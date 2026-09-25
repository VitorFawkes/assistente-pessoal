// Uso: veja README.md. Lê os cenários (arquivo privado, fora do repositório), repete cada um na cópia
// local do banco e imprime tokens e custo por pedido e por parte do pacote. --limite N faz o comando
// falhar se algum cenário passar de N tokens de entrada: serve de trava antes de publicar.
import { readFileSync, writeFileSync } from "node:fs";
import { captured, countTokens, fakeOpenAI, freshMirror, kindOf, sections, FRONT } from "./medidor";
import { requestCostUsd } from "../../../frontend/lib/coach/pricing";

type Scenario = { nome: string; agora: string; tipo: "chat" | "checkin" | "revisao"; mensagem?: string; mensagem_chave?: string; checkin?: "morning" | "evening" | "nudge" };
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const scenarios: Scenario[] = JSON.parse(readFileSync(process.env.CENARIOS || flag("--cenarios") || "", "utf8"));
const only = flag("--so");
const limit = Number(flag("--limite") || 0);
const dump = process.env.DUMP || "";
const userId = process.env.COACH_USER_ID || "";
const key = process.env.REAL_OPENAI_KEY || "";
if (!dump || !userId || !key) throw new Error("Defina DUMP (pg_dump --inserts), COACH_USER_ID e REAL_OPENAI_KEY (só para o contador gratuito).");
process.env.OPENAI_API_KEY = "chave-falsa-do-medidor"; // o Coach nunca alcança a OpenAI de verdade

fakeOpenAI();
const pg = (await import(`${FRONT}/node_modules/pg/lib/index.js`)).default;
let service: any = null;
const report: unknown[] = [];
let over = false;
for (const sc of scenarios.filter(s => !only || s.nome === only)) {
 const texts: Record<string, string> = {};
 await freshMirror(dump, Number(process.env.MIRROR_PORT || 5433), sc.agora, async db => {
  for (const r of (await db.query<{ k: string; content: string }>("SELECT idempotency_key AS k, content FROM public.coach_messages WHERE role='user' AND idempotency_key IS NOT NULL")).rows) texts[r.k] = r.content;
 });
 (globalThis as any).__pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20, connectionTimeoutMillis: 60000 });
 (globalThis as any).__pgPool.on("error", () => {});
 service ??= await import(`${FRONT}/lib/coach/service.ts`);
 captured.length = 0;
 const now = new Date(sc.agora), run = crypto.randomUUID();
 let error = "";
 try {
  if (sc.tipo === "checkin") await service.generateCheckin(userId, sc.checkin || "morning", now, run);
  else if (sc.tipo === "revisao") await service.generateReview(userId, now, true, false);
  else {
   const message = sc.mensagem ?? (sc.mensagem_chave ? texts[sc.mensagem_chave] : undefined);
   if (!message) throw new Error("mensagem do cenário não encontrada no espelho");
   await service.chatWithCoach(userId, message, now, run);
  }
 } catch (e) { error = e instanceof Error ? e.message : String(e); }
 const calls = [];
 for (const { body } of captured) {
  const tokens = await countTokens(body, key);
  const parts = sections(body);
  const chars = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
  calls.push({ kind: kindOf(body), tokens, cost: requestCostUsd(body.model, { inputTokens: tokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }),
   parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(tokens * v / chars)])) });
 }
 const total = calls.reduce((a, c) => a + c.tokens, 0);
 const cost = calls.reduce((a, c) => a + c.cost, 0);
 if (limit && total > limit) over = true;
 report.push({ cenario: sc.nome, erro: error, tokens_entrada: total, custo_entrada_usd: +cost.toFixed(4), chamadas: calls });
 console.log(`\n=== ${sc.nome}${error ? `  (erro: ${error})` : ""}`);
 for (const c of calls) console.log(`  ${c.kind.padEnd(15)} ${String(c.tokens).padStart(7)} tokens  US$ ${c.cost.toFixed(4)}`);
 console.log(`  TOTAL ${total} tokens de entrada, US$ ${cost.toFixed(4)} (sem saída; a saída costuma somar US$ 0,01 a 0,03)${limit && total > limit ? `  ACIMA DO LIMITE ${limit}` : ""}`);
 const agg: Record<string, number> = {};
 for (const c of calls) for (const [k, v] of Object.entries(c.parts)) agg[k] = (agg[k] || 0) + v;
 for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${k.padEnd(28)} ${String(v).padStart(7)}  ${(100 * v / (total || 1)).toFixed(1)}%`);
}
const out = flag("--saida");
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
process.exit(over ? 1 : 0);

import { query, withTenant } from "./db";
import { AGENTS, type AgentKey } from "./ai-usage";
import { periodRange } from "./coach/finder";

/** What the admin "Gastos" page shows, read from the ai_usage ledger (all people, since the admin pays for all). */
export const PERIODOS = {
 hoje: { label: "Hoje", intervalo: "hoje" },
 "7d": { label: "7 dias", intervalo: "ultimos_7_dias" },
 "30d": { label: "30 dias", intervalo: "ultimos_30_dias" },
 mes: { label: "Este mês", intervalo: "este_mes" },
 "mes-passado": { label: "Mês passado", intervalo: "mes_passado" },
} as const;
export type Periodo = keyof typeof PERIODOS;

export type AgentLine = { agent: string; nome: string; descricao: string; usos: number; custo: number; estimados: number };
export type UsageReport = {
 de: Date; ate: Date; total: number; anterior: number; usos: number; estimados: number;
 agentes: AgentLine[];
 dias: { dia: string; custo: number }[];
 modelos: { provider: string; model: string; usos: number; custo: number }[];
 maiores: { agente: string; model: string; custo: number; quando: string; reuniao: string | null; detalhe: string; basis: string; note: string | null }[];
 registroDesde: string | null; leituraN8n: string | null;
};

const num = (v: unknown) => Number(v) || 0;

export async function usageReport(periodo: Periodo, timezone: string, adminId: string, now = new Date()): Promise<UsageReport> {
 const { from, to } = periodRange(PERIODOS[periodo].intervalo, timezone, now);
 const span = to.getTime() - from.getTime();
 const prevFrom = periodo === "mes" ? periodRange("mes_passado", timezone, now).from : new Date(from.getTime() - span);
 const range = [from.toISOString(), to.toISOString()];
 const [agentes, dias, modelos, maiores, anterior, status] = [
  await query<{ agent: string; usos: number; custo: string; estimados: number }>(
   `SELECT agent,count(*)::int AS usos,sum(cost_usd) AS custo,(count(*) FILTER (WHERE basis='estimado'))::int AS estimados
    FROM ai_usage WHERE occurred_at>=$1 AND occurred_at<$2 GROUP BY agent ORDER BY sum(cost_usd) DESC,agent`, range),
  await query<{ dia: string; custo: string }>(
   `SELECT to_char(occurred_at AT TIME ZONE $3,'YYYY-MM-DD') AS dia,sum(cost_usd) AS custo
    FROM ai_usage WHERE occurred_at>=$1 AND occurred_at<$2 GROUP BY 1 ORDER BY 1`, [...range, timezone]),
  await query<{ provider: string; model: string; usos: number; custo: string }>(
   `SELECT provider,model,count(*)::int AS usos,sum(cost_usd) AS custo
    FROM ai_usage WHERE occurred_at>=$1 AND occurred_at<$2 GROUP BY provider,model ORDER BY sum(cost_usd) DESC LIMIT 12`, range),
  await query<{ agent: string; model: string; cost_usd: string; occurred_at: Date; meeting_id: string | null; input_tokens: string; cached_tokens: string; output_tokens: string; audio_seconds: string; basis: string; note: string | null }>(
   `SELECT agent,model,cost_usd,occurred_at,meeting_id,input_tokens,cached_tokens,output_tokens,audio_seconds,basis,note
    FROM ai_usage WHERE occurred_at>=$1 AND occurred_at<$2 ORDER BY cost_usd DESC,occurred_at DESC LIMIT 12`, range),
  await query<{ total: string }>("SELECT coalesce(sum(cost_usd),0) AS total FROM ai_usage WHERE occurred_at>=$1 AND occurred_at<$2", [prevFrom.toISOString(), from.toISOString()]),
  await query<{ desde: Date | null; leitura: Date | null }>("SELECT (SELECT min(occurred_at) FROM ai_usage) AS desde,(SELECT max(updated_at) FROM ai_usage_sync) AS leitura"),
 ];
 // Meeting titles only for the admin's own meetings (the others stay unnamed).
 const ids = [...new Set(maiores.map(m => m.meeting_id).filter((id): id is string => !!id))];
 const titulos = new Map(ids.length ? (await withTenant(adminId, db => db.query<{ id: string; titulo: string }>(
  "SELECT id,coalesce(nome,original_filename) AS titulo FROM meetings WHERE user_id=$1 AND id=ANY($2::uuid[])", [adminId, ids]))).rows.map(r => [r.id, r.titulo]) : []);
 const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
 const nomeDe = (agent: string) => AGENTS[agent as AgentKey] ?? { nome: agent, descricao: "" };
 const mil = (n: string) => num(n) >= 1000 ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(num(n) / 1000)} mil` : String(num(n));
 const lines = agentes.map(a => ({ agent: a.agent, ...nomeDe(a.agent), usos: a.usos, custo: num(a.custo), estimados: a.estimados }));
 return {
  de: from, ate: to, total: lines.reduce((s, a) => s + a.custo, 0), anterior: num(anterior[0]?.total), usos: lines.reduce((s, a) => s + a.usos, 0), estimados: lines.reduce((s, a) => s + a.estimados, 0),
  agentes: lines,
  dias: dias.map(d => ({ dia: d.dia, custo: num(d.custo) })),
  modelos: modelos.map(m => ({ provider: m.provider, model: m.model, usos: m.usos, custo: num(m.custo) })),
  maiores: maiores.map(m => ({
   agente: nomeDe(m.agent).nome, model: m.model, custo: num(m.cost_usd), quando: fmt.format(new Date(m.occurred_at)),
   reuniao: m.meeting_id ? titulos.get(m.meeting_id) ?? "reunião de outra pessoa" : null,
   detalhe: num(m.audio_seconds) ? `${Math.max(1, Math.round(num(m.audio_seconds) / 60))} min de áudio` : `leu ${mil(m.input_tokens)}${num(m.cached_tokens) ? ` (${mil(m.cached_tokens)} já guardados)` : ""}, escreveu ${mil(m.output_tokens)}`,
   basis: m.basis, note: m.note,
  })),
  registroDesde: status[0]?.desde ? fmt.format(new Date(status[0].desde)) : null,
  leituraN8n: status[0]?.leitura ? fmt.format(new Date(status[0].leitura)) : null,
 };
}

import { fromZonedTime } from "date-fns-tz";
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import type { Dossier, DossierEntry, DossierMeeting, DossierPassage, DossierTask, MeetingCandidate, PeriodKey, PersonCandidate, PlannedQuery } from "./assistant-types";
import { calendarContext } from "./calendar";
import { contextSearchTerms } from "./context-selection";
import { chunkMeeting } from "./evidence";
import { buildSourceBank, selectChunks, type SelectedChunk } from "./investigation";
import { meetingReport } from "./meeting-reports";
import { dueTasks } from "./morning-agenda";
import type { CoachMeeting } from "./types";

/**
 * The assistant's finder: fixed, bounded queries the server runs for a plan (no model involved).
 * Every query goes through withTenant and also filters user_id explicitly.
 */
const DAY = 86400_000;
const localDay = (timezone: string, d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthStep = (month: string, n: number) => { const [y, m] = month.split("-").map(Number); const i = y * 12 + (m - 1) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`; };

/** Local periods as [from, to); weeks start on Monday. */
export function periodRange(key: PeriodKey, timezone: string, now: Date): { from: Date; to: Date } {
 const start = (day: string) => fromZonedTime(`${day}T00:00:00`, timezone);
 const today = localDay(timezone, now);
 const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
 const month = `${today.slice(0, 7)}-01`;
 switch (key) {
  case "hoje": return { from: start(today), to: start(addDays(today, 1)) };
  case "ontem": return { from: start(addDays(today, -1)), to: start(today) };
  case "amanha": return { from: start(addDays(today, 1)), to: start(addDays(today, 2)) };
  case "esta_semana": return { from: start(monday), to: start(addDays(monday, 7)) };
  case "semana_passada": return { from: start(addDays(monday, -7)), to: start(monday) };
  case "proxima_semana": return { from: start(addDays(monday, 7)), to: start(addDays(monday, 14)) };
  case "ultimos_7_dias": return { from: new Date(now.getTime() - 7 * DAY), to: now };
  case "proximos_7_dias": return { from: now, to: new Date(now.getTime() + 7 * DAY) };
  case "ultimos_30_dias": return { from: new Date(now.getTime() - 30 * DAY), to: now };
  case "este_mes": return { from: start(month), to: start(monthStep(month, 1)) };
  case "mes_passado": return { from: start(monthStep(month, -1)), to: start(month) };
 }
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** People cited by the message: the full name as a phrase, or the first name as a word (3+ letters). */
export function matchPeople(message: string, pessoas: { id: string; nome: string; is_vitor?: boolean | null }[]) {
 const text = ` ${norm(message)} `;
 const words = new Set(text.trim().split(" "));
 return pessoas.flatMap(p => {
  const name = norm(p.nome);
  if (p.is_vitor || !name) return [];
  const full = text.includes(` ${name} `);
  const first = name.split(" ")[0];
  return full || (first.length >= 3 && words.has(first)) ? [{ id: p.id, nome: p.nome, full }] : [];
 });
}

/** Meetings cited by title or file name, or by a dd/mm date next to the word "reunião". */
export function matchMeetings<M extends { nome: string | null; original_filename: string; day: string | null }>(message: string, meetings: M[], year: number): M[] {
 const text = ` ${norm(message)} `;
 const days = /reuni/.test(text) ? [...message.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)].map(m => `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`) : [];
 return meetings.filter(m => {
  const names = [m.nome, m.original_filename.replace(/\.[a-z0-9]+$/i, "")].map(n => norm(n || "")).filter(n => n.length >= 6);
  return names.some(n => text.includes(` ${n} `)) || (m.day !== null && days.includes(m.day));
 });
}

const onlyObject = "CASE WHEN jsonb_typeof(m.speaker_pessoas)='object' THEN m.speaker_pessoas ELSE '{}'::jsonb END";
const tookPart = (param: string) => `EXISTS (SELECT 1 FROM jsonb_each_text(${onlyObject}) sp WHERE sp.value=${param})`;

export async function resolveEntities(userId: string, message: string, opts: { timezone?: string; now?: Date } = {}): Promise<{ people: PersonCandidate[]; meetings: MeetingCandidate[] }> {
 const timezone = opts.timezone ?? "America/Sao_Paulo", now = opts.now ?? new Date();
 return withTenant(userId, async db => {
  const pessoas = (await db.query<{ id: string; nome: string; is_vitor: boolean | null }>("SELECT id,nome,is_vitor FROM pessoas WHERE user_id=$1", [userId])).rows;
  const matched = matchPeople(message, pessoas);
  const stats = matched.length ? (await db.query<{ id: string; tarefas: number; ultima_reuniao: Date | null }>(
   `SELECT p.id,
     (SELECT count(*)::int FROM tarefas t WHERE t.user_id=$1 AND (lower(btrim(t.owner))=lower(btrim(p.nome))
       OR EXISTS (SELECT 1 FROM tarefa_pessoas tp WHERE tp.tarefa_id=t.id AND tp.pessoa_id=p.id))) AS tarefas,
     (SELECT max(m.recorded_at) FROM meetings m WHERE m.user_id=$1 AND m.status='done' AND ${tookPart("p.id::text")}) AS ultima_reuniao
    FROM pessoas p WHERE p.user_id=$1 AND p.id=ANY($2::uuid[])`, [userId, matched.map(m => m.id)])).rows : [];
  const people = matched.map(m => { const s = stats.find(x => x.id === m.id); return { id: m.id, nome: m.nome, tarefas: s?.tarefas ?? 0, ultima_reuniao: s?.ultima_reuniao ? new Date(s.ultima_reuniao).toISOString() : null, full: m.full }; })
   .sort((a, b) => Number(b.full) - Number(a.full) || b.tarefas - a.tarefas).slice(0, 8).map(p => ({ id: p.id, nome: p.nome, tarefas: p.tarefas, ultima_reuniao: p.ultima_reuniao }));
  const rows = (await db.query<{ id: string; nome: string | null; original_filename: string; recorded_at: Date | null; day: string | null }>(
   `SELECT m.id,m.nome,m.original_filename,m.recorded_at,to_char(m.recorded_at AT TIME ZONE $2,'YYYY-MM-DD') AS day
    FROM meetings m WHERE m.user_id=$1 AND m.status='done' ORDER BY m.recorded_at DESC NULLS LAST`, [userId, timezone])).rows;
  const meetings = matchMeetings(message, rows, Number(localDay(timezone, now).slice(0, 4))).slice(0, 5)
   .map(m => ({ id: m.id, titulo: m.nome || m.original_filename, recorded_at: m.recorded_at ? new Date(m.recorded_at).toISOString() : null }));
  return { people, meetings };
 });
}

type TaskRow = { titulo: string; owner: string | null; status: string; prazo: Date | null; prioridade: string | null; created_at: Date; concluida_em: Date | null; reuniao_titulo: string | null; reuniao_data: Date | null; ligacao?: string; total: number };
const TASK_COLUMNS = `t.titulo,t.owner,t.status,t.prazo,t.prioridade,t.created_at,t.concluida_em,
 coalesce(m.nome,m.original_filename) AS reuniao_titulo,m.recorded_at AS reuniao_data,count(*) OVER()::int AS total`;
const TASK_FROM = "tarefas t LEFT JOIN meetings m ON m.id=t.meeting_id AND m.user_id=t.user_id";
const iso = (d: Date | string | null | undefined) => d ? new Date(d).toISOString() : null;
const toTask = (r: TaskRow): DossierTask => ({
 titulo: r.titulo, owner: r.owner, status: r.status, prazo: iso(r.prazo), prioridade: r.prioridade, criada_em: iso(r.created_at)!, concluida_em: iso(r.concluida_em),
 reuniao: r.reuniao_titulo ? { titulo: r.reuniao_titulo, data: iso(r.reuniao_data) } : null,
 ...(r.ligacao === "responsavel" || r.ligacao === "envolvida" ? { ligacao: r.ligacao } : {}),
});
const taskEntry = (consulta: string, tipo: DossierEntry["tipo"], rows: TaskRow[]): DossierEntry => ({ consulta, tipo, total: rows[0]?.total ?? 0, mostrados: rows.length, tarefas: rows.map(toTask) });
/** OR of the message's lexemes, each quoted, so any text is a valid tsquery. */
const TSQUERY = "(SELECT array_to_string(ARRAY(SELECT quote_literal(x) FROM unnest(tsvector_to_array(to_tsvector('portuguese',$2))) x),' | ')::tsquery)";

type MeetingRow = CoachMeeting & { total?: number; ligacao?: string };
const MEETING_COLUMNS = `m.id,m.nome,m.original_filename,m.recorded_at,m.summary,m.raw_ai_response->>'executive_summary' AS executive_summary,m.speaker_pessoas`;
const FULL_MEETING_COLUMNS = `${MEETING_COLUMNS},m.transcription,m.segments,m.speaker_labels`;
/** Same rule the Coach's store uses for citable meetings; a passage from any other would make the reply's sources fail. */
const HAS_TRANSCRIPT = "m.status='done' AND m.transcription IS NOT NULL AND length(btrim(m.transcription))>0";

const WINDOW = 3500, MAX_EXCERPTS = 4;
/**
 * The part of a transcript chunk (24k characters) around where the search terms concentrate, so a passage costs
 * a few thousand characters instead of the whole chunk. Offsets stay absolute, as open_meeting does.
 */
export function narrowChunk({ meeting, chunk }: SelectedChunk, busca: string): SelectedChunk {
 if (chunk.text.length <= WINDOW) return { meeting, chunk };
 const text = chunk.text.toLocaleLowerCase("pt-BR");
 const hits = contextSearchTerms(busca).toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean)
  .flatMap(term => { const at: number[] = []; for (let i = text.indexOf(term); i >= 0 && at.length < 200; i = text.indexOf(term, i + term.length)) at.push(i); return at; }).sort((a, b) => a - b);
 const best = hits.reduce((top, p) => { const n = hits.filter(h => h >= p - 1000 && h < p + WINDOW - 1000).length; return n > top.n ? { p, n } : top; }, { p: 1000, n: 0 }).p;
 let start = Math.max(0, Math.min(best - 1000, chunk.text.length - WINDOW));
 const line = chunk.text.lastIndexOf("\n", start);
 start = line >= 0 && start - line < 400 ? line + 1 : Math.max(0, chunk.text.lastIndexOf(" ", start) + 1);
 const base = chunk.start_offset ?? chunkMeeting(meeting).slice(0, chunk.index).reduce((n, c) => n + c.text.length, 0);
 const end = chunk.text.indexOf(" ", start + WINDOW);
 return { meeting, chunk: { ...chunk, start_offset: base + start, text: chunk.text.slice(start, end < 0 ? undefined : end) } };
}

type Ctx = { db: PoolClient; userId: string; timezone: string; now: Date; selfPersonIds: string[]; names: () => Promise<Map<string, string>> };

function toMeeting(r: MeetingRow, names: Map<string, string>, max: number): DossierMeeting {
 const text = meetingReport(r).text ?? "";
 const participantes = [...new Set(Object.values(r.speaker_pessoas ?? {}).map(id => names.get(id)).filter((n): n is string => !!n))];
 return { id: r.id, titulo: r.nome || r.original_filename, data: iso(r.recorded_at), participantes, resumo: text.slice(0, max), resumo_parcial: text.length > max,
  ...(r.ligacao === "participou" || r.ligacao === "tarefas_ligadas" || r.ligacao === "texto" ? { ligacao: r.ligacao } : {}) };
}

const missing = (tipo: DossierEntry["tipo"], what: string): DossierEntry => ({ consulta: tipo.replace(/_/g, " "), tipo, total: 0, mostrados: 0, aviso: `Consulta sem ${what}; não foi feita.` });
const personName = (people: PersonCandidate[], id: string | null) => people.find(p => p.id === id)?.nome ?? "a pessoa";

async function execute(q: PlannedQuery, ctx: Ctx, people: PersonCandidate[], excerpts: SelectedChunk[]): Promise<DossierEntry> {
 const { db, userId } = ctx;
 const range = q.periodo ? periodRange(q.periodo, ctx.timezone, ctx.now) : null;
 switch (q.tipo) {
  case "tarefas_da_pessoa": {
   if (!q.pessoa) return missing(q.tipo, "pessoa");
   const order = q.ordem === "recentes" ? "t.created_at DESC" : "(t.prazo IS NULL),t.prazo,t.created_at DESC";
   const rows = (await db.query<TaskRow>(
    `WITH alvo AS (SELECT id,lower(btrim(nome)) AS nome FROM pessoas WHERE user_id=$1 AND id=$2::uuid)
     SELECT ${TASK_COLUMNS},CASE WHEN lower(btrim(t.owner))=(SELECT nome FROM alvo) THEN 'responsavel' ELSE 'envolvida' END AS ligacao
     FROM ${TASK_FROM}
     WHERE t.user_id=$1 AND (lower(btrim(t.owner))=(SELECT nome FROM alvo) OR EXISTS (SELECT 1 FROM tarefa_pessoas tp WHERE tp.tarefa_id=t.id AND tp.pessoa_id=(SELECT id FROM alvo)))
       AND ($3='todas' OR t.status NOT IN ('concluida','cancelada'))
     ORDER BY ${order},t.id LIMIT 30`, [userId, q.pessoa, q.status])).rows;
   return taskEntry(`tarefas ligadas a ${personName(people, q.pessoa)} (${q.status === "todas" ? "todas" : "abertas"}, ${q.ordem === "recentes" ? "mais novas primeiro" : "por prazo"})`, q.tipo, rows);
  }
  case "tarefas_por_assunto": {
   if (!q.busca.trim()) return missing(q.tipo, "busca");
   const rows = (await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM ${TASK_FROM}
     WHERE t.user_id=$1 AND ($3='todas' OR t.status NOT IN ('concluida','cancelada'))
       AND to_tsvector('portuguese',t.titulo||' '||coalesce(t.descricao,'')||' '||coalesce(t.owner,'')) @@ ${TSQUERY}
     ORDER BY (t.status NOT IN ('concluida','cancelada')) DESC,ts_rank_cd(to_tsvector('portuguese',t.titulo||' '||coalesce(t.descricao,'')||' '||coalesce(t.owner,'')),${TSQUERY}) DESC,t.updated_at DESC
     LIMIT 15`, [userId, q.busca.slice(0, 120), q.status])).rows;
   return taskEntry(`tarefas sobre "${q.busca}" (${q.status === "todas" ? "todas" : "abertas"})`, q.tipo, rows);
  }
  case "tarefas_do_periodo": {
   if (!range) return missing(q.tipo, "período");
   const field = q.campo === "criacao" ? "t.created_at" : q.campo === "conclusao" ? "t.concluida_em" : "t.prazo";
   const rows = (await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM ${TASK_FROM}
     WHERE t.user_id=$1 AND ${field}>=$2::timestamptz AND ${field}<$3::timestamptz AND ($4='todas' OR t.status NOT IN ('concluida','cancelada'))
     ORDER BY ${field} ${q.campo === "prazo" ? "ASC" : "DESC"},t.id LIMIT 25`, [userId, range.from.toISOString(), range.to.toISOString(), q.status])).rows;
   const label = q.campo === "criacao" ? "criadas" : q.campo === "conclusao" ? "concluídas" : "com prazo";
   return taskEntry(`tarefas ${label} em ${q.periodo!.replace(/_/g, " ")}`, q.tipo, rows);
  }
  case "reunioes_da_pessoa": {
   if (!q.pessoa) return missing(q.tipo, "pessoa");
   const rows = (await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS},CASE WHEN ${tookPart("$2")} THEN 'participou' ELSE 'tarefas_ligadas' END AS ligacao,count(*) OVER()::int AS total
     FROM meetings m
     WHERE m.user_id=$1 AND m.status='done'
       AND (${tookPart("$2")} OR EXISTS (SELECT 1 FROM tarefas t JOIN tarefa_pessoas tp ON tp.tarefa_id=t.id WHERE t.user_id=$1 AND t.meeting_id=m.id AND tp.pessoa_id=$2::uuid))
       AND ($3::timestamptz IS NULL OR m.recorded_at>=$3::timestamptz) AND ($4::timestamptz IS NULL OR m.recorded_at<$4::timestamptz)
     ORDER BY m.recorded_at DESC NULLS LAST LIMIT 5`, [userId, q.pessoa, range?.from.toISOString() ?? null, range?.to.toISOString() ?? null])).rows;
   const names = await ctx.names();
   return { consulta: `reuniões com ${personName(people, q.pessoa)} (participou ou vieram tarefas ligadas a ela), mais recentes primeiro`, tipo: q.tipo, total: rows[0]?.total ?? 0, mostrados: rows.length, reunioes: rows.map(r => toMeeting(r, names, 700)) };
  }
  case "reunioes_por_assunto": {
   if (!q.busca.trim()) return missing(q.tipo, "busca");
   // Report text weighs more than transcript; each document is built once (MATERIALIZED), not per clause.
   const rows = (await db.query<MeetingRow>(
    `WITH busca AS (SELECT ${TSQUERY} AS q),
     docs AS MATERIALIZED (SELECT m.id,setweight(to_tsvector('portuguese',coalesce(m.nome,'')||' '||m.original_filename||' '||coalesce(m.summary,'')||' '||coalesce(m.raw_ai_response->>'executive_summary','')),'A')
       ||setweight(to_tsvector('portuguese',coalesce(m.transcription,'')),'D') AS doc
      FROM meetings m WHERE m.user_id=$1 AND m.status='done'
       AND ($3::timestamptz IS NULL OR m.recorded_at>=$3::timestamptz) AND ($4::timestamptz IS NULL OR m.recorded_at<$4::timestamptz))
     SELECT ${MEETING_COLUMNS},'texto' AS ligacao,count(*) OVER()::int AS total
     FROM docs d JOIN meetings m ON m.id=d.id AND m.user_id=$1, busca
     WHERE d.doc @@ busca.q
     ORDER BY ts_rank_cd(d.doc,busca.q) DESC,m.recorded_at DESC NULLS LAST LIMIT 5`, [userId, q.busca.slice(0, 120), range?.from.toISOString() ?? null, range?.to.toISOString() ?? null])).rows;
   const names = await ctx.names();
   return { consulta: `reuniões sobre "${q.busca}"`, tipo: q.tipo, total: rows[0]?.total ?? 0, mostrados: rows.length, reunioes: rows.map(r => toMeeting(r, names, 700)) };
  }
  case "reunioes_do_periodo": {
   if (!range) return missing(q.tipo, "período");
   const rows = (await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS},count(*) OVER()::int AS total FROM meetings m
     WHERE m.user_id=$1 AND m.status='done' AND m.recorded_at>=$2::timestamptz AND m.recorded_at<$3::timestamptz
     ORDER BY m.recorded_at DESC LIMIT 8`, [userId, range.from.toISOString(), range.to.toISOString()])).rows;
   const names = await ctx.names();
   return { consulta: `reuniões de ${q.periodo!.replace(/_/g, " ")}`, tipo: q.tipo, total: rows[0]?.total ?? 0, mostrados: rows.length, reunioes: rows.map(r => toMeeting(r, names, 700)) };
  }
  case "detalhe_da_reuniao": {
   if (!q.reuniao) return missing(q.tipo, "reunião");
   const row = (await db.query<MeetingRow>(`SELECT ${MEETING_COLUMNS} FROM meetings m WHERE m.user_id=$1 AND m.id=$2::uuid AND m.status='done'`, [userId, q.reuniao])).rows[0];
   if (!row) return { consulta: "detalhe da reunião", tipo: q.tipo, total: 0, mostrados: 0, aviso: "Reunião não encontrada." };
   const tasks = (await db.query<{ titulo: string; owner: string | null; status: string; prazo: Date | null }>(
    "SELECT titulo,owner,status,prazo FROM tarefas WHERE user_id=$1 AND meeting_id=$2::uuid ORDER BY created_at,id LIMIT 25", [userId, q.reuniao])).rows;
   const meeting = { ...toMeeting(row, await ctx.names(), 6000), tarefas: tasks.map(t => ({ titulo: t.titulo, owner: t.owner, status: t.status, prazo: iso(t.prazo) })) };
   return { consulta: `relatório e tarefas da reunião "${meeting.titulo}"`, tipo: q.tipo, total: 1, mostrados: 1, reunioes: [meeting] };
  }
  case "trechos": {
   if (!q.busca.trim()) return missing(q.tipo, "busca");
   const rows = q.reuniao
    ? (await db.query<MeetingRow>(`SELECT ${FULL_MEETING_COLUMNS} FROM meetings m WHERE m.user_id=$1 AND m.id=$2::uuid AND ${HAS_TRANSCRIPT}`, [userId, q.reuniao])).rows
    : q.pessoa
     ? (await db.query<MeetingRow>(`SELECT ${FULL_MEETING_COLUMNS} FROM meetings m WHERE m.user_id=$1 AND ${HAS_TRANSCRIPT} AND ${tookPart("$2")} ORDER BY m.recorded_at DESC NULLS LAST LIMIT 5`, [userId, q.pessoa])).rows
     : (await db.query<MeetingRow>(
      `WITH busca AS (SELECT ${TSQUERY} AS q),
       docs AS MATERIALIZED (SELECT m.id,to_tsvector('portuguese',m.transcription) AS doc FROM meetings m WHERE m.user_id=$1 AND ${HAS_TRANSCRIPT})
       SELECT ${FULL_MEETING_COLUMNS} FROM docs d JOIN meetings m ON m.id=d.id AND m.user_id=$1, busca
       WHERE d.doc @@ busca.q ORDER BY ts_rank_cd(d.doc,busca.q) DESC LIMIT 5`, [userId, q.busca.slice(0, 120)])).rows;
   const selected = selectChunks(rows, q.busca, 3).filter(s => !excerpts.some(e => e.meeting.id === s.meeting.id && e.chunk.index === s.chunk.index))
    .slice(0, Math.max(0, MAX_EXCERPTS - excerpts.length)).map(s => narrowChunk(s, q.busca));
   excerpts.push(...selected);
   return { consulta: `trechos literais sobre "${q.busca}"`, tipo: q.tipo, total: selected.length, mostrados: selected.length,
    ...(selected.length ? {} : { aviso: excerpts.length >= MAX_EXCERPTS ? "Limite de trechos desta resposta atingido." : "Nenhum trecho encontrado." }),
    trechos: selected.map(s => ({ meeting_id: s.meeting.id, titulo: s.meeting.nome || s.meeting.original_filename, data: iso(s.meeting.recorded_at), texto: s.chunk.text, source_ids: [], chunk_index: s.chunk.index })) };
  }
  case "conversas": {
   if (!q.busca.trim()) return missing(q.tipo, "busca");
   const rows = (await db.query<{ role: string; content: string; created_at: Date; total: number }>(
    `WITH busca AS (SELECT ${TSQUERY} AS q),
     recentes AS (SELECT id FROM coach_messages WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 24)
     SELECT c.role,left(c.content,2000) AS content,c.created_at,count(*) OVER()::int AS total FROM coach_messages c, busca
     WHERE c.user_id=$1 AND c.id NOT IN (SELECT id FROM recentes) AND to_tsvector('portuguese',c.content) @@ busca.q
     ORDER BY ts_rank_cd(to_tsvector('portuguese',c.content),busca.q) DESC,c.created_at DESC LIMIT 6`, [userId, q.busca.slice(0, 120)])).rows;
   return { consulta: `conversas anteriores com o Coach sobre "${q.busca}"`, tipo: q.tipo, total: rows[0]?.total ?? 0, mostrados: rows.length,
    conversas: rows.map(r => ({ papel: r.role === "user" ? "usuario" as const : "coach" as const, data: iso(r.created_at)!, texto: r.content.replace(/\s+/g, " ").trim().slice(0, 600) })) };
  }
  default: throw new Error("unsupported query");
 }
}

/** Lookups that open their own connection, so they never run inside another lookup's transaction. */
async function executeStandalone(q: PlannedQuery, ctx: { userId: string; timezone: string; now: Date }): Promise<DossierEntry> {
 if (q.tipo === "pendencias") {
  const due = await dueTasks(ctx.userId, ctx.timezone, ctx.now, 30);
  return { consulta: "o que vence hoje e o que está atrasado (lista da mensagem das 8h)", tipo: q.tipo, total: due.due_today + due.overdue, mostrados: due.items.length,
   pendencias: { vence_hoje: due.due_today, atrasadas: due.overdue, itens: due.items.map(i => ({ titulo: i.titulo, owner: i.owner, prazo: i.prazo, vence_hoje: i.vence_hoje, mostrada_as_8h: i.shown_at_8h })) } };
 }
 const r = periodRange(q.periodo ?? "hoje", ctx.timezone, ctx.now);
 const agenda = await calendarContext(ctx.userId, { from: r.from.toISOString(), to: r.to.toISOString() }, { timezone: ctx.timezone }).catch(() => null);
 const events = agenda?.events ?? [];
 return { consulta: `agenda de ${(q.periodo ?? "hoje").replace(/_/g, " ")}`, tipo: q.tipo, total: events.length, mostrados: Math.min(events.length, 25), agenda_status: agenda?.status ?? "unavailable",
  eventos: events.slice(0, 25).map(e => ({ subject: e.is_private ? "Compromisso particular" : e.subject, start: e.start, end: e.end, ...(e.start_local ? { start_local: e.start_local } : {}), ...(e.end_local ? { end_local: e.end_local } : {}), ...(e.is_all_day ? { is_all_day: true } : {}) })) };
}

/**
 * Runs up to 4 lookups one after another (production has a pool of 5 connections). A lookup that fails becomes a
 * note in its own entry; the others still run.
 */
export async function runQueries(userId: string, queries: PlannedQuery[], opts: { timezone: string; now: Date; selfPersonIds: string[]; people: PersonCandidate[]; meetings?: MeetingCandidate[] }): Promise<Dossier> {
 const consultas: DossierEntry[] = [];
 const excerpts: SelectedChunk[] = [];
 let names: Map<string, string> | null = null;
 for (const q of queries.slice(0, 4)) {
  try {
   consultas.push(q.tipo === "pendencias" || q.tipo === "agenda" ? await executeStandalone(q, { userId, timezone: opts.timezone, now: opts.now }) : await withTenant(userId, db => execute(q, {
    db, userId, timezone: opts.timezone, now: opts.now, selfPersonIds: opts.selfPersonIds,
    names: async () => names ??= new Map((await db.query<{ id: string; nome: string }>("SELECT id,nome FROM pessoas WHERE user_id=$1", [userId])).rows.map(p => [p.id, p.nome])),
   }, opts.people, excerpts)));
  } catch {
   console.error("coach finder query failed", q.tipo);
   consultas.push({ consulta: q.tipo.replace(/_/g, " "), tipo: q.tipo, total: 0, mostrados: 0, aviso: "Esta busca falhou agora; o resultado não está disponível." });
  }
 }
 // Same bank, same order and same ids the Coach gets from these excerpts, so a passage points to citable quotes.
 const bank = Object.entries(buildSourceBank(excerpts, opts.selfPersonIds));
 for (const entry of consultas) if (entry.trechos) entry.trechos = entry.trechos.map(({ chunk_index, ...p }: DossierPassage & { chunk_index?: number }) =>
  ({ ...p, source_ids: bank.filter(([, e]) => e.meeting_id === p.meeting_id && e.chunk_index === chunk_index).map(([id]) => id) }));
 return { pessoas_citadas: opts.people, reunioes_citadas: opts.meetings ?? [], consultas, limitacoes: [], excerpts };
}

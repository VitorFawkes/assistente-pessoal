import { withTenant } from "../db";

/**
 * One way to pick tasks by criteria, shared by the Coach's changes in bulk and its lists. The model only names the
 * criteria; the server finds every task that matches, counting like the app does (every open task, whoever it
 * belongs to, including the ones the user only waits for).
 */
export const OPEN_STATUSES = ["aberta", "em_andamento", "aguardando_aprovacao"];
export const PRIORITY_LEVELS = ["baixa", "media", "alta", "urgente"] as const;
export type Priority = (typeof PRIORITY_LEVELS)[number];
export const FILTER_STATUSES = ["open", "in_progress", "done", "cancelled", "closed"] as const;
export type FilterStatus = (typeof FILTER_STATUSES)[number];
export const NO_AREA = "sem_area";

export type TaskFilter = {
 all: boolean;
 status: FilterStatus;
 due: "" | "none" | "any" | "range"; due_from: string | null; due_until: string | null;
 who: "" | "me" | "others" | "nobody"; people: string[]; not_people: string[];
 kind: "" | "chase" | "wait";
 priorities: Priority[];
 boards: string[]; not_boards: string[];
 /** Area names as the app shows them (approved area, else the proposed one); NO_AREA = tasks without area. */
 areas: string[]; not_areas: string[];
 meetings: string[]; meeting_from: string | null; meeting_until: string | null;
 source: "" | "meeting" | "manual";
 words: string[]; not_words: string[];
 created_from: string | null; created_until: string | null;
 closed_from: string | null; closed_until: string | null;
 idle_days: number;
 repeated: boolean;
 except: string[];
};

/** What the interpreter may cite by code: the user's boards, the areas the tasks use and, when the message talks about meetings, recent meetings. */
export type FilterContext = {
 boards: { code: string; id: string; nome: string }[];
 areas: { code: string; nome: string }[];
 meetings: { code: string; id: string; titulo: string; data: string | null; participantes: string[] }[];
};
export const EMPTY_CONTEXT: FilterContext = { boards: [], areas: [], meetings: [] };

export type PickedTask = {
 id: string; titulo: string; owner: string | null; is_mine: boolean | null; status: string; prazo: string | null; prioridade: string | null; shared: boolean;
 acao: string; mine: boolean; responsible: string | null; area: string | null; closed_at: string | null; created_at: string;
 meeting: { titulo: string; data: string | null } | null;
};
export type FilterCounts = { atrasadas: number; hoje: number; depois: number; sem_prazo: number; suas: number; cobrar: number; aguardando: number; concluidas: number; canceladas: number };
export type Selection = { tasks: PickedTask[]; total: number; counts: FilterCounts };
export type ListOrder = "prazo" | "recentes" | "prioridade";

export const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
/** The user named as a person: only the whole name ("eu", "Vitor"), never a group that includes him ("Tiago e Vitor"). */
const SELF = /^(?:vitor|eu|mim|comigo|voce|você)$/i;
const localDay = (timezone: string, d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function emptyFilter(): TaskFilter {
 return { all: false, status: "open", due: "", due_from: null, due_until: null, who: "", people: [], not_people: [], kind: "", priorities: [], boards: [], not_boards: [], areas: [], not_areas: [],
  meetings: [], meeting_from: null, meeting_until: null, source: "", words: [], not_words: [], created_from: null, created_until: null, closed_from: null, closed_until: null, idle_days: 0, repeated: false, except: [] };
}

/** At least one thing that narrows the selection; without one, only an explicit "todas" selects every open task. */
export function hasCriterion(f: TaskFilter) {
 return f.all || f.status !== "open" || !!f.due || !!f.who || f.people.length > 0 || !!f.kind || f.priorities.length > 0 || f.boards.length > 0 || f.areas.length > 0 || f.meetings.length > 0
  || !!f.meeting_from || !!f.meeting_until || !!f.source || f.words.length > 0 || !!f.created_from || !!f.created_until || !!f.closed_from || !!f.closed_until || f.idle_days > 0 || f.repeated;
}

/** Schema of the criteria in one item of the interpreter's output; codes are enums so nothing outside the lists can be cited. */
export function filterProperties(ctx: FilterContext, taskCodes: string[]) {
 const s = { type: "string" };
 const list = (items: Record<string, unknown>, max: number) => ({ type: "array", items, maxItems: max });
 const codes = (values: string[]) => ({ type: "string", enum: values.length ? values : [""] });
 const words = list({ type: "string", maxLength: 60 }, 8);
 return {
  all: { type: "boolean" }, status: { type: "string", enum: [...FILTER_STATUSES] },
  due: { type: "string", enum: ["", "none", "any", "range"] }, due_from: s, due_until: s,
  who: { type: "string", enum: ["", "me", "others", "nobody"] }, people: words, not_people: words,
  kind: { type: "string", enum: ["", "chase", "wait"] }, priorities: list({ type: "string", enum: [...PRIORITY_LEVELS] }, 4),
  boards: list(codes(ctx.boards.map(b => b.code)), 10), not_boards: list(codes(ctx.boards.map(b => b.code)), 10),
  areas: list(codes([...ctx.areas.map(a => a.code), NO_AREA]), 10), not_areas: list(codes([...ctx.areas.map(a => a.code), NO_AREA]), 10),
  meetings: list(codes(ctx.meetings.map(m => m.code)), 10), meeting_from: s, meeting_until: s, source: { type: "string", enum: ["", "meeting", "manual"] },
  words, not_words: words, created_from: s, created_until: s, closed_from: s, closed_until: s,
  idle_days: { type: "integer" }, repeated: { type: "boolean" },
  except: list(codes(taskCodes), 30),
 };
}

/**
 * Server-side check of the criteria the model wrote. Anything unreadable makes the whole selection unreadable (null):
 * dropping one criterion would silently select more tasks than the user asked for.
 */
export function readFilter(raw: Record<string, unknown>, ctx: FilterContext, tasksByCode: Map<string, { id: string }>, timezone: string, now: Date): TaskFilter | null {
 const today = localDay(timezone, now);
 const limit = `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`;
 let bad = false;
 const day = (v: unknown, max = limit) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2020-01-01" && v <= max && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))) return v;
  bad = true; return null;
 };
 const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | "" => {
  if (v === "" || v === undefined || v === null) return "";
  if (typeof v === "string" && (values as readonly string[]).includes(v)) return v as T;
  bad = true; return "";
 };
 let idle = 0;
 if (typeof raw.idle_days === "number" && Number.isInteger(raw.idle_days) && raw.idle_days > 0) { if (raw.idle_days <= 3650) idle = raw.idle_days; else bad = true; }
 else if (raw.idle_days !== undefined && !(typeof raw.idle_days === "number" && Number.isInteger(raw.idle_days))) bad = true;
 const names = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map(x => clip(x, 60)).filter(x => plain(x)))].slice(0, 8) : [];
 const coded = (v: unknown, map: Map<string, string>) => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const code of v) { if (code === "") continue; const id = typeof code === "string" ? map.get(code) : undefined; if (!id) { bad = true; continue; } if (!out.includes(id)) out.push(id); }
  return out;
 };
 const boards = new Map(ctx.boards.map(b => [b.code, b.id]));
 const areas = new Map([...ctx.areas.map(a => [a.code, a.nome] as [string, string]), [NO_AREA, NO_AREA]]);
 const meetings = new Map(ctx.meetings.map(m => [m.code, m.id]));
 const tasks = new Map([...tasksByCode].map(([code, t]) => [code, t.id]));
 const f: TaskFilter = {
  all: raw.all === true,
  status: oneOf(raw.status, FILTER_STATUSES) || "open",
  due: oneOf(raw.due, ["none", "any", "range"] as const),
  due_from: day(raw.due_from), due_until: day(raw.due_until),
  who: oneOf(raw.who, ["me", "others", "nobody"] as const),
  people: names(raw.people), not_people: names(raw.not_people),
  kind: oneOf(raw.kind, ["chase", "wait"] as const),
  priorities: Array.isArray(raw.priorities) ? [...new Set(raw.priorities.filter((p): p is Priority => (PRIORITY_LEVELS as readonly unknown[]).includes(p)))] : [],
  boards: coded(raw.boards, boards), not_boards: coded(raw.not_boards, boards),
  areas: coded(raw.areas, areas), not_areas: coded(raw.not_areas, areas),
  meetings: coded(raw.meetings, meetings), meeting_from: day(raw.meeting_from, today), meeting_until: day(raw.meeting_until, today),
  source: oneOf(raw.source, ["meeting", "manual"] as const),
  words: names(raw.words), not_words: names(raw.not_words),
  created_from: day(raw.created_from, today), created_until: day(raw.created_until, today),
  closed_from: day(raw.closed_from, today), closed_until: day(raw.closed_until, today),
  idle_days: idle,
  repeated: raw.repeated === true,
  except: coded(raw.except, tasks),
 };
 if (bad) return null;
 if (f.due === "range" && !f.due_from && !f.due_until) return null;
 if (f.due !== "range") { f.due_from = null; f.due_until = null; }
 if ((f.due_from && f.due_until && f.due_from > f.due_until) || (f.created_from && f.created_until && f.created_from > f.created_until)
  || (f.closed_from && f.closed_until && f.closed_from > f.closed_until) || (f.meeting_from && f.meeting_until && f.meeting_from > f.meeting_until)) return null;
 // A name that is the user's own means "mine": the app files the user's tasks under "Você", not under a person.
 if (f.people.some(p => SELF.test(p.trim()))) { f.people = f.people.filter(p => !SELF.test(p.trim())); if (!f.people.length && !f.who) f.who = "me"; }
 return hasCriterion(f) ? f : null;
}

type Row = {
 id: string; titulo: string; owner: string | null; is_mine: boolean | null; acao: string; status: string; prazo: Date | null; prioridade: string | null;
 created_at: Date; updated_at: Date | null; concluida_em: Date | null; cancelada_em: Date | null; meeting_id: string | null; parece_com_id: string | null;
 descricao: string | null; area: string | null; principal: string | null; pessoas: string[] | null; boards: string[] | null; shared: boolean;
 meeting_at: Date | null; meeting_titulo: string | null;
};
type Person = { nome: string; aliases: string[] | null; is_vitor: boolean | null };

/** Matches a name as the Coach always did (a first name matches any owner with that word), widened by the registry's full names and aliases. */
export function nameMatcher(wanted: string[], pessoas: Person[]) {
 const targets = new Set<string>();
 for (const w of wanted.map(plain).filter(Boolean)) {
  targets.add(w);
  for (const p of pessoas) {
   // Very short aliases ("Ti") would match unrelated words; the registry's names and longer aliases widen the match.
   const all = [p.nome, ...(p.aliases ?? [])].map(plain).filter(n => n.length >= 3);
   if (all.some(n => n === w || n.split(" ")[0] === w)) all.forEach(n => targets.add(n));
  }
 }
 return (name: string | null) => {
  if (!name) return false;
  const n = plain(name);
  const words = n.split(" ");
  for (const t of targets) if (n === t || (t.includes(" ") ? ` ${n} `.includes(` ${t} `) : words.includes(t))) return true;
  return false;
 };
}

/** The app's rule for whose task it is: "executar" is the user's; otherwise the main person, else the owner; "?" or empty is nobody. */
function responsibleOf(r: Row, isSelf: (name: string) => boolean): { mine: boolean; name: string | null } {
 if (r.acao === "executar" || r.is_mine) return { mine: true, name: null };
 const name = (r.principal || r.owner || "").trim();
 if (!name || name === "?") return { mine: false, name: null };
 if (isSelf(name)) return { mine: true, name: null };
 return { mine: false, name };
}

const STATUS_SETS: Record<FilterStatus, string[]> = { open: OPEN_STATUSES, in_progress: ["em_andamento"], done: ["concluida"], cancelled: ["cancelada"], closed: ["concluida", "cancelada"] };
const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Every task that matches, found by the server. `limit` only bounds what comes back; total and counts always
 * cover every match.
 */
export async function selectTasks(userId: string, f: TaskFilter, opts: { timezone: string; now: Date; limit?: number; order?: ListOrder }): Promise<Selection> {
 const { timezone, now } = opts;
 const statuses = STATUS_SETS[f.status];
 const { rows, pessoas } = await withTenant(userId, async db => ({
  rows: (await db.query<Row>(
   `SELECT t.id,t.titulo,t.owner,t.is_mine,t.acao,t.status,t.prazo,t.prioridade,t.created_at,t.updated_at,t.concluida_em,t.cancelada_em,t.meeting_id,t.parece_com_id,
     left(coalesce(t.descricao,''),2000) AS descricao,coalesce(f.nome,t.frente_proposta) AS area,
     (SELECT p.nome FROM tarefa_pessoas tp JOIN pessoas p ON p.id=tp.pessoa_id WHERE tp.tarefa_id=t.id AND tp.principal ORDER BY p.nome LIMIT 1) AS principal,
     ARRAY(SELECT p.nome FROM tarefa_pessoas tp JOIN pessoas p ON p.id=tp.pessoa_id WHERE tp.tarefa_id=t.id) AS pessoas,
     ARRAY(SELECT qt.quadro_id::text FROM quadro_tarefas qt WHERE qt.tarefa_id=t.id) AS boards,
     EXISTS(SELECT 1 FROM quadro_tarefas qt JOIN quadro_convidados qc ON qc.quadro_id=qt.quadro_id AND qc.revoked_at IS NULL WHERE qt.tarefa_id=t.id) AS shared,
     m.recorded_at AS meeting_at,coalesce(m.nome,m.original_filename) AS meeting_titulo
    FROM tarefas t LEFT JOIN frentes f ON f.id=t.frente_id LEFT JOIN meetings m ON m.id=t.meeting_id AND m.user_id=t.user_id
    WHERE t.user_id=$1 AND t.status=ANY($2::text[])`, [userId, statuses])).rows,
  pessoas: (await db.query<Person>("SELECT nome,aliases,is_vitor FROM pessoas WHERE user_id=$1", [userId])).rows,
 }));
 const selfNames = new Set(pessoas.filter(p => p.is_vitor).flatMap(p => [p.nome, ...(p.aliases ?? [])]).map(plain).filter(n => n.length >= 3));
 const isSelf = (name: string) => SELF.test(name.trim()) || selfNames.has(plain(name));
 // The user's own name in a list of people means their own tasks, which the app files under "Você".
 const wantsSelf = f.people.some(isSelf), skipsSelf = f.not_people.some(isSelf);
 const others = f.people.filter(p => !isSelf(p)), notOthers = f.not_people.filter(p => !isSelf(p));
 const wanted = others.length ? nameMatcher(others, pessoas) : null;
 const unwanted = notOthers.length ? nameMatcher(notOthers, pessoas) : null;
 const words = f.words.map(plain).filter(Boolean), notWords = f.not_words.map(plain).filter(Boolean);
 const areas = new Set(f.areas.map(a => (a === NO_AREA ? NO_AREA : plain(a)))), notAreas = new Set(f.not_areas.map(a => (a === NO_AREA ? NO_AREA : plain(a))));
 const except = new Set(f.except);
 const today = localDay(timezone, now);
 const day = (d: Date | null) => (d ? localDay(timezone, new Date(d)) : null);
 const within = (value: string | null, from: string | null, until: string | null) => !!value && (!from || value >= from) && (!until || value <= until);
 const idleSince = f.idle_days ? now.getTime() - f.idle_days * 86400_000 : null;

 const matched = rows.flatMap(r => {
  if (except.has(r.id)) return [];
  const who = responsibleOf(r, isSelf);
  const prazo = day(r.prazo);
  const area = r.area?.trim() ? plain(r.area) : NO_AREA;
  const closedAt = r.concluida_em ?? r.cancelada_em ?? (r.status === "concluida" || r.status === "cancelada" ? r.updated_at : null);
  if (f.due === "none" && prazo) return [];
  if (f.due === "any" && !prazo) return [];
  if (f.due === "range" && !within(prazo, f.due_from, f.due_until)) return [];
  if (f.who === "me" && !who.mine) return [];
  if (f.who === "others" && (who.mine || !who.name)) return [];
  if (f.who === "nobody" && (who.mine || who.name)) return [];
  if (f.people.length && !(who.mine ? wantsSelf : !!wanted?.(who.name))) return [];
  if (who.mine ? skipsSelf : !!unwanted?.(who.name)) return [];
  if (f.kind === "chase" && (who.mine || r.acao !== "cobrar")) return [];
  if (f.kind === "wait" && (who.mine || r.acao !== "aguardar")) return [];
  if (f.priorities.length && !f.priorities.includes(r.prioridade as Priority)) return [];
  if (f.boards.length && !f.boards.some(b => r.boards?.includes(b))) return [];
  if (f.not_boards.length && f.not_boards.some(b => r.boards?.includes(b))) return [];
  if (areas.size && !areas.has(area)) return [];
  if (notAreas.size && notAreas.has(area)) return [];
  if (f.meetings.length && !(r.meeting_id && f.meetings.includes(r.meeting_id))) return [];
  if ((f.meeting_from || f.meeting_until) && !within(day(r.meeting_at), f.meeting_from, f.meeting_until)) return [];
  if (f.source === "meeting" && !r.meeting_id) return [];
  if (f.source === "manual" && r.meeting_id) return [];
  if (words.length || notWords.length) {
   const hay = ` ${plain([r.titulo, r.descricao, r.owner, r.area, r.principal, ...(r.pessoas ?? [])].filter(Boolean).join(" "))} `;
   if (!words.every(w => hay.includes(w))) return [];
   if (notWords.some(w => hay.includes(w))) return [];
  }
  if ((f.created_from || f.created_until) && !within(day(r.created_at), f.created_from, f.created_until)) return [];
  if ((f.closed_from || f.closed_until) && !within(day(closedAt), f.closed_from, f.closed_until)) return [];
  if (idleSince !== null && new Date(r.updated_at ?? r.created_at).getTime() >= idleSince) return [];
  if (f.repeated && !r.parece_com_id) return [];
  const task: PickedTask = {
   id: r.id, titulo: r.titulo, owner: r.owner, is_mine: r.is_mine, status: r.status, prazo: iso(r.prazo), prioridade: r.prioridade, shared: r.shared,
   acao: r.acao, mine: who.mine, responsible: who.name, area: r.area?.trim() || null, closed_at: iso(closedAt), created_at: iso(r.created_at)!,
   meeting: r.meeting_id && r.meeting_titulo ? { titulo: r.meeting_titulo, data: iso(r.meeting_at) } : null,
  };
  return [task];
 });

 const counts: FilterCounts = { atrasadas: 0, hoje: 0, depois: 0, sem_prazo: 0, suas: 0, cobrar: 0, aguardando: 0, concluidas: 0, canceladas: 0 };
 for (const t of matched) {
  const d = t.prazo ? localDay(timezone, new Date(t.prazo)) : null;
  if (!d) counts.sem_prazo++; else if (d < today) counts.atrasadas++; else if (d === today) counts.hoje++; else counts.depois++;
  if (t.mine) counts.suas++; else if (t.acao === "aguardar") counts.aguardando++; else counts.cobrar++;
  if (t.status === "concluida") counts.concluidas++; else if (t.status === "cancelada") counts.canceladas++;
 }
 const due = (t: PickedTask) => (t.prazo ? Date.parse(t.prazo) : Infinity);
 const created = (t: PickedTask) => Date.parse(t.created_at);
 const order = opts.order ?? (f.status === "open" || f.status === "in_progress" ? "prazo" : "fechadas");
 matched.sort((a, b) =>
  order === "recentes" ? created(b) - created(a) || a.id.localeCompare(b.id)
  : order === "prioridade" ? (PRIORITY_RANK[a.prioridade ?? ""] ?? 9) - (PRIORITY_RANK[b.prioridade ?? ""] ?? 9) || due(a) - due(b) || a.id.localeCompare(b.id)
  : order === "fechadas" ? Date.parse(b.closed_at ?? b.created_at) - Date.parse(a.closed_at ?? a.created_at) || a.id.localeCompare(b.id)
  : due(a) - due(b) || created(b) - created(a) || a.id.localeCompare(b.id));
 return { tasks: matched.slice(0, opts.limit ?? matched.length), total: matched.length, counts };
}

const joinOr = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`);
const joinAnd = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`);
const range = (from: string | null, until: string | null, word: string) =>
 from && until ? (from === until ? `${word} em ${dm(from)}` : `${word} de ${dm(from)} a ${dm(until)}`) : until ? `${word} até ${dm(until)}` : from ? `${word} a partir de ${dm(from)}` : "";

/** The criteria in the user's words ("sem prazo, de Tiago"), so a proposal says exactly what it will touch. */
export function filterWords(f: TaskFilter, ctx: FilterContext, timezone: string, now: Date, exceptTitles: string[] = []) {
 const today = localDay(timezone, now);
 const parts: string[] = [];
 const status = { open: "", in_progress: "em andamento", done: "concluídas", cancelled: "canceladas", closed: "concluídas ou canceladas" }[f.status];
 if (status && !f.closed_from && !f.closed_until) parts.push(status);
 if (f.due === "none") parts.push("sem prazo");
 else if (f.due === "any") parts.push("com prazo");
 else if (f.due === "range") parts.push(!f.due_from && f.due_until === addDays(today, -1) ? "atrasadas" : range(f.due_from, f.due_until, "com prazo"));
 if (f.who === "me") parts.push("suas");
 else if (f.who === "others") parts.push("de outras pessoas");
 else if (f.who === "nobody") parts.push("sem responsável");
 if (f.people.length) parts.push(`de ${joinOr(f.people)}`);
 if (f.kind === "chase") parts.push("para você cobrar");
 else if (f.kind === "wait") parts.push("que você está aguardando");
 if (f.priorities.length) parts.push(`de prioridade ${joinOr([...f.priorities].sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b]).map(p => (p === "media" ? "média" : p)))}`);
 const board = (id: string) => `"${ctx.boards.find(b => b.id === id)?.nome ?? "?"}"`;
 if (f.boards.length) parts.push(`${f.boards.length > 1 ? "dos quadros" : "do quadro"} ${joinOr(f.boards.map(board))}`);
 const area = (a: string) => (a === NO_AREA ? "sem área" : `"${a}"`);
 if (f.areas.length) parts.push(f.areas.length === 1 && f.areas[0] === NO_AREA ? "sem área" : `da área ${joinOr(f.areas.map(area))}`);
 const meeting = (id: string) => { const m = ctx.meetings.find(x => x.id === id); return m ? `"${clip(m.titulo, 60)}"${m.data ? ` (${new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(new Date(m.data))})` : ""}` : "citada"; };
 if (f.meetings.length) parts.push(`${f.meetings.length > 1 ? "das reuniões" : "da reunião"} ${joinOr(f.meetings.map(meeting))}`);
 if (f.meeting_from || f.meeting_until) parts.push(range(f.meeting_from, f.meeting_until, "de reuniões"));
 if (f.source === "meeting") parts.push("que vieram de reuniões");
 else if (f.source === "manual") parts.push("criadas à mão");
 if (f.words.length) parts.push(`sobre ${joinAnd(f.words.map(w => `"${w}"`))}`);
 if (f.created_from || f.created_until) parts.push(range(f.created_from, f.created_until, "criadas"));
 if (f.closed_from || f.closed_until) parts.push(range(f.closed_from, f.closed_until, f.status === "done" ? "concluídas" : f.status === "cancelled" ? "canceladas" : "fechadas"));
 if (f.idle_days) parts.push(`paradas há mais de ${f.idle_days} ${f.idle_days === 1 ? "dia" : "dias"}`);
 if (f.repeated) parts.push("marcadas como possível repetição");
 const but: string[] = [];
 if (f.not_people.length) but.push(`as de ${joinOr(f.not_people)}`);
 if (f.not_boards.length) but.push(`as ${f.not_boards.length > 1 ? "dos quadros" : "do quadro"} ${joinOr(f.not_boards.map(board))}`);
 if (f.not_areas.length) but.push(f.not_areas.length === 1 && f.not_areas[0] === NO_AREA ? "as sem área" : `as da área ${joinOr(f.not_areas.map(area))}`);
 if (f.not_words.length) but.push(`as sobre ${joinOr(f.not_words.map(w => `"${w}"`))}`);
 if (exceptTitles.length) but.push(exceptTitles.length <= 2 ? joinAnd(exceptTitles.map(t => `"${clip(t, 60)}"`)) : `${exceptTitles.length} que você tirou`);
 if (!parts.length) parts.push("abertas");
 return [parts.join(", "), but.length ? `menos ${joinAnd(but)}` : ""].filter(Boolean).join(", ");
}

/** "São 77 suas, 63 para você cobrar e 14 que você está aguardando." Only when more than one kind is in the selection. */
export function countsLine(c: Pick<FilterCounts, "suas" | "cobrar" | "aguardando">) {
 const parts = [c.suas ? `${c.suas} ${c.suas === 1 ? "sua" : "suas"}` : "", c.cobrar ? `${c.cobrar} para você cobrar` : "", c.aguardando ? `${c.aguardando} que você está aguardando` : ""].filter(Boolean);
 return parts.length > 1 ? `São ${joinAnd(parts)}.` : "";
}

const MEETING_WORDS = /\b(?:reuni|call|meet|encontro|conversa|papo|grava)/u;

/** The boards and areas the user has and, when the message mentions a meeting, the latest meetings, each under a short code. */
export async function filterContext(userId: string, message: string): Promise<FilterContext> {
 return withTenant(userId, async db => {
  const boards = (await db.query<{ id: string; nome: string }>("SELECT id,nome FROM quadros WHERE user_id=$1 AND archived_at IS NULL ORDER BY nome LIMIT 40", [userId])).rows;
  const areas = (await db.query<{ nome: string }>(
   `SELECT nome FROM (SELECT DISTINCT btrim(coalesce(f.nome,t.frente_proposta)) AS nome FROM tarefas t LEFT JOIN frentes f ON f.id=t.frente_id
     WHERE t.user_id=$1 AND coalesce(f.nome,t.frente_proposta) IS NOT NULL AND btrim(coalesce(f.nome,t.frente_proposta))<>''
    UNION SELECT btrim(nome) FROM frentes WHERE user_id=$1 AND ativo) a ORDER BY nome LIMIT 60`, [userId])).rows;
  const meetings = MEETING_WORDS.test(plain(message)) ? (await db.query<{ id: string; titulo: string; recorded_at: Date | null; participantes: string[] | null }>(
   `SELECT m.id,coalesce(m.nome,m.original_filename) AS titulo,m.recorded_at,
     ARRAY(SELECT DISTINCT p.nome FROM jsonb_each_text(CASE WHEN jsonb_typeof(m.speaker_pessoas)='object' THEN m.speaker_pessoas ELSE '{}'::jsonb END) sp JOIN pessoas p ON p.id::text=sp.value AND p.user_id=$1 WHERE NOT coalesce(p.is_vitor,false)) AS participantes
    FROM meetings m WHERE m.user_id=$1 AND m.status='done' AND EXISTS(SELECT 1 FROM tarefas t WHERE t.user_id=$1 AND t.meeting_id=m.id)
    ORDER BY m.recorded_at DESC NULLS LAST LIMIT 25`, [userId])).rows : [];
  const seen = new Set<string>();
  return {
   boards: boards.map((b, i) => ({ code: `q${i + 1}`, id: b.id, nome: b.nome })),
   areas: areas.filter(a => { const k = plain(a.nome); if (!k || seen.has(k)) return false; seen.add(k); return true; }).map((a, i) => ({ code: `a${i + 1}`, nome: a.nome })),
   meetings: meetings.map((m, i) => ({ code: `r${i + 1}`, id: m.id, titulo: m.titulo, data: iso(m.recorded_at), participantes: (m.participantes ?? []).slice(0, 6) })),
  };
 });
}

/** The lists the interpreter reads next to its instruction (codes only; ids stay on the server). */
export function contextForModel(ctx: FilterContext, timezone: string) {
 const date = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, weekday: "short", day: "2-digit", month: "2-digit" });
 return {
  boards: ctx.boards.map(b => ({ code: b.code, name: clip(b.nome, 80) })),
  areas: ctx.areas.map(a => ({ code: a.code, name: clip(a.nome, 60) })),
  ...(ctx.meetings.length ? { meetings: ctx.meetings.map(m => ({ code: m.code, title: clip(m.titulo, 90), date: m.data ? date.format(new Date(m.data)).replace(".", "") : "", people: m.participantes })) } : {}),
 };
}

export const FILTER_GUIDE = `CRITÉRIOS (vazio = não filtra; combine todos os que o pedido disser):
- all=true só para "todas", "tudo", "todas as abertas" sem outro critério.
- status: open (padrão: abertas), in_progress (em andamento), done (concluídas), cancelled (canceladas), closed (concluídas ou canceladas).
- due: none (sem prazo), any (com prazo), range (due_from e due_until, AAAA-MM-DD inclusivos, contados de now_local: "atrasadas" = due_until ontem; "até 24/09" ou "do dia 24 pra trás" = due_until 24/09; "as de hoje" = due_from e due_until hoje; "o que tenho pra hoje" = due_until hoje; "desta semana", "de julho" = o intervalo inteiro).
- who: me (do próprio usuário, "minhas"), others (de outras pessoas), nobody (sem responsável). people: nomes citados (as de qualquer um deles). not_people: nomes tirados ("menos as do Tiago"). "De qualquer responsável" ou "de todo mundo" = who vazio.
- kind: chase (as que o usuário tem de cobrar de alguém), wait (as que ele só está aguardando).
- priorities: "urgentes" = urgente; "importantes" ou "prioritárias" = alta e urgente; "sem importância" = baixa.
- boards e not_boards: códigos de boards (quadro ou projeto citado). areas e not_areas: códigos de areas (área citada; sem_area = sem área).
- meetings: códigos de meetings (reunião citada, pelo título, pela data ou por quem participou). meeting_from e meeting_until: data das reuniões de onde as tarefas vieram. source: meeting (vieram de reunião) ou manual (criadas à mão).
- words e not_words: palavras do assunto que a tarefa tem (ou não tem) no título ou na descrição, sem artigos ("as do site" → site); use quando nenhum quadro ou área tem esse nome.
- created_from e created_until: quando a tarefa foi criada ("criadas em julho", "as antigas, de antes de agosto"). closed_from e closed_until: quando foi concluída ou cancelada ("as que concluí hoje").
- idle_days: sem mexer há N dias ("paradas há um mês" = 30). repeated=true: marcadas como possível repetição.
- except: códigos da lista tasks que o pedido tira ("menos a do agente de gravação").`;

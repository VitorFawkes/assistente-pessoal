import type { PoolClient } from "pg";
import type { Tarefa } from "../queries";
import { contextSearchTerms, type ContextPeriod } from "./context-selection";

export type CoachTask = Pick<Tarefa,
  "id" | "titulo" | "descricao" | "owner" | "is_mine" | "acao" | "status" |
  "prioridade" | "prazo" | "meeting_id" | "frente" | "concluida_em" |
  "cancelada_em" | "created_at" | "updated_at"
> & {context_reasons:TaskContextReason[]; frentes:{id:string;nome:string}[]};
export type TaskContextReason = "open_priority" | "query_match" | "period_activity" | "recent_activity";
export type CoachTaskEvent = {
  id: string;
  tarefa_id: string;
  tarefa_titulo: string;
  evento: string;
  payload: unknown;
  created_at: string;
};

export type TaskSummary = {
  total:number;open:number;mine_open:number;delegated_open:number;high_priority_open:number;overdue_open:number;completed:number;cancelled:number;
  fronts:{id:string|null;name:string;total:number;open:number;high_priority_open:number;overdue_open:number}[];
  period:{tasks_active:number;completed:number;cancelled:number;events:number}|null;
};
export type TaskSelection = {tasks_selected:number;tasks_total:number;events_selected:number;events_total:number;task_limit:number;event_limit:number};
export type TaskContext = {tasks:CoachTask[];events:CoachTaskEvent[];task_summary:TaskSummary;task_selection:TaskSelection};

/** Caller supplies withTenant's client. Explicit ownership remains a second boundary. */
export async function loadTaskContext(db: PoolClient, userId: string, options:{now?:Date;period?:ContextPeriod|null;search?:string} = {}): Promise<TaskContext> {
  const now = (options.now ?? new Date()).toISOString();
  const period = options.period;
  const values = [userId,now,period?.from ?? null,period?.to ?? null,contextSearchTerms(options.search ?? "")];
  const open = "t.status NOT IN ('concluida','cancelada')";
  // Updated timestamps are record activity, never proof that the work itself happened then.
  const periodActivity = `($3::timestamptz IS NOT NULL AND (
    (t.created_at >= $3 AND t.created_at < $4) OR (t.updated_at >= $3 AND t.updated_at < $4)
    OR (t.concluida_em >= $3 AND t.concluida_em < $4) OR (t.cancelada_em >= $3 AND t.cancelada_em < $4)
    OR EXISTS (SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id=t.id AND e.created_at >= $3 AND e.created_at < $4)))`;
  const summary = (await db.query<Omit<TaskSummary,"fronts"|"period"> & {period_active:number;period_completed:number;period_cancelled:number}>(
    `SELECT count(*)::int AS total,count(*) FILTER(WHERE ${open})::int AS open,
      count(*) FILTER(WHERE ${open} AND t.acao='executar')::int AS mine_open,
      count(*) FILTER(WHERE ${open} AND t.acao IN ('cobrar','aguardar'))::int AS delegated_open,
      count(*) FILTER(WHERE ${open} AND t.prioridade IN ('alta','urgente'))::int AS high_priority_open,
      count(*) FILTER(WHERE ${open} AND t.prazo < $2::timestamptz)::int AS overdue_open,
      count(*) FILTER(WHERE t.status='concluida')::int AS completed,
      count(*) FILTER(WHERE t.status='cancelada')::int AS cancelled,
      count(*) FILTER(WHERE ${periodActivity})::int AS period_active,
      count(*) FILTER(WHERE t.concluida_em >= $3 AND t.concluida_em < $4)::int AS period_completed,
      count(*) FILTER(WHERE t.cancelada_em >= $3 AND t.cancelada_em < $4)::int AS period_cancelled
     FROM tarefas t WHERE t.user_id=$1`,values.slice(0,4))).rows[0];
  // Count every owned task in every associated front. Multi-front counts intentionally overlap.
  const fronts = await db.query<TaskSummary["fronts"][number]>(
    `WITH links AS (
       SELECT t.id AS tarefa_id,f.id,f.nome FROM tarefas t JOIN tarefa_frentes tf ON tf.tarefa_id=t.id
         JOIN frentes f ON f.id=tf.frente_id AND f.user_id=$1 WHERE t.user_id=$1
       UNION SELECT t.id,f.id,f.nome FROM tarefas t JOIN frentes f ON f.id=t.frente_id AND f.user_id=$1 WHERE t.user_id=$1
     ) SELECT l.id,coalesce(l.nome,'Sem frente') AS name,count(*)::int AS total,
       count(*) FILTER(WHERE ${open})::int AS open,
       count(*) FILTER(WHERE ${open} AND t.prioridade IN ('alta','urgente'))::int AS high_priority_open,
       count(*) FILTER(WHERE ${open} AND t.prazo < $2::timestamptz)::int AS overdue_open
     FROM tarefas t LEFT JOIN links l ON l.tarefa_id=t.id WHERE t.user_id=$1
     GROUP BY l.id,l.nome ORDER BY open DESC,total DESC,l.nome,l.id`,values.slice(0,2));
  const candidates = await db.query<CoachTask>(
    `WITH base AS (
       SELECT t.*,${open} AS is_open,${periodActivity} AS in_period,t.prazo < $2::timestamptz AS overdue,
         CASE t.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END AS priority_order,
         ts_rank_cd(to_tsvector('portuguese',t.titulo||' '||coalesce(t.descricao,'')||' '||coalesce(t.owner,'')||' '||
           coalesce((SELECT string_agg(f.nome,' ') FROM frentes f WHERE f.user_id=$1 AND (f.id=t.frente_id OR EXISTS
             (SELECT 1 FROM tarefa_frentes tf WHERE tf.tarefa_id=t.id AND tf.frente_id=f.id))),'')),
           array_to_string(tsvector_to_array(to_tsvector('portuguese',$5)), ' | ')::tsquery) AS relevance
       FROM tarefas t WHERE t.user_id=$1
     ), chosen AS (
       (SELECT id,'open_priority' AS reason FROM base WHERE is_open
          ORDER BY priority_order,overdue DESC NULLS LAST,prazo NULLS LAST,updated_at,id LIMIT 24)
       UNION ALL (SELECT id,'query_match' FROM base WHERE relevance>0 AND ($3::timestamptz IS NULL OR is_open OR in_period)
          ORDER BY relevance DESC,updated_at DESC,id LIMIT 16)
       UNION ALL (SELECT id,'period_activity' FROM base WHERE in_period ORDER BY updated_at DESC,id LIMIT 24)
       UNION ALL (SELECT id,'recent_activity' FROM base WHERE $3::timestamptz IS NULL ORDER BY updated_at DESC,id LIMIT 16)
     ), selected AS (SELECT id,array_agg(reason ORDER BY reason) AS reasons FROM chosen GROUP BY id)
     SELECT t.id,t.titulo,left(t.descricao,3000) AS descricao,t.owner,t.is_mine,t.acao,t.status,t.prioridade,
       t.prazo,t.meeting_id,f.nome AS frente,t.concluida_em,t.cancelada_em,t.created_at,t.updated_at,
       s.reasons AS context_reasons,coalesce((SELECT jsonb_agg(jsonb_build_object('id',ff.id,'nome',ff.nome) ORDER BY ff.nome)
         FROM frentes ff WHERE ff.user_id=$1 AND (ff.id=t.frente_id OR EXISTS
           (SELECT 1 FROM tarefa_frentes tf WHERE tf.tarefa_id=t.id AND tf.frente_id=ff.id))),'[]'::jsonb) AS frentes
     FROM selected s JOIN base t ON t.id=s.id LEFT JOIN frentes f ON f.id=t.frente_id AND f.user_id=$1
     ORDER BY ('open_priority'=ANY(s.reasons)) DESC,('query_match'=ANY(s.reasons)) DESC,t.priority_order,t.prazo NULLS LAST,t.updated_at DESC,t.id
     LIMIT 64`,values);
  const eventValues = [userId,period?.from ?? null,period?.to ?? null];
  const eventFilter = "t.user_id=$1 AND ($2::timestamptz IS NULL OR (e.created_at >= $2 AND e.created_at < $3::timestamptz))";
  const eventsTotal = (await db.query<{total:number}>(`SELECT count(*)::int AS total FROM tarefa_eventos e JOIN tarefas t ON t.id=e.tarefa_id WHERE ${eventFilter}`,eventValues)).rows[0].total;
  const events = await db.query<CoachTaskEvent>(
    `SELECT e.id,e.tarefa_id,t.titulo AS tarefa_titulo,e.evento,e.payload,e.created_at
     FROM tarefa_eventos e JOIN tarefas t ON t.id=e.tarefa_id WHERE ${eventFilter}
     ORDER BY e.created_at DESC,e.id DESC LIMIT 40`,eventValues);
  const {period_active,period_completed,period_cancelled,...totals} = summary;
  // pg returns timestamps as Date; the model/UI contract is serializable ISO strings.
  return JSON.parse(JSON.stringify({tasks:candidates.rows,events:events.rows,
    task_summary:{...totals,fronts:fronts.rows,period:period ? {tasks_active:period_active,completed:period_completed,cancelled:period_cancelled,events:eventsTotal} : null},
    task_selection:{tasks_selected:candidates.rows.length,tasks_total:summary.total,events_selected:events.rows.length,events_total:eventsTotal,task_limit:64,event_limit:40},
  }));
}

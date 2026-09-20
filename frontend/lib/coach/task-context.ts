import type { PoolClient } from "pg";
import type { Tarefa } from "../queries";

export type CoachTask = Pick<Tarefa,
  "id" | "titulo" | "descricao" | "owner" | "is_mine" | "acao" | "status" |
  "prioridade" | "prazo" | "meeting_id" | "frente" | "concluida_em" |
  "cancelada_em" | "created_at" | "updated_at"
>;
export type CoachTaskEvent = {
  id: string;
  tarefa_id: string;
  tarefa_titulo: string;
  evento: string;
  payload: unknown;
  created_at: string;
};

/** Caller must supply the transaction client from withTenant(userId, ...). */
export async function loadTaskContext(db: PoolClient, userId: string): Promise<{tasks: CoachTask[]; events: CoachTaskEvent[]}> {
  const tasks = await db.query<CoachTask>(
    `SELECT t.id,t.titulo,t.descricao,t.owner,t.is_mine,t.acao,t.status,t.prioridade,
            t.prazo,t.meeting_id,f.nome AS frente,t.concluida_em,t.cancelada_em,t.created_at,t.updated_at
     FROM tarefas t
     LEFT JOIN frentes f ON f.id=t.frente_id AND f.user_id=$1
     WHERE t.user_id=$1
     ORDER BY t.updated_at DESC,t.id DESC LIMIT 40`, [userId]);
  // Recent activity can concern a task outside the latest 40 task updates.
  // Events inherit ownership through tarefas; they have no user_id column.
  const events = await db.query<CoachTaskEvent>(
    `SELECT e.id,e.tarefa_id,t.titulo AS tarefa_titulo,e.evento,e.payload,e.created_at
     FROM tarefa_eventos e JOIN tarefas t ON t.id=e.tarefa_id
     WHERE t.user_id=$1
     ORDER BY e.created_at DESC,e.id DESC LIMIT 40`, [userId]);
  // pg returns timestamp columns as Date; the model/UI contract uses ISO strings.
  return JSON.parse(JSON.stringify({tasks: tasks.rows, events: events.rows}));
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { loadTaskContext } from "./task-context";
import { resolveContextPeriod } from "./context-selection";

// Local opt-in only. Temporary tables and a private connection never alter public fixtures.
const connection = process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("coach task context: ownership and execution history", () => {
  let pool: Pool;
  let db: PoolClient;
  const userA = randomUUID();
  const userB = randomUUID();
  const frontA = randomUUID();
  const frontB = randomUUID();
  let oldTaskId: string;

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("coach_test"))
      throw new Error("Requires the local dedicated coach_test database.");
    pool = new Pool({connectionString: connection});
    db = await pool.connect();
    await db.query(`BEGIN;
      SET LOCAL TIME ZONE 'UTC';
      CREATE TEMP TABLE frentes(id uuid PRIMARY KEY, user_id uuid NOT NULL, nome text);
      CREATE TEMP TABLE tarefas(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, titulo text NOT NULL,
        descricao text, owner text, is_mine boolean, acao text, status text, prioridade text,
        prazo timestamptz, meeting_id uuid, frente_id uuid, concluida_em timestamptz, cancelada_em timestamptz,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE tarefa_eventos(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tarefa_id uuid NOT NULL,
        evento text, payload jsonb, created_at timestamptz NOT NULL);
      CREATE TEMP TABLE tarefa_frentes(tarefa_id uuid, frente_id uuid, principal boolean);`);
    await db.query("SELECT set_config('app.current_user_id',$1,true)", [userA]);
    await db.query("INSERT INTO frentes VALUES($1,$2,'Frente A'),($3,$4,'Frente B privada')", [frontA,userA,frontB,userB]);
    await db.query(`INSERT INTO tarefas(user_id,titulo,owner,is_mine,acao,status,prioridade,frente_id,updated_at)
      SELECT $1,'A-'||n,'vitor',true,'executar','aberta','media',$2,'2026-09-01'::timestamptz + n*interval '1 minute'
      FROM generate_series(0,44) n`, [userA,frontA]);
    await db.query(`UPDATE tarefas SET acao='cobrar',owner='Responsável',is_mine=false,status='cancelada',
      cancelada_em='2026-09-02',frente_id=$1 WHERE titulo='A-44'`, [frontB]);
    await db.query("UPDATE tarefas SET status='concluida',concluida_em='2026-09-02' WHERE titulo='A-43'");
    const oldTask = await db.query<{id: string}>("SELECT id FROM tarefas WHERE titulo='A-0'");
    oldTaskId = oldTask.rows[0].id;
    await db.query("UPDATE tarefas SET prioridade='urgente',prazo='2026-08-01',descricao='Resolver contrato orquídea' WHERE id=$1",[oldTaskId]);
    await db.query(`INSERT INTO tarefa_eventos(tarefa_id,evento,payload,created_at)
      SELECT $1,'editada',jsonb_build_object('revision',n),'2026-09-03'::timestamptz+n*interval '1 minute'
      FROM generate_series(0,44) n`, [oldTaskId]);
    const foreign = await db.query<{id:string}>(`INSERT INTO tarefas(user_id,titulo,owner,is_mine,acao,status,prioridade,frente_id)
      VALUES($1,'B-privada','vitor',true,'executar','aberta','media',$2) RETURNING id`, [userB,frontB]);
    await db.query("INSERT INTO tarefa_eventos(tarefa_id,evento,payload,created_at) VALUES($1,'editada','{\"private\":true}','2099-01-01')",[foreign.rows[0].id]);
  });

  afterAll(async () => {
    await db?.query("ROLLBACK");
    db?.release();
    await pool?.end();
  });

  test("preserves delegation mode and actual completion/cancellation timestamps", async () => {
    const {tasks} = await loadTaskContext(db,userA);
    const canceled = tasks.find(t=>t.titulo==="A-44")!;
    const completed = tasks.find(t=>t.titulo==="A-43")!;
    expect(canceled).toMatchObject({acao:"cobrar",is_mine:false,status:"cancelada",concluida_em:null});
    expect(canceled.cancelada_em).toBe("2026-09-02T00:00:00.000Z");
    expect(completed).toMatchObject({status:"concluida",cancelada_em:null});
    expect(completed.concluida_em).toBe("2026-09-02T00:00:00.000Z");
  });

  test("does not lose an old urgent commitment behind 40 newer tasks; aggregates the whole workload", async () => {
    const {tasks,events,task_summary,task_selection} = await loadTaskContext(db,userA,{now:new Date("2026-09-04T12:00:00Z")});
    expect(tasks.length).toBeLessThanOrEqual(64);
    expect(tasks.find(t=>t.id===oldTaskId)?.context_reasons).toContain("open_priority");
    expect(task_summary).toMatchObject({total:45,open:43,completed:1,cancelled:1,mine_open:43,delegated_open:0,overdue_open:1,high_priority_open:1});
    expect(task_summary.fronts).toEqual(expect.arrayContaining([expect.objectContaining({id:frontA,total:44,open:43})]));
    expect(task_selection).toMatchObject({tasks_selected:tasks.length,tasks_total:45,events_selected:40,events_total:45});
    expect(events).toHaveLength(40);
    expect(events[0]).toMatchObject({tarefa_id:oldTaskId,tarefa_titulo:"A-0",payload:{revision:44}});
    expect(events[39].payload).toEqual({revision:5});
    expect(typeof events[0].created_at).toBe("string");
  });

  test("explicit ownership filters protect tasks, events and cross-tenant front references", async () => {
    // This connection owns the temporary tables; passing only through RLS would not protect it.
    const a = await loadTaskContext(db,userA);
    expect(a.tasks.every(t=>t.titulo.startsWith("A-"))).toBe(true);
    expect(a.events.every(e=>e.tarefa_titulo==="A-0")).toBe(true);
    expect(a.tasks.find(t=>t.titulo==="A-44")?.frente).toBeNull();
    expect(a.tasks.find(t=>t.titulo==="A-43")?.frente).toBe("Frente A");
    expect(JSON.stringify(a.task_summary)).not.toContain("Frente B privada");
    const b = await loadTaskContext(db,userB);
    expect(b.tasks).toHaveLength(1);
    expect(b.tasks[0].titulo).toBe("B-privada");
    expect(b.events).toHaveLength(1);
    expect(b.events[0].payload).toEqual({private:true});
  });

  test("day context separates open workload from that day's activity, without old events", async () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const period = resolveContextPeriod("hoje",{now,timezone:"UTC"})!;
    const context = await loadTaskContext(db,userA,{now,period,search:"orquídea"});
    expect(context.tasks.find(t=>t.id===oldTaskId)?.context_reasons).toEqual(expect.arrayContaining(["open_priority","query_match","period_activity"]));
    expect(context.tasks.some(t=>t.status==="concluida"||t.status==="cancelada")).toBe(false);
    expect(context.task_summary.period).toMatchObject({tasks_active:1,completed:0,cancelled:0,events:45});
    const empty = await loadTaskContext(db,userA,{now,period:resolveContextPeriod("hoje",{now:new Date("2026-09-10T12:00:00Z"),timezone:"UTC"})!});
    expect(empty.events).toEqual([]);
    expect(empty.tasks.every(t=>t.context_reasons.every(r=>r==="open_priority"))).toBe(true);
    expect(empty.task_summary.period).toMatchObject({tasks_active:0,events:0});
  });

  test("execution and follow-up load use the current action, not the legacy Vitor flag", async () => {
    const otherUser = randomUUID();
    await db.query(`INSERT INTO tarefas(user_id,titulo,owner,is_mine,acao,status,prioridade)
      VALUES($1,'Entrega da Clara','Clara',false,'executar','aberta','alta'),
        ($1,'Cobrar retorno','vitor',true,'cobrar','aberta','media'),
        ($1,'Aguardar aprovação','vitor',true,'aguardar','aberta','media')`,[otherUser]);
    const context = await loadTaskContext(db,otherUser);
    expect(context.task_summary).toMatchObject({total:3,open:3,mine_open:1,delegated_open:2});
    expect(context.tasks.find(t=>t.titulo==='Entrega da Clara')).toMatchObject({owner:'Clara',is_mine:false,acao:'executar'});
  });
});

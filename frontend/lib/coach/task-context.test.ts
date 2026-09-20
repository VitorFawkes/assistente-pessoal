import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { loadTaskContext } from "./task-context";

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
        evento text, payload jsonb, created_at timestamptz NOT NULL);`);
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
    expect(tasks[0]).toMatchObject({titulo:"A-44",acao:"cobrar",is_mine:false,status:"cancelada",concluida_em:null});
    expect(tasks[0].cancelada_em).toBe("2026-09-02T00:00:00.000Z");
    expect(tasks[1]).toMatchObject({titulo:"A-43",status:"concluida",cancelada_em:null});
    expect(tasks[1].concluida_em).toBe("2026-09-02T00:00:00.000Z");
  });

  test("bounds recent tasks and retains recent events from older owned tasks", async () => {
    const {tasks,events} = await loadTaskContext(db,userA);
    expect(tasks).toHaveLength(40);
    expect(tasks[39].titulo).toBe("A-5");
    expect(tasks.some(t=>t.id===oldTaskId)).toBe(false);
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
    expect(a.tasks[0].frente).toBeNull();
    expect(a.tasks[1].frente).toBe("Frente A");
    const b = await loadTaskContext(db,userB);
    expect(b.tasks).toHaveLength(1);
    expect(b.tasks[0].titulo).toBe("B-privada");
    expect(b.events).toHaveLength(1);
    expect(b.events[0].payload).toEqual({private:true});
  });
});

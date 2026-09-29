// Quem vê uma reunião e uma ação (pedido do Vitor, 28/09/2026): a ação que sai de reunião fica só com quem
// estava nela; para outras pessoas ou um time verem, alguém marca. Banco: db/equipe/012_quem_ve.sql.
import { query, withTenant } from "./db";
import { garantirColegaDoTtars, nomesDeUsuarios, registrarEvento } from "./equipe-compartilhado";
import { nomesDosTimes, podeTime, timeIdValido } from "./hub";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MotivoDeVer = "convidado" | "falou" | "estava" | "quem_ve";
export const MOTIVOS_QUEM_ESTAVA: MotivoDeVer[] = ["convidado", "falou", "estava"];

export type PessoaQueVe = { user_id: string; nome: string; email: string | null };
export type QuemVeReuniao = {
  visibilidade: "so_eu" | "escolhidos" | "todos";
  quem_estava: (PessoaQueVe & { motivo: MotivoDeVer })[];
  pessoas: PessoaQueVe[];
  times: { id: string; nome: string }[];
};

async function emailsDe(ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const r = await query<{ id: string; email: string | null }>(
    `SELECT id::text AS id, LOWER(email) AS email FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(r.map((x) => [x.id, x.email]));
}

/** Quem vê uma reunião, com nomes (quem chama já conferiu que é o dono). */
export async function quemVeDaReuniao(donoId: string, meetingId: string): Promise<QuemVeReuniao | null> {
  const r = await withTenant(donoId, async (c) => {
    const m = await c.query<{ visibilidade: QuemVeReuniao["visibilidade"] }>(`SELECT visibilidade FROM meetings WHERE id = $1`, [meetingId]);
    if (!m.rows[0]) return null;
    const a = await c.query<{ user_id: string | null; time_id: string | null; motivo: MotivoDeVer }>(
      `SELECT user_id::text AS user_id, time_id, motivo FROM meeting_acessos WHERE meeting_id = $1 ORDER BY created_at`,
      [meetingId],
    );
    return { visibilidade: m.rows[0].visibilidade, acessos: a.rows };
  });
  if (!r) return null;
  const ids = r.acessos.map((a) => a.user_id).filter((x): x is string => !!x);
  const [nomes, emails, times] = await Promise.all([
    nomesDeUsuarios(ids),
    emailsDe(ids),
    r.acessos.some((a) => a.time_id) ? nomesDosTimes() : Promise.resolve(new Map<string, string>()),
  ]);
  const pessoa = (id: string): PessoaQueVe => ({ user_id: id, nome: nomes.get(id) ?? "Colega", email: emails.get(id) ?? null });
  return {
    visibilidade: r.visibilidade,
    quem_estava: r.acessos
      .filter((a) => a.user_id && MOTIVOS_QUEM_ESTAVA.includes(a.motivo))
      .map((a) => ({ ...pessoa(a.user_id!), motivo: a.motivo })),
    pessoas: r.acessos.filter((a) => a.user_id && a.motivo === "quem_ve").map((a) => pessoa(a.user_id!)),
    times: r.acessos.filter((a) => a.time_id).map((a) => ({ id: a.time_id!, nome: times.get(a.time_id!) ?? "Time" })),
  };
}

/** Dono da reunião marca/tira quem estava e não falou. `falou` segue as vozes; `convidado` sai por aqui. */
export async function mudarQuemEstava(
  donoId: string,
  meetingId: string,
  email: string,
  acao: "por" | "tirar",
): Promise<"ok" | "nao_achou" | "nao_e_dono" | "pessoa" | "segue_a_voz"> {
  const colega = await garantirColegaDoTtars(email);
  if (!colega) return "pessoa";
  if (colega.id === donoId) return "pessoa";
  return withTenant(donoId, async (c) => {
    const m = await c.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM meetings WHERE id = $1`, [meetingId]);
    if (!m.rows[0]) return "nao_achou";
    if (m.rows[0].user_id !== donoId) return "nao_e_dono";
    if (acao === "por") {
      await c.query(
        `INSERT INTO meeting_acessos (meeting_id, user_id, created_by, motivo) VALUES ($1, $2, $3, 'estava')
         ON CONFLICT (meeting_id, (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(time_id, '')))
         DO UPDATE SET motivo = 'estava' WHERE meeting_acessos.motivo = 'quem_ve'`,
        [meetingId, colega.id, donoId],
      );
      return "ok";
    }
    const atual = await c.query<{ motivo: MotivoDeVer }>(
      `SELECT motivo FROM meeting_acessos WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, colega.id],
    );
    if (atual.rows[0]?.motivo === "falou") return "segue_a_voz";
    await c.query(`DELETE FROM meeting_acessos WHERE meeting_id = $1 AND user_id = $2 AND motivo IN ('convidado', 'estava')`, [
      meetingId,
      colega.id,
    ]);
    return "ok";
  });
}

/** Pessoas marcadas para ver uma ação (no tenant do dono; quem chama já conferiu o acesso). */
export async function pessoasQueVeemATarefa(donoId: string, tarefaId: string): Promise<PessoaQueVe[]> {
  const r = await withTenant(donoId, (c) =>
    // Quem também faz aparece em "Também fazem", não em "Quem vê" (e tirar de Quem vê não tira quem faz junto).
    c.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM tarefa_acessos WHERE tarefa_id = $1 AND NOT faz ORDER BY created_at`, [tarefaId]),
  );
  const ids = r.rows.map((x) => x.user_id);
  const [nomes, emails] = await Promise.all([nomesDeUsuarios(ids), emailsDe(ids)]);
  return ids.map((id) => ({ user_id: id, nome: nomes.get(id) ?? "Colega", email: emails.get(id) ?? null }));
}

/** Quem estava na reunião de onde a ação saiu e como ela está aberta (só para quem criou a ação). */
export async function reuniaoDaTarefa(
  donoId: string,
  tarefaId: string,
): Promise<{ visibilidade: QuemVeReuniao["visibilidade"]; quem_estava: number; marcados: number } | null> {
  const r = await withTenant(donoId, (c) =>
    c.query<{ visibilidade: QuemVeReuniao["visibilidade"]; quem_estava: number; marcados: number }>(
      `SELECT m.visibilidade,
              (SELECT COUNT(*)::int FROM meeting_acessos ma WHERE ma.meeting_id = m.id AND ma.motivo <> 'quem_ve') AS quem_estava,
              (SELECT COUNT(*)::int FROM meeting_acessos ma WHERE ma.meeting_id = m.id AND ma.motivo = 'quem_ve') AS marcados
         FROM tarefas t JOIN meetings m ON m.id = t.meeting_id
        WHERE t.id = $1`,
      [tarefaId],
    ),
  );
  return r.rows[0] ?? null;
}

export type MudancaDeQuemVe = {
  /** A lista inteira de pessoas marcadas (e-mails da Welcome). */
  pessoas?: string[];
  /** Pessoas a juntar às que já estão (várias ações de uma vez). */
  juntar?: string[];
  /** Pessoas a tirar (várias ações de uma vez). */
  tirar?: string[];
  /** Time que vê e mexe (null = nenhum). */
  time_id?: string | null;
};

/** Só quem criou a ação muda quem vê. Devolve o motivo da recusa, se houver. */
export async function mudarQuemVeDaTarefa(
  userId: string,
  tarefaId: string,
  m: MudancaDeQuemVe,
): Promise<"ok" | "nao_achou" | "so_quem_criou" | "time" | "pessoa"> {
  if (!UUID_RE.test(tarefaId)) return "nao_achou";
  const dono = await withTenant(userId, (c) =>
    c.query<{ dono_id: string; papel: string }>(`SELECT dono_id::text AS dono_id, papel FROM equipe_acesso_tarefa($1)`, [tarefaId]),
  );
  const acesso = dono.rows[0];
  if (!acesso) return "nao_achou";
  if (acesso.papel !== "dono") return "so_quem_criou";
  if (m.time_id !== undefined && m.time_id !== null && !(timeIdValido(m.time_id) && (await podeTime(userId, m.time_id)))) return "time";

  const ids = async (emails: string[] | undefined) => {
    const out: string[] = [];
    for (const e of emails ?? []) {
      if (typeof e !== "string" || !e.trim()) continue;
      const c = await garantirColegaDoTtars(e);
      if (!c) return null;
      if (c.id !== userId && !out.includes(c.id)) out.push(c.id);
    }
    return out;
  };
  const lista = m.pessoas !== undefined ? await ids(m.pessoas) : undefined;
  const juntar = m.juntar !== undefined ? await ids(m.juntar) : undefined;
  const tirar = m.tirar !== undefined ? await ids(m.tirar) : undefined;
  if (lista === null || juntar === null || tirar === null) return "pessoa";

  await withTenant(userId, async (c) => {
    const antes = (await c.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM tarefa_acessos WHERE tarefa_id = $1`, [tarefaId])).rows.map(
      (x) => x.user_id,
    );
    if (lista !== undefined) {
      await c.query(`DELETE FROM tarefa_acessos WHERE tarefa_id = $1 AND NOT faz AND NOT (user_id = ANY ($2::uuid[]))`, [tarefaId, lista]);
    }
    if (tirar?.length) {
      await c.query(`DELETE FROM tarefa_acessos WHERE tarefa_id = $1 AND NOT faz AND user_id = ANY ($2::uuid[])`, [tarefaId, tirar]);
    }
    for (const uid of [...(lista ?? []), ...(juntar ?? [])]) {
      await c.query(`INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
        tarefaId,
        uid,
        userId,
      ]);
    }
    const depois = (await c.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM tarefa_acessos WHERE tarefa_id = $1`, [tarefaId])).rows.map(
      (x) => x.user_id,
    );
    const mudouPessoas = antes.length !== depois.length || antes.some((x) => !depois.includes(x));
    let mudouTime = false;
    if (m.time_id !== undefined) {
      const t = await c.query(`UPDATE tarefas SET time_id = $2 WHERE id = $1 AND time_id IS DISTINCT FROM $2 RETURNING id`, [tarefaId, m.time_id]);
      mudouTime = (t.rowCount ?? 0) > 0;
    }
    if (mudouPessoas || mudouTime) {
      const changed: Record<string, unknown> = {};
      if (mudouPessoas) changed.quem_ve = { de: antes.length, para: depois.length };
      if (mudouTime) changed.time_id = { para: m.time_id };
      await registrarEvento(c, tarefaId, "editada", { changed }, userId);
    }
  });
  return "ok";
}

/**
 * Quem também faz a ação (subresponsáveis, pedido do Vitor 29/09/2026). Quem criou e quem faz mudam; a lista vem
 * inteira (e-mails da Welcome). Mora em tarefa_acessos com faz: quem entra passa a ver e mexer (como quem foi
 * marcado para ver) e a ação aparece na lista dela; quem sai deixa de fazer e de ver (se ainda precisar ver, quem
 * criou marca em Quem vê).
 */
export async function mudarTambemFazem(
  userId: string,
  tarefaId: string,
  emails: string[],
): Promise<"ok" | "nao_achou" | "so_quem_cuida" | "pessoa"> {
  if (!UUID_RE.test(tarefaId)) return "nao_achou";
  const r = await withTenant(userId, (c) =>
    c.query<{ dono_id: string; papel: string }>(`SELECT dono_id::text AS dono_id, papel FROM equipe_acesso_tarefa($1)`, [tarefaId]),
  );
  const acesso = r.rows[0];
  if (!acesso) return "nao_achou";
  if (acesso.papel !== "dono" && acesso.papel !== "responsavel") return "so_quem_cuida";
  const donoId = acesso.dono_id;

  const principal = await withTenant(donoId, (c) =>
    c.query<{ responsavel: string | null }>(`SELECT responsavel_user_id::text AS responsavel FROM tarefas WHERE id = $1`, [tarefaId]),
  );
  if (!principal.rows[0]) return "nao_achou";
  // Quem criou e quem já faz não entram como "também faz".
  const fora = new Set([donoId, principal.rows[0].responsavel].filter((x): x is string => !!x));
  const ids: string[] = [];
  for (const e of emails.slice(0, 20)) {
    if (typeof e !== "string" || !e.trim()) continue;
    const colega = await garantirColegaDoTtars(e);
    if (!colega) return "pessoa";
    if (!fora.has(colega.id) && !ids.includes(colega.id)) ids.push(colega.id);
  }

  await withTenant(donoId, async (c) => {
    const antes = (
      await c.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM tarefa_acessos WHERE tarefa_id = $1 AND faz`, [tarefaId])
    ).rows.map((x) => x.user_id);
    await c.query(`DELETE FROM tarefa_acessos WHERE tarefa_id = $1 AND faz AND NOT (user_id = ANY ($2::uuid[]))`, [tarefaId, ids]);
    for (const uid of ids) {
      await c.query(
        `INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by, faz) VALUES ($1, $2, $3, true)
         ON CONFLICT (tarefa_id, user_id) DO UPDATE SET faz = true`,
        [tarefaId, uid, userId],
      );
    }
    const mudou = antes.length !== ids.length || antes.some((x) => !ids.includes(x));
    if (mudou) await registrarEvento(c, tarefaId, "editada", { changed: { tambem_fazem: { de: antes.length, para: ids.length } } }, userId);
  });
  return "ok";
}

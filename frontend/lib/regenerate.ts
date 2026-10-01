import { withTenant } from "@/lib/db";

// Mesmo webhook que o rename de speaker usa: pipeline de 2 estágios
// (resumo executivo → tarefas), síncrono — só responde no fim.
const REPROCESS_URL =
  process.env.N8N_REPROCESS_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-tarefas";

export type RegenerateResult = {
  ok: true;
  reprocessed: boolean;
  tarefas_apagadas: number;
};

/**
 * Refaz resumo + tarefas a partir da transcrição que está no banco AGORA.
 *
 * A limpeza das tarefas mora aqui, não no workflow: lá o DELETE é conservador
 * de propósito (preserva concluída/cancelada e as criadas à mão) porque roda
 * também quando o user só renomeia um speaker. Quando o pedido é explícito
 * ("refazer"), o combinado com o Vitor é apagar todas e recriar — menos as que guardam a fala de outra reunião ou
 * alguém marcado (equipe, 01/10/2026).
 */
export async function regenerateMeeting(
  userId: string,
  meetingId: string,
): Promise<RegenerateResult> {
  // Equipe (01/10/2026): fica a ação que guarda a fala de OUTRA reunião (a trava contra repetida juntou ali o que
  // outra pessoa gravou) ou que alguém foi marcado para ver: apagar levaria junto o que não é desta reunião.
  // A leitura nova da reunião acha essas ações e não cria de novo (tarefas-repetidas-db).
  const apagadas = await withTenant(userId, async (db) => {
    const temAcessos = (await db.query<{ ok: boolean }>(`SELECT to_regclass('tarefa_acessos') IS NOT NULL AS ok`)).rows[0]?.ok;
    const r = await db.query(
      `DELETE FROM tarefas WHERE meeting_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM tarefa_mencoes tm WHERE tm.tarefa_id = tarefas.id AND tm.meeting_id IS DISTINCT FROM tarefas.meeting_id)
          ${temAcessos ? "AND NOT EXISTS (SELECT 1 FROM tarefa_acessos ta WHERE ta.tarefa_id = tarefas.id)" : ""}`,
      [meetingId],
    );
    return r.rowCount ?? 0;
  });

  let reprocessed = true;
  try {
    const rp = await fetch(REPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: meetingId, user_id: userId }),
      signal: AbortSignal.timeout(150_000),
    });
    reprocessed = rp.ok;
    // Reunião que tinha dado erro (a do Teams, por exemplo) e foi refeita: fica pronta.
    if (rp.ok) {
      await withTenant(userId, (db) =>
        db.query(
          `UPDATE meetings SET status = 'done', done_at = now(), status_error = NULL WHERE id = $1::uuid AND status = 'error'`,
          [meetingId],
        ),
      );
    }
  } catch {
    // timeout/erro: o reprocesso pode terminar em background; a UI avisa e o
    // user recarrega. Mesmo comportamento da rota de speakers.
    reprocessed = false;
  }

  return { ok: true, reprocessed, tarefas_apagadas: apagadas };
}

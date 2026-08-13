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
 * ("refazer"), o combinado com o Vitor é apagar todas e recriar.
 */
export async function regenerateMeeting(
  userId: string,
  meetingId: string,
): Promise<RegenerateResult> {
  const apagadas = await withTenant(userId, async (db) => {
    const r = await db.query(`DELETE FROM tarefas WHERE meeting_id = $1::uuid`, [
      meetingId,
    ]);
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
  } catch {
    // timeout/erro: o reprocesso pode terminar em background; a UI avisa e o
    // user recarrega. Mesmo comportamento da rota de speakers.
    reprocessed = false;
  }

  return { ok: true, reprocessed, tarefas_apagadas: apagadas };
}

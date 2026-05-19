import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Webhook do n8n que reprocessa as tarefas com os novos labels.
const REPROCESS_URL =
  process.env.N8N_REPROCESS_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-tarefas";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const labels = body?.labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    return NextResponse.json(
      { error: "body.labels deve ser objeto { speakerLetter: nome }" },
      { status: 400 },
    );
  }

  // Sanitiza: só aceita keys de 1-3 chars (A, B, AA…) e values string
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof k !== "string" || k.length > 3) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    clean[k] = trimmed.slice(0, 80);
  }

  try {
    const rows = await query<{ id: string; speaker_labels: Record<string, string> }>(
      `UPDATE meetings SET speaker_labels = $1::jsonb WHERE id = $2::uuid
       RETURNING id, speaker_labels`,
      [JSON.stringify(clean), id],
    );
    if (!rows.length) {
      return NextResponse.json({ error: "meeting não encontrada" }, { status: 404 });
    }

    // Dispara reprocessamento das tarefas (fire-and-forget — não bloqueia resposta)
    fetch(REPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id }),
    }).catch(() => {
      // erro silencioso — usuário pode tentar de novo se notar que tarefas não atualizaram
    });

    return NextResponse.json({ ok: true, labels: rows[0].speaker_labels });
  } catch (e) {
    return NextResponse.json(
      {
        error: "falha ao salvar speaker_labels",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

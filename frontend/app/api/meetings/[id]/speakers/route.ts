import { type NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Webhook do n8n que reprocessa as tarefas com os novos labels.
const REPROCESS_URL =
  process.env.N8N_REPROCESS_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-tarefas";

// voice-svc (Python + SpeechBrain) — enrola amostras quando user confirma o mapeamento.
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

// Aceita body { labels: { letter: value } } onde value é um de:
//   - string nome ("Vitor")                  → get-or-create pessoa por nome
//   - string UUID                            → resolve pessoa por id
//   - { pessoa_id: uuid, nome?: string }     → usa pessoa_id direto
type RawLabelValue = string | { pessoa_id?: string; nome?: string };

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
      { error: "body.labels deve ser objeto { letter: nome | uuid | {pessoa_id} }" },
      { status: 400 },
    );
  }

  // Sanitiza keys (A, B, AA…) e separa values em buckets
  type ParsedEntry = {
    letter: string;
    rawNome?: string;
    pessoaId?: string;
  };
  const parsed: ParsedEntry[] = [];

  for (const [k, v] of Object.entries(labels as Record<string, RawLabelValue>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 3) continue;
    const letter = k;

    if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (UUID_RE.test(trimmed)) parsed.push({ letter, pessoaId: trimmed });
      else parsed.push({ letter, rawNome: trimmed.slice(0, 80) });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const pid = typeof v.pessoa_id === "string" ? v.pessoa_id.trim() : "";
      const nome = typeof v.nome === "string" ? v.nome.trim() : "";
      if (pid && UUID_RE.test(pid)) parsed.push({ letter, pessoaId: pid });
      else if (nome) parsed.push({ letter, rawNome: nome.slice(0, 80) });
    }
  }

  try {
    const result = await withClient(async (c) => {
      // 1) resolve cada entry pra { letter, pessoa_id, nome } numa transação
      await c.query("BEGIN");
      try {
        const resolved: Array<{ letter: string; pessoa_id: string; nome: string }> = [];
        for (const e of parsed) {
          if (e.pessoaId) {
            const r = await c.query<{ id: string; nome: string }>(
              "SELECT id, nome FROM pessoas WHERE id = $1",
              [e.pessoaId],
            );
            if (!r.rows.length) {
              throw new Error(`pessoa_id ${e.pessoaId} não encontrada`);
            }
            resolved.push({ letter: e.letter, pessoa_id: r.rows[0].id, nome: r.rows[0].nome });
          } else if (e.rawNome) {
            // get-or-create por nome
            const ins = await c.query<{ id: string; nome: string }>(
              `INSERT INTO pessoas (nome) VALUES ($1)
               ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
               RETURNING id, nome`,
              [e.rawNome],
            );
            resolved.push({
              letter: e.letter,
              pessoa_id: ins.rows[0].id,
              nome: ins.rows[0].nome,
            });
          }
        }

        // 2) constrói os dois mapas
        const speakerLabels: Record<string, string> = {};
        const speakerPessoas: Record<string, string> = {};
        for (const r of resolved) {
          speakerLabels[r.letter] = r.nome;
          speakerPessoas[r.letter] = r.pessoa_id;
        }

        // 3) UPDATE atômico
        const upd = await c.query<{
          id: string;
          speaker_labels: Record<string, string>;
          speaker_pessoas: Record<string, string>;
        }>(
          `UPDATE meetings
             SET speaker_labels = $1::jsonb,
                 speaker_pessoas = $2::jsonb
           WHERE id = $3::uuid
           RETURNING id, speaker_labels, speaker_pessoas`,
          [JSON.stringify(speakerLabels), JSON.stringify(speakerPessoas), id],
        );
        if (!upd.rows.length) {
          throw new Error("meeting não encontrada");
        }
        await c.query("COMMIT");
        return upd.rows[0];
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });

    // Dispara reprocessamento das tarefas (fire-and-forget — não bloqueia resposta)
    fetch(REPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id }),
    }).catch(() => {
      // erro silencioso — usuário pode tentar de novo se notar que tarefas não atualizaram
    });

    // Enroll de voz no voice-svc (fire-and-forget). voice-svc é idempotente por
    // (meeting, letter, pessoa) — manda o mapping completo sem se preocupar com duplicação.
    const enrollMapping = result.speaker_pessoas;
    if (enrollMapping && Object.keys(enrollMapping).length > 0) {
      fetch(`${VOICE_SVC_URL}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: id, mapping: enrollMapping }),
        signal: AbortSignal.timeout(180_000),
      }).catch(() => {
        // erro silencioso — voice-svc pode estar fora; UI segue funcionando
      });
    }

    return NextResponse.json({
      ok: true,
      labels: result.speaker_labels,
      pessoas: result.speaker_pessoas,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("não encontrada") ? 404 : 500;
    return NextResponse.json({ error: "falha ao salvar speaker_labels", message: msg }, { status });
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

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

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await (req as NextRequest).json().catch(() => null);
  const labels = body?.labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    return NextResponse.json(
      { error: "body.labels deve ser objeto { letter: nome | uuid | {pessoa_id} }" },
      { status: 400 },
    );
  }

  // Opcional: turnos específicos curados pelo user pra cada letter.
  // Quando vier, voice-svc enrola só esses (pulando outlier rejection automático).
  // Formato: { "A": [{start: 1.2, end: 2.3}, ...] }
  type RawTurn = { start?: number; end?: number };
  const turnsByLetterRaw = body?.turns_by_letter;
  const turnsByLetter: Record<string, Array<{ start: number; end: number }>> = {};
  if (turnsByLetterRaw && typeof turnsByLetterRaw === "object" && !Array.isArray(turnsByLetterRaw)) {
    for (const [k, v] of Object.entries(turnsByLetterRaw as Record<string, RawTurn[]>)) {
      if (typeof k !== "string" || k.length > 3 || !Array.isArray(v)) continue;
      const clean = v
        .filter((t): t is { start: number; end: number } =>
          typeof t?.start === "number" && typeof t?.end === "number" && t.end > t.start,
        )
        .map((t) => ({ start: t.start, end: t.end }));
      if (clean.length > 0) turnsByLetter[k] = clean;
    }
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
    // withTenant já abre a transação e seta SET LOCAL app.current_user_id.
    // RLS filtra meetings/pessoas pelo user. get-or-create de pessoa inclui user_id.
    const result = await withTenant(user.id, async (c) => {
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
          const ins = await c.query<{ id: string; nome: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1, $2)
             ON CONFLICT (user_id, nome) DO UPDATE SET nome = EXCLUDED.nome
             RETURNING id, nome`,
            [user.id, e.rawNome],
          );
          resolved.push({
            letter: e.letter,
            pessoa_id: ins.rows[0].id,
            nome: ins.rows[0].nome,
          });
        }
      }

      const speakerLabels: Record<string, string> = {};
      const speakerPessoas: Record<string, string> = {};
      for (const r of resolved) {
        speakerLabels[r.letter] = r.nome;
        speakerPessoas[r.letter] = r.pessoa_id;
      }

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
      return upd.rows[0];
    });

    // Dispara reprocessamento das tarefas (fire-and-forget — não bloqueia resposta)
    fetch(REPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id, user_id: user.id }),
    }).catch(() => {
      // erro silencioso — usuário pode tentar de novo se notar que tarefas não atualizaram
    });

    // Enroll de voz no voice-svc (fire-and-forget). voice-svc é idempotente por
    // (meeting, letter, pessoa) — manda o mapping completo sem se preocupar com duplicação.
    // Se o user curou turnos específicos, propaga em turns_by_letter pra pular outlier rejection.
    const enrollMapping = result.speaker_pessoas;
    if (enrollMapping && Object.keys(enrollMapping).length > 0) {
      const enrollBody: {
        meeting_id: string;
        user_id: string;
        mapping: Record<string, string>;
        turns_by_letter?: Record<string, Array<{ start: number; end: number }>>;
      } = { meeting_id: id, user_id: user.id, mapping: enrollMapping };
      if (Object.keys(turnsByLetter).length > 0) {
        enrollBody.turns_by_letter = turnsByLetter;
      }
      fetch(`${VOICE_SVC_URL}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enrollBody),
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
});

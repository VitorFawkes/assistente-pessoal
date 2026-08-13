import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTER_RE = /^[A-Z]{1,3}$/;

const REPROCESS_URL =
  process.env.N8N_REPROCESS_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-tarefas";
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

type Segment = { speaker: string; start: number; end: number; text: string };

type Body = {
  segment_indices?: number[];
  target_letter?: string;
  new_name?: string;
};

type MeetingRow = {
  id: string;
  segments: Segment[] | null;
  speaker_labels: Record<string, string> | null;
  speaker_pessoas: Record<string, string> | null;
};

function nextFreeLetter(existing: Set<string>): string {
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!existing.has(l)) return l;
  }
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const l = String.fromCharCode(65 + i) + String.fromCharCode(65 + j);
      if (!existing.has(l)) return l;
    }
  }
  throw new Error("NO_FREE_LETTER");
}

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, request, ctx) => {
  const req = request as NextRequest;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body: Body = (await req.json().catch(() => ({}))) as Body;
  const indices = Array.isArray(body.segment_indices)
    ? body.segment_indices.filter((n) => Number.isInteger(n) && n >= 0)
    : [];
  if (indices.length === 0) {
    return NextResponse.json({ error: "segment_indices vazio" }, { status: 400 });
  }

  const rawTarget = typeof body.target_letter === "string"
    ? body.target_letter.trim().toUpperCase()
    : "";
  const createNew = rawTarget === "" || rawTarget === "NEW" || rawTarget === "_NEW_";
  if (!createNew && !LETTER_RE.test(rawTarget)) {
    return NextResponse.json({ error: "target_letter inválido" }, { status: 400 });
  }
  const newName = typeof body.new_name === "string" ? body.new_name.trim().slice(0, 80) : "";

  try {
    // withTenant já abre transação + SET LOCAL app.current_user_id: a RLS
    // filtra a reunião pelo dono, então nenhuma sessão mexe na reunião alheia.
    const result = await withTenant(user.id, async (c) => {
      {
        const r = await c.query<MeetingRow>(
          `SELECT id, segments, speaker_labels, speaker_pessoas
             FROM meetings WHERE id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (!r.rows.length) throw new Error("NOT_FOUND");
        const m = r.rows[0];
        const segments = m.segments;
        if (!Array.isArray(segments) || segments.length === 0) {
          throw new Error("NO_SEGMENTS");
        }

        // Validar índices
        for (const i of indices) {
          if (i >= segments.length) throw new Error(`INDEX_OUT_OF_RANGE:${i}`);
        }
        // Todos do mesmo speaker de origem (sanity check)
        const sourceSpeakers = new Set(indices.map((i) => segments[i].speaker));
        if (sourceSpeakers.size !== 1) {
          throw new Error("MIXED_SOURCE_SPEAKERS");
        }
        const sourceLetter = [...sourceSpeakers][0];

        // Determinar letter destino
        const existingLetters = new Set(segments.map((s) => s.speaker));
        let targetLetter = rawTarget;
        if (createNew) {
          targetLetter = nextFreeLetter(existingLetters);
        }
        if (targetLetter === sourceLetter) {
          throw new Error("SAME_SPEAKER");
        }

        // Aplica mudança nos segments
        const newSegments = segments.map((s, i) =>
          indices.includes(i) ? { ...s, speaker: targetLetter } : s,
        );

        // Atualiza speaker_labels/pessoas se nomeou
        const labels = { ...(m.speaker_labels || {}) };
        const pessoas = { ...(m.speaker_pessoas || {}) };
        let createdPessoaId: string | null = null;
        let createdPessoaNome: string | null = null;

        if (newName) {
          const ins = await c.query<{ id: string; nome: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1, $2)
             ON CONFLICT (user_id, nome) DO UPDATE SET nome = EXCLUDED.nome
             RETURNING id, nome`,
            [user.id, newName],
          );
          createdPessoaId = ins.rows[0].id;
          createdPessoaNome = ins.rows[0].nome;
          labels[targetLetter] = ins.rows[0].nome;
          pessoas[targetLetter] = ins.rows[0].id;
        }

        // Se o sourceLetter ficou sem nenhum segment, limpa entries dele
        const remainingForSource = newSegments.some((s) => s.speaker === sourceLetter);
        if (!remainingForSource) {
          delete labels[sourceLetter];
          delete pessoas[sourceLetter];
        }

        await c.query(
          `UPDATE meetings
              SET segments = $1::jsonb,
                  speaker_labels = $2::jsonb,
                  speaker_pessoas = $3::jsonb
            WHERE id = $4::uuid`,
          [
            JSON.stringify(newSegments),
            JSON.stringify(labels),
            JSON.stringify(pessoas),
            id,
          ],
        );

        // Coleta turns (start/end) dos segments movidos pra enrollar no voice-svc
        const movedTurns = indices
          .map((i) => ({ start: segments[i].start, end: segments[i].end }))
          .filter((t) => t.end > t.start);

        return {
          targetLetter,
          sourceLetter,
          createdPessoaId,
          createdPessoaNome,
          movedTurns,
          enrollMapping: pessoas,
        };
      }
    });

    // Reprocessa tarefas (fire-and-forget) — labels mudaram
    fetch(REPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id, user_id: user.id }),
    }).catch(() => {});

    // Se nomeou novo speaker, enrolla voz no voice-svc com os turns específicos
    if (result.createdPessoaId && result.movedTurns.length > 0) {
      fetch(`${VOICE_SVC_URL}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_id: id,
          user_id: user.id,
          mapping: result.enrollMapping,
          turns_by_letter: { [result.targetLetter]: result.movedTurns },
        }),
        signal: AbortSignal.timeout(180_000),
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      target_letter: result.targetLetter,
      source_letter: result.sourceLetter,
      created_pessoa: result.createdPessoaNome,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 :
      msg === "NO_SEGMENTS" || msg === "MIXED_SOURCE_SPEAKERS" || msg === "SAME_SPEAKER" ? 409 :
      msg.startsWith("INDEX_") ? 400 :
      500;
    return NextResponse.json({ error: msg }, { status });
  }
});

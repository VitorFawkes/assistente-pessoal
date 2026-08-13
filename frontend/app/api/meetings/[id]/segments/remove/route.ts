import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { coerceSegments, joinSegmentsText, type Segment } from "@/lib/transcript-format";
import { regenerateMeeting } from "@/lib/regenerate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

type MeetingRow = {
  id: string;
  segments: unknown;
  segments_removidos: unknown;
};

/**
 * Trechos que o usuário mandou apagar saem de `segments`/`transcription` e vão
 * pra `segments_removidos`. Apagar de verdade (em vez de marcar como oculto)
 * mantém resumo, tarefas, download e impressão lendo exatamente o mesmo texto.
 * Os `start`/`end` dos que ficam não mudam — o áudio continua inteiro, então
 * seções e o player seguem certos.
 */
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await (req as NextRequest).json().catch(() => ({}));
  const indices = Array.isArray(body?.segment_indices)
    ? [...new Set(body.segment_indices.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0))] as number[]
    : [];
  if (indices.length === 0) {
    return NextResponse.json({ error: "segment_indices vazio" }, { status: 400 });
  }
  const regenerate = body?.regenerate === true;

  let removidosTotal = 0;
  try {
    removidosTotal = await withTenant(user.id, async (db) => {
      const r = await db.query<MeetingRow>(
        `SELECT id, segments, segments_removidos
           FROM meetings WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      if (!r.rows.length) throw new Error("NOT_FOUND");

      const segments = coerceSegments(r.rows[0].segments);
      if (segments.length === 0) throw new Error("NO_SEGMENTS");
      for (const i of indices) {
        if (i >= segments.length) throw new Error(`INDEX_OUT_OF_RANGE:${i}`);
      }

      const alvo = new Set(indices);
      const ficam: Segment[] = [];
      const saem: Segment[] = [];
      segments.forEach((s, i) => (alvo.has(i) ? saem : ficam).push(s));
      // Reunião sem nenhuma fala quebraria resumo, tarefas e export — pra
      // esvaziar tudo o caminho é deletar a reunião.
      if (ficam.length === 0) throw new Error("WOULD_EMPTY_TRANSCRIPT");

      const jaRemovidos = coerceSegments(r.rows[0].segments_removidos);
      const removidos = [...jaRemovidos, ...saem];

      await db.query(
        `UPDATE meetings
            SET segments = $1::jsonb,
                transcription = $2,
                segments_removidos = $3::jsonb
          WHERE id = $4::uuid`,
        [
          JSON.stringify(ficam),
          joinSegmentsText(ficam),
          JSON.stringify(removidos),
          id,
        ],
      );
      return removidos.length;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 :
      msg === "NO_SEGMENTS" || msg === "WOULD_EMPTY_TRANSCRIPT" ? 409 :
      msg.startsWith("INDEX_") ? 400 :
      500;
    return NextResponse.json({ error: msg }, { status });
  }

  const regen = regenerate ? await regenerateMeeting(user.id, id) : null;

  return NextResponse.json({
    ok: true,
    apagados: indices.length,
    removidos_total: removidosTotal,
    reprocessed: regen ? regen.reprocessed : null,
  });
});

/** Devolve tudo que foi apagado pro lugar de origem (ordenado por tempo). */
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body = await (req as NextRequest).json().catch(() => ({}));
  if (body?.restore !== true) {
    return NextResponse.json({ error: "use { restore: true }" }, { status: 400 });
  }

  try {
    const restaurados = await withTenant(user.id, async (db) => {
      const r = await db.query<MeetingRow>(
        `SELECT id, segments, segments_removidos
           FROM meetings WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      if (!r.rows.length) throw new Error("NOT_FOUND");

      const removidos = coerceSegments(r.rows[0].segments_removidos);
      if (removidos.length === 0) throw new Error("NADA_REMOVIDO");

      const segments = coerceSegments(r.rows[0].segments);
      const todos = [...segments, ...removidos].sort((a, b) => a.start - b.start);

      await db.query(
        `UPDATE meetings
            SET segments = $1::jsonb,
                transcription = $2,
                segments_removidos = '[]'::jsonb
          WHERE id = $3::uuid`,
        [JSON.stringify(todos), joinSegmentsText(todos), id],
      );
      return removidos.length;
    });

    return NextResponse.json({ ok: true, restaurados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 : msg === "NADA_REMOVIDO" ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
});

import { NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { meetingsFor, tarefasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };
type Seg = { speaker?: string; start?: number; end?: number; text?: string };

// Monta a transcrição legível "Falante: fala" a partir dos segments diarizados,
// resolvendo as letras (A/B) pelos nomes em speaker_labels. Cai pra transcrição
// crua se não houver segments.
function labeledTranscript(
  segments: unknown,
  labels: Record<string, string> | null,
  fallback: string | null,
): string {
  if (!Array.isArray(segments) || segments.length === 0) return fallback || "";
  const lab = labels || {};
  const lines: string[] = [];
  for (const s of segments as Seg[]) {
    const who = (s.speaker && lab[s.speaker]) || (s.speaker ? `Speaker ${s.speaker}` : "?");
    const txt = (s.text || "").trim();
    if (txt) lines.push(`${who}: ${txt}`);
  }
  return lines.join("\n") || fallback || "";
}

// GET /api/agent/reunioes/[id] — detalhe completo da reunião:
// transcrição (crua + rotulada por falante), segments, resumo, speakers e tarefas.
export const GET = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "id deve ser um UUID completo da reunião (não truncado)" },
      { status: 400 },
    );
  }
  try {
    const meeting = await meetingsFor(user.id).byIdDetailed(id);
    if (!meeting) {
      return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
    }
    const tarefas = await tarefasFor(user.id).byMeeting(id);
    const transcricao = meeting.transcription ?? null;
    return NextResponse.json({
      ...meeting,
      // aliases/derivados em PT (o resto da API é PT; `transcription` é o nome cru da coluna)
      transcricao,
      transcricao_rotulada: labeledTranscript(meeting.segments, meeting.speaker_labels, transcricao),
      tarefas,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

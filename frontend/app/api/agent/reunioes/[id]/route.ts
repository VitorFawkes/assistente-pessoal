import { NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { meetingsFor, tarefasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/agent/reunioes/[id] — detalhe da reunião (transcrição, segments, summary,
// speaker_labels, sections) + tarefas extraídas dela.
export const GET = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id } = await ctx.params;
  const meeting = await meetingsFor(user.id).byIdDetailed(id);
  if (!meeting) {
    return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  }
  const tarefas = await tarefasFor(user.id).byMeeting(id);
  return NextResponse.json({ ...meeting, tarefas });
});

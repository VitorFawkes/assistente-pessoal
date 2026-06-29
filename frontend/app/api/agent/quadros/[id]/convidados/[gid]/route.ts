import { NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; gid: string }> };

// DELETE /api/agent/quadros/[id]/convidados/[gid] — revoga o convidado
// (invalida o link imediatamente).
export const DELETE = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id, gid } = await ctx.params;
  try {
    await quadrosFor(user.id).revogarConvidado(id, gid);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

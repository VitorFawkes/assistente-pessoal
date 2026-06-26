import { NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { frentesFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/agent/frentes — lista as frentes ativas do user (id + nome).
export const GET = withAgentAuth(async ({ user }) => {
  const rows = await frentesFor(user.id).list();
  return NextResponse.json(rows);
});

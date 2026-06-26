import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/agent/reunioes?q=  — lista reuniões (com contagem de tarefas) ou busca por texto.
export const GET = withAgentAuth(async ({ user }, req) => {
  const q = (new URL((req as NextRequest).url).searchParams.get("q") || "").trim();
  const rows = q
    ? await meetingsFor(user.id).buscar(q)
    : await meetingsFor(user.id).listForIndex();
  return NextResponse.json(rows);
});

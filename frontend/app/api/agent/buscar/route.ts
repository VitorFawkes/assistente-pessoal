import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { meetingsFor, tarefasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/agent/buscar?q=&tipo=tarefas|reunioes|todas
// Busca unificada. Default tipo=todas.
export const GET = withAgentAuth(async ({ user }, req) => {
  const p = new URL((req as NextRequest).url).searchParams;
  const q = (p.get("q") || "").trim();
  const tipo = p.get("tipo") || "todas";
  if (!q) return NextResponse.json({ error: "q obrigatório" }, { status: 400 });

  const out: { tarefas?: unknown[]; reunioes?: unknown[] } = {};
  if (tipo === "tarefas" || tipo === "todas") {
    out.tarefas = await tarefasFor(user.id).buscar(q);
  }
  if (tipo === "reunioes" || tipo === "todas") {
    out.reunioes = await meetingsFor(user.id).buscar(q);
  }
  return NextResponse.json(out);
});

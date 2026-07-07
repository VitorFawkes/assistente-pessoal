import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { type NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/quadros/[id]/reorder — reordena as tarefas DENTRO do quadro
// (visão timeline "por tarefa"): grava quadro_tarefas.ordem na ordem recebida.
// RLS + política de quadro_tarefas garantem que só o dono afeta o próprio quadro.
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;

  let body: { ids?: unknown };
  try {
    body = (await (req as NextRequest).json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }

  try {
    await quadrosFor(user.id).reordenarTarefas(id, ids);
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

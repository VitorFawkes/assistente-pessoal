import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

// Reordena tarefas em lote: define `ordem` = posição (com folga) na ordem recebida.
// RLS garante que só as tarefas do próprio usuário são afetadas.
export const POST = withAuth(async (user, req) => {
  let body: { ids?: unknown };
  try {
    body = (await (req as NextRequest).json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }

  try {
    await withTenant(user.id, async (c) => {
      await c.query(
        `UPDATE tarefas t
            SET ordem = (u.idx - 1) * 10
           FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, idx)
          WHERE t.id = u.id`,
        [ids],
      );
    });
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

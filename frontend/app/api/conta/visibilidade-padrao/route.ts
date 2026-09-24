import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export const PATCH = withAuth(async (user, req) => {
  let body: { visibilidade_padrao?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.visibilidade_padrao) {
    return NextResponse.json(
      { error: "visibilidade_padrao é obrigatória" },
      { status: 400 }
    );
  }

  const validVisibilities = ["todos", "so_eu"];
  if (!validVisibilities.includes(body.visibilidade_padrao)) {
    return NextResponse.json(
      { error: "visibilidade_padrao deve ser: todos ou so_eu" },
      { status: 400 }
    );
  }

  try {
    await withTenant(user.id, async (db) => {
      await db.query(
        "UPDATE users SET visibilidade_padrao = $1 WHERE id = $2",
        [body.visibilidade_padrao, user.id]
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});

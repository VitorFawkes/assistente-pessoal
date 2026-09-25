import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { garantirColegaDoTtars } from "@/lib/equipe-compartilhado";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: {
    visibilidade?: string;
    acessos?: Array<{ user_id?: string; time_id?: string; email?: string }>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.visibilidade) {
    return NextResponse.json({ error: "visibilidade é obrigatória" }, { status: 400 });
  }

  const validVisibilities = ["todos", "so_eu", "escolhidos"];
  if (!validVisibilities.includes(body.visibilidade)) {
    return NextResponse.json(
      { error: "visibilidade deve ser: todos, so_eu ou escolhidos" },
      { status: 400 }
    );
  }

  // Telas do TTARS escolhem pela lista da Welcome (e-mail): ganha conta aqui se ainda não tem.
  if (Array.isArray(body.acessos)) {
    for (const a of body.acessos) {
      if (!a.user_id && typeof a.email === "string" && a.email.trim()) {
        const c = await garantirColegaDoTtars(a.email);
        if (c) a.user_id = c.id;
      }
    }
  }

  try {
    const result = await withTenant(user.id, async (db) => {
      // Verifica se o usuário é dono da reunião
      const meetingCheck = await db.query<{ user_id: string }>(
        "SELECT user_id FROM meetings WHERE id = $1",
        [id]
      );

      if (meetingCheck.rowCount === 0) {
        return { ok: false, error: "reunião não encontrada", status: 404 };
      }

      if (meetingCheck.rows[0].user_id !== user.id) {
        return { ok: false, error: "sem permissão", status: 403 };
      }

      // Atualiza a visibilidade
      await db.query("UPDATE meetings SET visibilidade = $1 WHERE id = $2", [
        body.visibilidade,
        id,
      ]);

      // Se for "escolhidos", limpa os acessos antigos e insere os novos
      if (body.visibilidade === "escolhidos") {
        await db.query("DELETE FROM meeting_acessos WHERE meeting_id = $1", [id]);

        if (body.acessos && Array.isArray(body.acessos)) {
          for (const acesso of body.acessos) {
            if (acesso.user_id || acesso.time_id) {
              await db.query(
                "INSERT INTO meeting_acessos (meeting_id, user_id, time_id, created_by) VALUES ($1, $2, $3, $4)",
                [
                  id,
                  acesso.user_id || null,
                  acesso.time_id || null,
                  user.id,
                ]
              );
            }
          }
        }
      } else {
        // Se não for "escolhidos", limpa os acessos
        await db.query("DELETE FROM meeting_acessos WHERE meeting_id = $1", [id]);
      }

      return { ok: true, status: 200 };
    });

    if (result.ok) {
      return NextResponse.json({ ok: true });
    } else {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});

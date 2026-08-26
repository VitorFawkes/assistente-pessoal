import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string; ideiaId: string }> };

function erro(e: unknown) {
  if (e instanceof GuestError) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  console.error("[guest-api] ideia:", e instanceof Error ? e.message : String(e));
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { token, ideiaId } = await ctx.params;
  let body: { texto?: string; tarefa_id?: string; tema?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    await withGuest(token, clientIp(req.headers), async ({ acesso, c }) => {
      if (body.texto !== undefined) {
        await c.query(
          `UPDATE quadro_ideias SET texto = $1, atualizado_em = now() WHERE id = $2 AND quadro_id = $3`,
          [body.texto.trim().slice(0, 2000), ideiaId, acesso.quadroId],
        );
      }
      // tema: escreveu um que não existe, ele passa a existir (igual ao POST)
      if (body.tema !== undefined) {
        const tema = (body.tema ?? "").trim();
        let frenteId: string | null = null;
        if (tema) {
          const slug =
            tema.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
              .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tema";
          const f = await c.query<{ id: string }>(
            `INSERT INTO frentes (user_id, nome, slug) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
            [acesso.ownerId, tema.slice(0, 60), slug],
          );
          frenteId = f.rows[0]?.id ?? null;
        }
        await c.query(
          `UPDATE quadro_ideias SET frente_id = $1, atualizado_em = now() WHERE id = $2 AND quadro_id = $3`,
          [frenteId, ideiaId, acesso.quadroId],
        );
      }
      if (body.tarefa_id) {
        await c.query(
          `UPDATE quadro_ideias SET tarefa_id = $1, atualizado_em = now() WHERE id = $2 AND quadro_id = $3`,
          [body.tarefa_id, ideiaId, acesso.quadroId],
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return erro(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { token, ideiaId } = await ctx.params;
  try {
    await withGuest(token, clientIp(req.headers), async ({ acesso, c }) => {
      await c.query(
        `UPDATE quadro_ideias SET arquivado_em = now() WHERE id = $1 AND quadro_id = $2`,
        [ideiaId, acesso.quadroId],
      );
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return erro(e);
  }
}

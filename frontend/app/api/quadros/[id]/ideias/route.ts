import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { listarIdeias } from "@/lib/ideias";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — lista as ideias do quadro. */
export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const ideias = await withTenant(user.id, (c) => listarIdeias(c, id, "dono"));
  return NextResponse.json({ ideias });
});

/** POST — guarda uma ideia nova (ou apoia / desapoia, com acao). */
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  let body: { texto?: string; tema?: string; acao?: "apoiar"; ideia_id?: string };
  try {
    body = (await (req as NextRequest).json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const resultado = await withTenant(user.id, async (c) => {
    // dono do quadro precisa bater com o tenant
    const q = await c.query(`SELECT id FROM quadros WHERE id = $1`, [id]);
    if (!q.rows.length) return { erro: "quadro não encontrado" as const };

    if (body.acao === "apoiar" && body.ideia_id) {
      const jaApoiou = await c.query(
        `SELECT 1 FROM quadro_ideia_apoios WHERE ideia_id = $1 AND quem = 'dono'`,
        [body.ideia_id],
      );
      if (jaApoiou.rows.length) {
        await c.query(`DELETE FROM quadro_ideia_apoios WHERE ideia_id = $1 AND quem = 'dono'`, [body.ideia_id]);
      } else {
        await c.query(
          `INSERT INTO quadro_ideia_apoios (ideia_id, quem) VALUES ($1, 'dono') ON CONFLICT DO NOTHING`,
          [body.ideia_id],
        );
      }
      return { ideias: await listarIdeias(c, id, "dono") };
    }

    const texto = (body.texto ?? "").trim();
    if (!texto) return { erro: "escreva a ideia" as const };

    let frenteId: string | null = null;
    const tema = (body.tema ?? "").trim();
    if (tema) {
      const slug = tema.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tema";
      const f = await c.query<{ id: string }>(
        `INSERT INTO frentes (user_id, nome, slug) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
        [user.id, tema.slice(0, 60), slug],
      );
      frenteId = f.rows[0]?.id ?? null;
    }

    await c.query(
      `INSERT INTO quadro_ideias (quadro_id, texto, autor_nome, frente_id)
       VALUES ($1, $2, $3, $4)`,
      [id, texto.slice(0, 2000), user.nome ?? "Você", frenteId],
    );
    return { ideias: await listarIdeias(c, id, "dono") };
  });

  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 400 });
  }
  return NextResponse.json(resultado);
});

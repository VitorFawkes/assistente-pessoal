import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import { listarIdeias } from "@/lib/ideias";

type Ctx = { params: Promise<{ token: string }> };

function erroDeConvidado(e: unknown) {
  if (e instanceof GuestError) {
    if (e.code === "rate_limit") {
      return NextResponse.json(
        { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    return NextResponse.json({ error: "invalid_token", message: "Link inválido ou revogado." }, { status: 401 });
  }
  console.error("[guest-api] ideias:", e instanceof Error ? e.message : String(e));
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

/** GET — as mesmas ideias que o dono vê. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  try {
    const r = await withGuest(token, clientIp(req.headers), async ({ acesso, c }) => ({
      ideias: await listarIdeias(c, acesso.quadroId, acesso.convidadoNome),
    }));
    return NextResponse.json(r);
  } catch (e) {
    return erroDeConvidado(e);
  }
}

/** POST — quem entra pelo link também escreve ideia e apoia. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  let body: { texto?: string; tema?: string; acao?: "apoiar"; ideia_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const r = await withGuest(token, clientIp(req.headers), async ({ acesso, c }) => {
      if (body.acao === "apoiar" && body.ideia_id) {
        const ja = await c.query(
          `SELECT 1 FROM quadro_ideia_apoios a
             JOIN quadro_ideias i ON i.id = a.ideia_id
            WHERE a.ideia_id = $1 AND a.quem = $2 AND i.quadro_id = $3`,
          [body.ideia_id, acesso.convidadoNome, acesso.quadroId],
        );
        if (ja.rows.length) {
          await c.query(`DELETE FROM quadro_ideia_apoios WHERE ideia_id = $1 AND quem = $2`,
            [body.ideia_id, acesso.convidadoNome]);
        } else {
          await c.query(
            `INSERT INTO quadro_ideia_apoios (ideia_id, quem)
             SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM quadro_ideias WHERE id = $1 AND quadro_id = $3)
             ON CONFLICT DO NOTHING`,
            [body.ideia_id, acesso.convidadoNome, acesso.quadroId],
          );
        }
        return { ideias: await listarIdeias(c, acesso.quadroId, acesso.convidadoNome) };
      }

      const texto = (body.texto ?? "").trim();
      if (!texto) throw new Error("escreva a ideia");

      let frenteId: string | null = null;
      const tema = (body.tema ?? "").trim();
      if (tema) {
        const slug = tema.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
          .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tema";
        const f = await c.query<{ id: string }>(
          `INSERT INTO frentes (user_id, nome, slug) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
          [acesso.ownerId, tema.slice(0, 60), slug],
        );
        frenteId = f.rows[0]?.id ?? null;
      }

      await c.query(
        `INSERT INTO quadro_ideias (quadro_id, texto, autor_nome, autor_convidado_id, frente_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [acesso.quadroId, texto.slice(0, 2000), acesso.convidadoNome, acesso.convidadoId, frenteId],
      );
      return { ideias: await listarIdeias(c, acesso.quadroId, acesso.convidadoNome) };
    });
    return NextResponse.json(r);
  } catch (e) {
    return erroDeConvidado(e);
  }
}

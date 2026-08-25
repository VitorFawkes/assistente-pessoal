import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/q/[token]/frentes
 * Lista áreas (frentes) disponíveis ao convidado do dono.
 * Retorna { frentes: [{ id, nome }, ...] }
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      // Query frentes do dono NO MESMO client (RLS escopado ao tenant)
      const frentesResult = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM frentes WHERE user_id = $1 AND ativo ORDER BY ordem, nome`,
        [acesso.ownerId]
      );

      return {
        frentes: frentesResult.rows,
      };
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GuestError) {
      if (e.code === "rate_limit") {
        return NextResponse.json(
          { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
      return NextResponse.json(
        { error: "invalid_token", message: "Link inválido ou revogado." },
        { status: 401 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[guest-api] erro inesperado:", msg);
    return NextResponse.json(
      { error: "server_error", message: "Erro ao processar a requisição." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/q/[token]/frentes
 * Convidado escreve um tema que ainda não existe e ele passa a existir no
 * quadro do dono (decisão do Vitor, 20/08/2026: "Tema DEVE ser aberto para
 * colocar novos e aí ele entrar na lista"). Reaproveita o tema já existente
 * quando o nome bate, pra não encher a lista de repetido.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: { nome?: string };
  try {
    body = (await req.json()) as { nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim().slice(0, 60);
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      const slug = nome
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);

      const r = await c.query<{ id: string; nome: string }>(
        `INSERT INTO frentes (user_id, nome, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, slug) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id, nome`,
        [acesso.ownerId, nome, slug || "tema"],
      );
      return { frente: r.rows[0] };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GuestError) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[guest-api] erro ao criar tema:", msg);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

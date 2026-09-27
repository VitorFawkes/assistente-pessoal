import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { analisarDepois } from "@/lib/teams-receber";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// Reunião do Teams que deu erro: quem marcou manda fazer o resumo e as ações de novo. Volta a
// "analisando" na hora (o botão some) e fica pronta quando o fluxo terminar.
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const r = await withTenant(user.id, (c) =>
    c.query(
      `UPDATE meetings SET status = 'analyzing', status_error = NULL, done_at = now()
        WHERE id = $1 AND user_id = $2 AND source = 'teams' AND status = 'error'
        RETURNING id`,
      [id, user.id],
    ),
  );
  if (!r.rows.length) return NextResponse.json({ error: "Essa reunião não está com erro." }, { status: 409 });
  analisarDepois(id, user.id);
  return NextResponse.json({ ok: true }, { status: 202 });
});

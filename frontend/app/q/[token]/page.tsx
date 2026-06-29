import { query } from "@/lib/db";
import type { AcessoConvidado } from "@/lib/quadros";
import { GuestBoard } from "@/components/guest-board";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export default async function QuadroConvidadoPage(ctx: Ctx) {
  const { token } = await ctx.params;

  // Resolver token via SECURITY DEFINER (sem contexto tenant)
  const rows = await query<AcessoConvidado>(
    `SELECT quadro_id AS "quadroId", user_id AS "ownerId", quadro_nome AS "quadroNome",
            convidado_id AS "convidadoId", convidado_nome AS "convidadoNome"
       FROM resolver_quadro_token($1)`,
    [token]
  );

  if (rows.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Link não está mais válido</h1>
          <p className="text-muted-foreground mb-6">
            Solicite um novo link ao dono do quadro.
          </p>
        </div>
      </div>
    );
  }

  const acesso = rows[0];

  return (
    <div className="min-h-screen bg-background">
      <GuestBoard token={token} acesso={acesso} />
    </div>
  );
}

import { query } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type Invite = {
  code: string;
  nome_sugerido: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export default async function ConviteCodigoPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  // Rate limit por IP — protege contra brute-force/enumeração (mesmo com 128
  // bits de entropia, evita ruído em logs e DoS).
  const ip = clientIp(await headers());
  if (!rateLimit(`convite-page:${ip}`, 10, 60_000)) {
    return (
      <div className="mx-auto max-w-md pt-20 text-center space-y-4">
        <h1 className="font-display text-3xl">Muitas tentativas.</h1>
        <p className="text-[color:var(--muted-strong)]">
          Aguarda um minuto e tenta de novo.
        </p>
      </div>
    );
  }

  const rows = await query<Invite>(
    `SELECT code, nome_sugerido, consumed_at, revoked_at
       FROM invites WHERE code = $1`,
    [code],
  );
  const invite = rows[0];

  if (!invite || invite.consumed_at || invite.revoked_at) {
    return (
      <div className="mx-auto max-w-md pt-16 sm:pt-24 text-center space-y-4">
        <h1 className="font-display text-3xl">Convite não está mais válido.</h1>
        <p className="text-[color:var(--muted-strong)]">
          Pode ser que já foi usado, ou foi revogado. Fala com o Vitor pra pedir
          um novo.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-12 sm:pt-20 space-y-6">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Convite
      </p>
      <h1 className="font-display text-4xl leading-[1.1]">
        Bem-vindo,{" "}
        <span className="italic font-[450] text-[color:var(--muted-strong)]">
          {invite.nome_sugerido}.
        </span>
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        Confirma seu nome abaixo. Você vai ficar logado nesse celular pelos
        próximos 30 dias, sem precisar de senha.
      </p>
      <form action="/api/sessao" method="POST" className="space-y-3">
        <input type="hidden" name="code" value={invite.code} />
        <input
          name="nome"
          defaultValue={invite.nome_sugerido}
          required
          minLength={2}
          maxLength={80}
          className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] px-4 py-3 text-base"
        />
        <button
          type="submit"
          className="w-full rounded-xl bg-[color:var(--foreground)] text-[color:var(--background)] py-3 font-medium hover:opacity-90 transition"
        >
          Confirmar e entrar
        </button>
      </form>
    </div>
  );
}

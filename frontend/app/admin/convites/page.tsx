import { query } from "@/lib/db";
import { criarConvite, revogarConvite } from "./actions";

export const dynamic = "force-dynamic";

type InviteRow = {
  code: string;
  nome_sugerido: string;
  created_at: string;
  consumed_at: string | null;
  consumed_by_nome: string | null;
  revoked_at: string | null;
};

async function fetchInvites(): Promise<InviteRow[]> {
  return query<InviteRow>(
    `SELECT i.code, i.nome_sugerido,
            to_char(i.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            to_char(i.consumed_at, 'YYYY-MM-DD HH24:MI') AS consumed_at,
            (SELECT u.nome FROM users u WHERE u.id = i.consumed_by) AS consumed_by_nome,
            to_char(i.revoked_at, 'YYYY-MM-DD HH24:MI') AS revoked_at
       FROM invites i
       ORDER BY i.created_at DESC
       LIMIT 100`,
  );
}

export default async function AdminConvitesPage() {
  const invites = await fetchInvites();
  const base = process.env.NEXT_PUBLIC_BASE_URL
    || process.env.FRONTEND_DOMAIN
    || "https://n8n-assistente-frontend.tatetz.easypanel.host";

  const pendentes = invites.filter((i) => !i.consumed_at && !i.revoked_at);
  const usados = invites.filter((i) => i.consumed_at);
  const revogados = invites.filter((i) => i.revoked_at && !i.consumed_at);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Admin
        </p>
        <h1 className="font-display text-3xl sm:text-4xl">Convites</h1>
        <p className="text-[13px] text-[color:var(--muted-strong)]">
          Gere um link, copia, manda no WhatsApp da pessoa. Cada link é uso
          único — a primeira pessoa que abrir vira a dona da conta.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
          Criar novo
        </h2>
        <form action={criarConvite} className="flex gap-2">
          <input
            name="nome"
            placeholder="Nome da pessoa (ex: João)"
            required
            minLength={2}
            maxLength={80}
            className="flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] px-4 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-[color:var(--foreground)] text-[color:var(--background)] px-4 py-2.5 text-sm font-medium hover:opacity-90 transition"
          >
            Gerar
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
          Pendentes ({pendentes.length})
        </h2>
        {pendentes.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-strong)]">
            Nenhum convite pendente.
          </p>
        ) : (
          <ul className="space-y-2">
            {pendentes.map((i) => (
              <li
                key={i.code}
                className="rounded-2xl border border-[color:var(--border)] p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium">{i.nome_sugerido}</div>
                    <div className="text-xs text-[color:var(--muted-strong)]">
                      criado {i.created_at}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-[11px] bg-[color:var(--accent)] px-2 py-1 rounded font-mono break-all">
                      {base}/c/{i.code}
                    </code>
                    <form action={revogarConvite}>
                      <input type="hidden" name="code" value={i.code} />
                      <button
                        type="submit"
                        className="text-xs text-[color:var(--urgent)] hover:underline"
                      >
                        revogar
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
          Usados ({usados.length})
        </h2>
        {usados.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-strong)]">
            Nenhum convite usado ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {usados.map((i) => (
              <li
                key={i.code}
                className="rounded-2xl border border-[color:var(--border)] p-3 text-sm"
              >
                <div className="font-medium">
                  {i.consumed_by_nome ?? i.nome_sugerido}
                </div>
                <div className="text-xs text-[color:var(--muted-strong)]">
                  consumido em {i.consumed_at} · convidado como &ldquo;
                  {i.nome_sugerido}&rdquo;
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revogados.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
            Revogados ({revogados.length})
          </h2>
          <ul className="space-y-2 text-sm text-[color:var(--muted-strong)]">
            {revogados.map((i) => (
              <li
                key={i.code}
                className="rounded-2xl border border-[color:var(--border)] p-3"
              >
                {i.nome_sugerido} · revogado em {i.revoked_at}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

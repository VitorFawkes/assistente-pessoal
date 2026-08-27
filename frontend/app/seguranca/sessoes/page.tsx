import { requireUserOrRedirect, getCurrentSessionId } from "@/lib/auth";
import { dataBR, horaBR } from "@/lib/data-br";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  created_at: string;
  last_used_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

// user_agent guarda o rótulo interno de quem criou a sessão ("admin-issued",
// "bridge-login-manual"). Mostrar o slug cru não diz nada a quem lê.
function nomeDispositivo(ua: string | null): string {
  if (!ua) return "Dispositivo desconhecido";
  const s = ua.toLowerCase();
  if (s.includes("iphone") || s.includes("ios")) return "iPhone";
  if (s.includes("ipad")) return "iPad";
  if (s.includes("android")) return "Android";
  if (s.includes("macintosh") || s.includes("mac os")) return "Mac";
  if (s.includes("windows")) return "Windows";
  if (s.startsWith("admin-issued")) return "Entrada pelo link de convite";
  if (s.startsWith("manual-bootstrap")) return "Primeiro acesso";
  if (s.startsWith("bridge-login")) return "Assistente (Mac)";
  return "Dispositivo desconhecido";
}

function fmtDateTime(iso: string): string {
  try {
    return `${dataBR(iso)} às ${horaBR(iso)}`;
  } catch {
    return iso;
  }
}

export default async function SessoesPage() {
  const user = await requireUserOrRedirect();
  const currentSessionId = await getCurrentSessionId();

  const sessions = await query<SessionRow>(
    `SELECT id,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
            to_char(last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_used_at,
            ip_address::text AS ip_address,
            user_agent
       FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY last_used_at DESC`,
    [user.id],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Segurança
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          Sessões ativas
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)]">
          Cada celular ou navegador onde você entrou aparece aqui. Se algum
          parece estranho, sai de todos os dispositivos.
        </p>
      </header>

      <ul className="space-y-2">
        {sessions.map((s) => {
          const isCurrent = s.id === currentSessionId;
          return (
            <li
              key={s.id}
              className={`rounded-2xl border p-4 text-sm ${
                isCurrent
                  ? "border-[color:var(--calm)] bg-[color:var(--calm-bg)]"
                  : "border-[color:var(--border)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="font-medium" title={s.user_agent ?? undefined}>
                  {nomeDispositivo(s.user_agent)}
                </div>
                {isCurrent && (
                  <span className="text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-[color:var(--calm)] text-[color:var(--background)]">
                    atual
                  </span>
                )}
              </div>
              <div className="text-[color:var(--muted-strong)] text-xs mt-1">
                {/* "IP ?" não informava nada — some quando não há IP. */}
                {s.ip_address ? `IP ${s.ip_address} · ` : ""}último uso{" "}
                {fmtDateTime(s.last_used_at)} · criada em {fmtDateTime(s.created_at)}
              </div>
            </li>
          );
        })}
      </ul>

      <form action="/api/sessao/revoke-all" method="POST" className="pt-4">
        <button
          type="submit"
          className="rounded-xl border border-[color:var(--urgent)] text-[color:var(--urgent)] px-5 py-2.5 hover:bg-[color:var(--urgent-bg)] transition"
        >
          Sair de todos os dispositivos
        </button>
      </form>
    </div>
  );
}

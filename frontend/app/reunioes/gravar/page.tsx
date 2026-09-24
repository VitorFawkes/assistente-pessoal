import { requireUserOrRedirect } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { RecordingScreen } from "@/components/recording-screen";
import { redirect } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GravarPage() {
  const user = await requireUserOrRedirect();

  // Gravador só disponível em TEAM_MODE
  if (!isTeamMode()) {
    redirect("/reunioes");
  }

  const pref = await query<{ visibilidade_padrao: string | null }>(
    `SELECT visibilidade_padrao FROM users WHERE id = $1`,
    [user.id],
  );
  const soEu = pref[0]?.visibilidade_padrao === "so_eu";

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Gravação
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Grave sua{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            reunião.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Escolha se é uma reunião na sala ou online e comece a gravar.
        </p>
        <p className="text-[13px] text-[color:var(--muted)] max-w-md">
          Quem vê o que você gravar: <strong className="font-medium text-[color:var(--muted-strong)]">{soEu ? "só você" : "toda a Welcome"}</strong>.{" "}
          <Link href="/seguranca/sessoes#quem-ve" className="underline hover:no-underline">
            Mudar
          </Link>{" "}
          (dá pra mudar em cada reunião depois).
        </p>
      </header>

      <RecordingScreen userId={user.id} />
    </div>
  );
}

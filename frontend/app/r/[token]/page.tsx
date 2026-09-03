import { headers } from "next/headers";
import { query } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";
import { acessoPorTokenOuNull } from "@/lib/reuniao-guest";
import { meetingsFor, tarefasFor, type Tarefa } from "@/lib/queries";
import { MeetingGuestView, type ReuniaoCompartilhada } from "@/components/meeting-guest-view";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export default async function ReuniaoCompartilhadaPage(ctx: Ctx) {
  const { token } = await ctx.params;
  const acesso = await acessoPorTokenOuNull(token, clientIp(await headers()));

  if (!acesso) {
    return (
      <div className="py-16 text-center space-y-3">
        <h1 className="font-display text-2xl">Este link não vale mais</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Peça um link novo pra quem te mandou.
        </p>
      </div>
    );
  }

  const [meeting, tarefas, dono] = await Promise.all([
    meetingsFor(acesso.ownerId).byIdDetailed(acesso.meetingId),
    tarefasFor(acesso.ownerId).byMeeting(acesso.meetingId) as Promise<Tarefa[]>,
    query<{ nome: string }>(`SELECT nome FROM users WHERE id = $1`, [acesso.ownerId]),
  ]);

  if (!meeting) {
    return (
      <div className="py-16 text-center space-y-3">
        <h1 className="font-display text-2xl">Reunião não encontrada</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Peça um link novo pra quem te mandou.
        </p>
      </div>
    );
  }

  return (
    <MeetingGuestView
      token={token}
      meeting={meeting as unknown as ReuniaoCompartilhada}
      tarefas={tarefas}
      donoNome={dono[0]?.nome ?? null}
    />
  );
}

import { requireUserOrRedirect } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { RecordingScreen } from "@/components/recording-screen";
import { redirect } from "next/navigation";
import { origensQuePodemEmbutir } from "@/lib/cookie-sessao";

export const dynamic = "force-dynamic";

// O gravador já aberto num jeito (28/09/2026): a página "Gravar reunião" do TTARS explica tudo, mostra
// quem vê (e muda o padrão) e leva direto para cá; o nome do jeito fica na barra do TTARS.
const MODOS = {
  sala: "na-sala",
  online: "online",
  arquivo: "arquivo",
} as const;

export default async function GravarNoModoPage({
  params,
}: {
  params: Promise<{ modo: string }>;
}) {
  const user = await requireUserOrRedirect();

  // Gravador só disponível em TEAM_MODE
  if (!isTeamMode()) {
    redirect("/reunioes");
  }

  const { modo } = await params;
  const escolhido = MODOS[modo as keyof typeof MODOS];
  if (!escolhido) redirect("/reunioes/gravar");

  return <RecordingScreen userId={user.id} modoInicial={escolhido} origensTtars={origensQuePodemEmbutir()} />;
}

import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { CoachDashboard } from "@/components/coach/dashboard";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  // No Ações da equipe o Coach é só pelo WhatsApp (Vitor, 29/09/2026): esta página não existe.
  if (isTeamMode()) notFound();
  await requireUserOrRedirect();
  return <CoachDashboard />;
}

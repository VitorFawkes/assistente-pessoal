import { requireUserOrRedirect, requireAdminOrRedirect } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { CoachDashboard } from "@/components/coach/dashboard";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const user = await requireUserOrRedirect();
  if (isTeamMode() && !user.is_admin) {
    await requireAdminOrRedirect();
  }
  return <CoachDashboard />;
}

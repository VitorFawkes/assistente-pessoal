import { requireUserOrRedirect } from "@/lib/auth";
import { CoachDashboard } from "@/components/coach/dashboard";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  await requireUserOrRedirect();
  return <CoachDashboard />;
}

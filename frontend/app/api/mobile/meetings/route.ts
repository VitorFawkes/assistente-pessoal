import { NextResponse } from "next/server";
import { withBearerAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

type MobileStatus = "processing" | "ready" | "failed" | "archived";

function mapStatus(s: string): MobileStatus {
  if (s === "done") return "ready";
  if (s === "error") return "failed";
  if (s === "archived_session") return "archived";
  return "processing"; // received, transcribing, analyzing, qualquer outro
}

export const GET = withBearerAuth(async (user, req) => {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || "20"), 100);

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const baseUrl = `${proto}://${host}`;

  const rows = await meetingsFor(user.id).listForIndex();
  const meetings = rows.slice(0, limit).map((m) => ({
    id: m.id,
    recorded_at: m.recorded_at,
    status: mapStatus(m.status),
    raw_status: m.status,
    summary: m.summary,
    duration_seconds: m.duration_seconds,
    source: m.source,
    meeting_type: m.meeting_type,
    tarefas_count: m.n_tarefas,
    web_url: `${baseUrl}/reunioes/${m.id}`,
  }));

  return NextResponse.json({ meetings });
});

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import {
  buildMeetingExport,
  parseExportRequest,
  type MeetingExportRow,
} from "@/lib/meeting-export";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const url = new URL((req as NextRequest).url);
  const parsed = parseExportRequest(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const m = (await meetingsFor(user.id).forExport(id)) as MeetingExportRow | null;
  if (!m) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  const out = buildMeetingExport(m, parsed.req);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });

  return new NextResponse(out.body, {
    status: 200,
    headers: {
      "Content-Type": out.mime,
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { sections?: Array<{ start_seconds?: number; title?: string }> };
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body: Body = (await (req as NextRequest).json().catch(() => ({}))) as Body;
  const raw = Array.isArray(body.sections) ? body.sections : [];

  const sections = raw
    .filter(
      (s) =>
        typeof s?.start_seconds === "number" &&
        Number.isFinite(s.start_seconds) &&
        s.start_seconds >= 0,
    )
    .map((s) => ({
      start_seconds: Math.round(s.start_seconds as number),
      title: (typeof s.title === "string" ? s.title : "").trim().slice(0, 120) || "Seção",
    }))
    .sort((a, b) => a.start_seconds - b.start_seconds);

  const updated = await meetingsFor(user.id).updateSections(id, sections);
  if (!updated) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true, sections });
});

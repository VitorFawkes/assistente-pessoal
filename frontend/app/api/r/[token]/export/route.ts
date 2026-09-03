import { type NextRequest, NextResponse } from "next/server";
import { meetingsFor } from "@/lib/queries";
import { clientIp } from "@/lib/rate-limit";
import { acessoPorToken, ReuniaoGuestError } from "@/lib/reuniao-guest";
import {
  buildMeetingExport,
  parseExportRequest,
  type MeetingExportRow,
} from "@/lib/meeting-export";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/r/[token]/export — mesmo arquivo que o dono baixa, para quem
 * recebeu o link. A reunião vem do token; não há id na URL pra trocar.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;

  const parsed = parseExportRequest(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  try {
    const { meetingId, ownerId } = await acessoPorToken(token, clientIp(req.headers));
    const m = (await meetingsFor(ownerId).forExport(meetingId)) as MeetingExportRow | null;
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
  } catch (e) {
    if (e instanceof ReuniaoGuestError) {
      if (e.code === "rate_limit") {
        return NextResponse.json(
          { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      return NextResponse.json(
        { error: "invalid_token", message: "Link inválido ou desligado." },
        { status: 401 },
      );
    }
    throw e;
  }
}

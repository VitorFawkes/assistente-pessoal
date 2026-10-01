import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { souDoMarketing, tarefasDoMarketing } from "@/lib/central-do-marketing";

export const dynamic = "force-dynamic";

// As tarefas do marketing para o Hub do Marketing no TTARS, como estão no Notion agora.
export const GET = withAuth(async (user) => {
  if (!(await souDoMarketing(user.id))) {
    return NextResponse.json({ error: "As tarefas do marketing são do time de marketing." }, { status: 403 });
  }
  return NextResponse.json(await tarefasDoMarketing(user.id));
});

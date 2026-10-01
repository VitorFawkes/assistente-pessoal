import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pedidosDaCentral, souDoMarketing } from "@/lib/central-do-marketing";
import { podeMontar } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Central do Marketing no TTARS: os pedidos que chegaram ao marketing e se quem vê monta formulários.
export const GET = withAuth(async (user) => {
  if (!(await souDoMarketing(user.id))) {
    return NextResponse.json({ error: "A Central é do time de marketing." }, { status: 403 });
  }
  const [tarefas, monta] = await Promise.all([pedidosDaCentral(user.id), podeMontar(user.id)]);
  return NextResponse.json({ tarefas, pode_montar: monta });
});

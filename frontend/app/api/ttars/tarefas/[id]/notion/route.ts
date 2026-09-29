import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { acessoTarefa } from "@/lib/equipe-compartilhado";
import { UUID_RE } from "@/lib/hub";
import { mudarAreaNoNotion } from "@/lib/notion-sync";
import { ErroDoNotion } from "@/lib/notion-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const AREAS = ["Trips", "Weddings", "Corp", "Institucional"];

// A área (BU) da ação no Notion do marketing. Quem vê a ação muda (como os outros campos dela).
// Corpo: { bu }.
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { bu?: unknown } | null;
  const bu = typeof b?.bu === "string" ? b.bu.trim() : "";
  if (!AREAS.includes(bu)) return NextResponse.json({ error: "Escolha Trips, Weddings, Corp ou Institucional." }, { status: 400 });
  if (!UUID_RE.test(id) || !(await acessoTarefa(user.id, id))) {
    return NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
  }
  try {
    const r = await mudarAreaNoNotion(id, bu);
    if (r === "sem_ligacao") return NextResponse.json({ error: "Essa ação não está no Notion do marketing." }, { status: 400 });
    return NextResponse.json({ ok: true, bu });
  } catch (e) {
    if (e instanceof ErroDoNotion) return NextResponse.json({ error: "O Notion não aceitou a mudança. Tente de novo." }, { status: 502 });
    throw e;
  }
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pessoasDaEquipe } from "@/lib/equipe-compartilhado";
import { pessoasDoNotion } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";

// Quem pode receber uma ação: todas as pessoas da Welcome no TTARS (fora "Parceiros"), mais
// quem só existe no Notion do marketing. Time serve pra agrupar/filtrar, nunca como a lista.
export const GET = withAuth(async (user) => {
  const [pessoas, doNotion] = await Promise.all([pessoasDaEquipe(), pessoasDoNotion()]);
  const noNotion = new Set(doNotion.filter((p) => p.user_id).map((p) => p.user_id));
  const marketing = { id: "notion-marketing", nome: "Marketing (Notion)" };
  const lista = pessoas.map((p) => ({
    ...p,
    notion: !!p.id && noNotion.has(p.id),
    times: p.id && noNotion.has(p.id) ? [...(p.times ?? []), marketing] : p.times,
  }));
  const soNoNotion = doNotion
    .filter((p) => !p.user_id)
    .map((p) => ({
      id: null,
      email: `notion:${p.notion_user_id}`,
      nome: p.nome,
      organizacao: "Notion do marketing",
      times: [marketing],
      usa_acoes: false,
      notion: true,
    }));
  const eu = user.email ? lista.find((p) => p.email === user.email!.toLowerCase()) : undefined;
  const todas = [...lista, ...soNoNotion];
  return NextResponse.json({
    eu: { id: user.id, nome: user.nome, email: user.email },
    pessoas: eu
      ? todas
      : [{ id: user.id, email: (user.email || "").toLowerCase(), nome: user.nome, organizacao: "", times: [], usa_acoes: true, notion: false }, ...todas],
  });
});

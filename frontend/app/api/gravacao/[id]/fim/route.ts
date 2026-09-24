import { withAuth } from "@/lib/auth";
import { finalizarGravacao, idDeGravacaoValido } from "@/lib/gravacao-final";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!idDeGravacaoValido(id)) return Response.json({ error: "pedido inválido" }, { status: 400 });
  const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown };
  const nome = typeof corpo.nome === "string" ? corpo.nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) : undefined;
  try {
    await finalizarGravacao(user.id, id, nome || undefined);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("gravacao/fim:", err);
    return Response.json({ error: "não consegui enviar a gravação" }, { status: 500 });
  }
});

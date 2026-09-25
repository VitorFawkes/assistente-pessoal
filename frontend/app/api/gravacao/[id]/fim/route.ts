import { withAuth } from "@/lib/auth";
import { encerrarGravacao } from "@/lib/gravacao-rotas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, req, ctx) => encerrarGravacao(user, req, (await ctx.params).id));

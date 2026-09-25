import { withBearerAuth } from "@/lib/auth";
import { receberPedaco } from "@/lib/gravacao-rotas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withBearerAuth<Ctx>(async (user, req, ctx) => receberPedaco(user, req, (await ctx.params).id));

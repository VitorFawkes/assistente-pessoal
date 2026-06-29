import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; gid: string }> };

export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id, gid } = await ctx.params;
  await quadrosFor(user.id).revogarConvidado(id, gid);
  return new NextResponse(null, { status: 204 });
});

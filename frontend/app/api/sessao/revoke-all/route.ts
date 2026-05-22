import { NextRequest, NextResponse } from "next/server";
import { withAuth, revokeAllSessions } from "@/lib/auth";

export const POST = withAuth(async (user, req) => {
  await revokeAllSessions(user.id);
  return NextResponse.redirect(new URL("/sem-acesso", req.url), 303);
});

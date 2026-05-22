import { NextResponse } from "next/server";
import { withAuth, revokeAllSessions } from "@/lib/auth";

export const POST = withAuth(async (user, req) => {
  await revokeAllSessions(user.id);
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  return NextResponse.redirect(`${proto}://${host}/sem-acesso`, 303);
});

import { NextResponse } from "next/server";
import { withBearerAuth, revokeAllSessions } from "@/lib/auth";

export const POST = withBearerAuth(async (user) => {
  await revokeAllSessions(user.id);
  return new NextResponse(null, { status: 204 });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ownersFor } from "@/lib/owners";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (user) => {
  const owners = await ownersFor(user.id).list();
  return NextResponse.json(
    { owners },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { timesVisiveis } from "@/lib/hub";

export const dynamic = "force-dynamic";

// Times do TTARS que quem pede vê (os dele; administrador vê todos), com as pessoas e quantas
// ações do time estão abertas.
export const GET = withAuth(async (user) => {
  return NextResponse.json({ times: await timesVisiveis(user.id) });
});

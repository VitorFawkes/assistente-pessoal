import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { souDoMarketing } from "@/lib/central-do-marketing";

export const dynamic = "force-dynamic";

// Se a Central do Marketing aparece no menu do TTARS para quem chama (marketing ou administrador).
export const GET = withAuth(async (user) => NextResponse.json({ pode: await souDoMarketing(user.id) }));

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ErroDoNotion } from "@/lib/notion-api";
import { estadoDoNotion, ligarNotion } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";

// Como está a ligação com o Notion do marketing.
export const GET = withAuth(async (user) => NextResponse.json({ ...(await estadoDoNotion()), pode_ligar: user.is_admin }));

// O admin cola o segredo da conexão que a dona do Notion criou.
export const POST = withAuth(
  async (user, req) => {
    let body: { token?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const token = (body.token ?? "").trim();
    if (!/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(token)) {
      return NextResponse.json({ error: "Isso não parece o segredo da conexão do Notion (começa com ntn_ ou secret_)." }, { status: 400 });
    }
    try {
      const r = await ligarNotion(user.id, token);
      return NextResponse.json({ ok: true, ...r, estado: await estadoDoNotion() });
    } catch (e) {
      if (e instanceof ErroDoNotion) {
        const msg =
          e.status === 401
            ? "O Notion não aceitou esse segredo."
            : e.status === 404
              ? "A conexão ainda não enxerga a base Tasks. Falta a dona do Notion adicionar a conexão na base (três pontinhos → Conexões)."
              : e.message;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (e instanceof Error && e.message.includes("ainda não foi preparado")) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }
  },
  { admin: true },
);

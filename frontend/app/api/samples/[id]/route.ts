// /api/samples/[id]
//   DELETE — soft delete de uma amostra de voz (proxy pro voice-svc)
//   PATCH  — reatribui pra outra pessoa (pessoa_id uuid OU nome → get-or-create)
// Multi-tenant: get-or-create de pessoa é escopado ao user; user_id é passado
// pro voice-svc no body (voice-svc usa app_writer role com BYPASSRLS).
import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${VOICE_SVC_URL}/samples/${id}?user_id=${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      },
    );
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep */
    }
    return NextResponse.json(parsed, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: "falha ao chamar voice-svc", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
});

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { pessoa_id?: string; nome?: string };
  try {
    body = (await (req as NextRequest).json()) as { pessoa_id?: string; nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  let pessoaId = typeof body.pessoa_id === "string" ? body.pessoa_id.trim() : "";
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";

  if (!pessoaId && !nome) {
    return NextResponse.json(
      { error: "envie pessoa_id (uuid) ou nome (string)" },
      { status: 400 },
    );
  }

  try {
    if (!UUID_RE.test(pessoaId)) {
      const lookupNome = pessoaId && !nome ? pessoaId : nome;
      if (!lookupNome) {
        return NextResponse.json({ error: "nome vazio" }, { status: 400 });
      }
      pessoaId = await withTenant(user.id, async (db) => {
        const r = await db.query<{ id: string }>(
          `INSERT INTO pessoas (user_id, nome) VALUES ($1, $2)
           ON CONFLICT (user_id, nome) DO UPDATE SET nome = EXCLUDED.nome
           RETURNING id`,
          [user.id, lookupNome.slice(0, 80)],
        );
        return r.rows[0].id;
      });
    }

    const res = await fetch(`${VOICE_SVC_URL}/samples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pessoa_id: pessoaId, user_id: user.id }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep */
    }
    return NextResponse.json(parsed, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: "falha", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

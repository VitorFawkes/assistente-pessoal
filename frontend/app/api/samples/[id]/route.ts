// /api/samples/[id]
//   DELETE — soft delete de uma amostra de voz
//   PATCH  — reatribui pra outra pessoa (aceita pessoa_id uuid OU nome — string vira get-or-create)
// Proxy pro voice-svc; pra nome string, faz get-or-create pessoa antes.
import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const res = await fetch(`${VOICE_SVC_URL}/samples/${id}`, {
      method: "DELETE",
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
      { error: "falha ao chamar voice-svc", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { pessoa_id?: string; nome?: string };
  try {
    body = (await req.json()) as { pessoa_id?: string; nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Resolve pessoa_id: aceita uuid direto, ou nome string (get-or-create)
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
      // Veio nome (ou pessoa_id mal formado) → get-or-create por nome
      const lookupNome = pessoaId && !nome ? pessoaId : nome;
      if (!lookupNome) {
        return NextResponse.json({ error: "nome vazio" }, { status: 400 });
      }
      const rows = await query<{ id: string }>(
        `INSERT INTO pessoas (nome) VALUES ($1)
         ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id`,
        [lookupNome.slice(0, 80)],
      );
      pessoaId = rows[0].id;
    }

    const res = await fetch(`${VOICE_SVC_URL}/samples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pessoa_id: pessoaId }),
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
}

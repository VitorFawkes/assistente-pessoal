import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

type PostBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  frente_id: string | null;
  pessoas: { nome: string; principal?: boolean }[];
}>;

// POST /api/tarefas — cria uma tarefa manual (não veio de reunião).
// meeting_id fica NULL; vira o "controle de tarefas" unificado.
export const POST = withAuth(async (user, req) => {
  let body: PostBody;
  try {
    body = (await (req as NextRequest).json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const titulo = (body.titulo ?? "").trim();
  if (!titulo) {
    return NextResponse.json({ error: "título obrigatório" }, { status: 400 });
  }

  const acao = body.acao ?? "executar";
  if (!VALID_ACAO.includes(acao)) {
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }

  const prioridade = body.prioridade ?? "media";
  if (!VALID_PRIORIDADE.includes(prioridade)) {
    return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
  }

  const owner = (body.owner ?? "").trim() || "vitor";

  try {
    const created = await withTenant(user.id, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tarefas
           (user_id, titulo, descricao, owner, acao, prazo, prazo_text, prioridade, frente_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          user.id,
          titulo,
          body.descricao?.trim() || null,
          owner,
          acao,
          body.prazo ?? null,
          body.prazo_text?.trim() || null,
          prioridade,
          body.frente_id ?? null,
        ],
      );
      const row = rows[0] as { id: string };

      await c.query(
        "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'criada',$2)",
        [row.id, JSON.stringify({ manual: true })],
      );

      if (Array.isArray(body.pessoas)) {
        for (const p of body.pessoas) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;
          const pr = await c.query<{ id: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
             ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
            [user.id, nome],
          );
          await c.query(
            `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
             ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
            [row.id, pr.rows[0].id, !!p.principal],
          );
        }
      }

      return row;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

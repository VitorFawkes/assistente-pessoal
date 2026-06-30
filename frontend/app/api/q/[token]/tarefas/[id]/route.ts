import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError, membershipDoQuadro } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string; id: string }> };

const VALID_STATUS = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

type PatchBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  inicio: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  status: (typeof VALID_STATUS)[number];
  frente_id: string | null;
  pessoas: { nome: string; principal?: boolean }[];
}>;

/**
 * PATCH /api/q/[token]/tarefas/[id]
 * Edita tarefa do quadro do convidado.
 * Validação: membership em quadro_tarefas.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { token, id } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      // Validar membership: tarefa está no quadro
      const isMember = await membershipDoQuadro(
        c,
        acesso.quadroId,
        id
      );

      if (!isMember) {
        throw new Error("tarefa_not_in_board");
      }

      const sets: string[] = [];
      const values: unknown[] = [];

      const push = (col: string, val: unknown) => {
        values.push(val);
        sets.push(`${col} = $${values.length}`);
      };

      if (body.titulo !== undefined) push("titulo", body.titulo);
      if (body.descricao !== undefined) push("descricao", body.descricao);
      if (body.owner !== undefined) push("owner", body.owner);
      if (body.acao !== undefined) {
        if (!VALID_ACAO.includes(body.acao)) {
          throw new Error("invalid_acao");
        }
        push("acao", body.acao);
      }
      if (body.prazo !== undefined) push("prazo", body.prazo);
      if (body.inicio !== undefined) push("inicio", body.inicio);
      if (body.prazo_text !== undefined) push("prazo_text", body.prazo_text);
      if (body.prioridade !== undefined) {
        if (!VALID_PRIORIDADE.includes(body.prioridade)) {
          throw new Error("invalid_prioridade");
        }
        push("prioridade", body.prioridade);
      }
      if (body.status !== undefined) {
        if (!VALID_STATUS.includes(body.status)) {
          throw new Error("invalid_status");
        }
        push("status", body.status);
        if (body.status === "concluida") sets.push("concluida_em = now()");
        if (body.status === "cancelada") sets.push("cancelada_em = now()");
        if (body.status === "aberta" || body.status === "em_andamento") {
          sets.push("concluida_em = NULL", "cancelada_em = NULL");
        }
      }
      if (body.frente_id !== undefined) push("frente_id", body.frente_id);
      // no_plano NÃO é editável pelo convidado: ele não injeta no /plano do dono.

      const hasPessoas = Array.isArray(body.pessoas);

      if (!sets.length && !hasPessoas) {
        throw new Error("nothing_to_update");
      }

      if (sets.length) {
        values.push(id);
        const sql = `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`;
        const { rows } = await c.query(sql, values);
        const tarefa = rows[0];

        if (!tarefa) throw new Error("tarefa_not_found");

        // Registrar evento com convidado
        await c.query(
          `
          INSERT INTO tarefa_eventos (tarefa_id, evento, payload, quadro_convidado_id)
          VALUES ($1, $2, $3::jsonb, $4)
          `,
          [
            id,
            "editada",
            JSON.stringify({ origem: "convidado", mudancas: body }),
            acesso.convidadoId,
          ]
        );
      }

      if (hasPessoas) {
        await c.query("DELETE FROM tarefa_pessoas WHERE tarefa_id = $1", [id]);
        for (const p of body.pessoas!) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;

          const pessoaResult = await c.query<{ id: string }>(
            `
            INSERT INTO pessoas (user_id, nome)
            VALUES ($1, $2)
            ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now()
            RETURNING id
            `,
            [acesso.ownerId, nome]
          );

          const pessoaId = pessoaResult.rows[0]?.id;
          if (pessoaId) {
            await c.query(
              `
              INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal)
              VALUES ($1, $2, $3)
              ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal
              `,
              [id, pessoaId, (p.principal as boolean) ?? false]
            );
          }
        }
      }

      // Retornar tarefa atualizada
      const { rows } = await c.query("SELECT * FROM tarefas WHERE id = $1", [id]);
      return rows[0];
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GuestError) {
      if (e.code === "rate_limit") {
        return NextResponse.json(
          { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
      return NextResponse.json(
        { error: "invalid_token", message: "Link inválido ou revogado." },
        { status: 401 }
      );
    }

    const msg = e instanceof Error ? e.message : String(e);

    if (msg === "tarefa_not_in_board") {
      return NextResponse.json(
        { error: "not_found", message: "Tarefa não está neste quadro." },
        { status: 404 }
      );
    }

    if (msg === "tarefa_not_found") {
      return NextResponse.json(
        { error: "not_found", message: "Tarefa não encontrada." },
        { status: 404 }
      );
    }

    if (msg === "invalid_acao" || msg === "invalid_prioridade" || msg === "invalid_status") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (msg === "nothing_to_update") {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
    }

    console.error("[guest-api] erro inesperado:", msg);
    return NextResponse.json(
      { error: "server_error", message: "Erro ao processar a requisição." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/q/[token]/tarefas/[id]
 * BLOQUEADO para convidados — somente o dono exclui tarefas. Validamos o token
 * pela mesma porta (rate-limit + 401 se inválido/revogado) e recusamos com 403.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    return await withGuest(token, ip, async () =>
      NextResponse.json(
        { error: "forbidden", message: "Convidado não pode excluir tarefas." },
        { status: 403 }
      )
    );
  } catch (e) {
    if (e instanceof GuestError) {
      if (e.code === "rate_limit") {
        return NextResponse.json(
          { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
      return NextResponse.json(
        { error: "invalid_token", message: "Link inválido ou revogado." },
        { status: 401 }
      );
    }

    const msg = e instanceof Error ? e.message : String(e);
    console.error("[guest-api] erro inesperado:", msg);
    return NextResponse.json(
      { error: "server_error", message: "Erro ao processar a requisição." },
      { status: 500 },
    );
  }
}

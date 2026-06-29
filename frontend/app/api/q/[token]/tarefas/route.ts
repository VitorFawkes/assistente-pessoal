import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/q/[token]/tarefas
 * Lista tarefas do quadro do convidado.
 * Retorna { quadro, convidado, tarefas }
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      // Query tarefas no MESMO client tenant (RLS escopado ao dono)
      const tarefasResult = await c.query(
        `
        SELECT t.* FROM tarefas t
        JOIN quadro_tarefas qt ON qt.tarefa_id = t.id
        WHERE qt.quadro_id = $1 AND t.user_id = $2
        ORDER BY qt.ordem, t.created_at DESC
        `,
        [acesso.quadroId, acesso.ownerId]
      );

      return {
        quadro: {
          id: acesso.quadroId,
          nome: acesso.quadroNome,
        },
        convidado: {
          id: acesso.convidadoId,
          nome: acesso.convidadoNome,
        },
        tarefas: tarefasResult.rows,
      };
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
    console.error("[guest-api] erro inesperado:", msg);
    return NextResponse.json(
      { error: "server_error", message: "Erro ao processar a requisição." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/q/[token]/tarefas
 * Cria nova tarefa no quadro do convidado.
 * Registra evento com quadro_convidado_id.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const titulo = String(body.titulo || "").trim();
  if (!titulo) {
    return NextResponse.json(
      { error: "titulo is required" },
      { status: 400 }
    );
  }

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      // TUDO na mesma transação do client tenant
      const tarefaResult = await c.query(
        `
        INSERT INTO tarefas (
          user_id, titulo, descricao, owner, acao, prazo, prazo_text,
          prioridade, frente_id, inicio, no_plano
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        `,
        [
          acesso.ownerId,
          titulo,
          body.descricao ?? null,
          body.owner ?? "?",
          body.acao ?? "executar",
          body.prazo ?? null,
          body.prazo_text ?? null,
          body.prioridade ?? "media",
          body.frente_id ?? null,
          body.inicio ?? null,
          body.no_plano === true,
        ]
      );

      const tarefa = tarefaResult.rows[0];
      if (!tarefa) throw new Error("Failed to create tarefa");

      // Vincular em quadro_tarefas (atomicamente no mesmo client)
      await c.query(
        `INSERT INTO quadro_tarefas (quadro_id, tarefa_id) VALUES ($1, $2)`,
        [acesso.quadroId, tarefa.id]
      );

      // Registrar evento com convidado
      await c.query(
        `
        INSERT INTO tarefa_eventos (tarefa_id, evento, payload, quadro_convidado_id)
        VALUES ($1, $2, $3::jsonb, $4)
        `,
        [
          tarefa.id,
          "criada",
          JSON.stringify({ origem: "convidado" }),
          acesso.convidadoId,
        ]
      );

      // Se houver pessoas no draft, inserir em tarefa_pessoas
      if (Array.isArray(body.pessoas)) {
        for (const p of body.pessoas) {
          const nome = String(p.nome || "").trim();
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
              [tarefa.id, pessoaId, (p.principal as boolean) ?? false]
            );
          }
        }
      }

      return tarefa;
    });

    return NextResponse.json(result, { status: 201 });
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

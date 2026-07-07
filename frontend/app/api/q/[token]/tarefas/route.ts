import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import { TAREFA_SELECT } from "@/lib/queries";

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
      // Wrap do TAREFA_SELECT pra expor a ordem POR-QUADRO (quadro_ordem) igual
      // ao owner — a visão timeline do convidado ordena/reordena por ela.
      const tarefasResult = await c.query(
        `SELECT sub.*, qt.ordem AS quadro_ordem
           FROM (${TAREFA_SELECT}) sub
           JOIN quadro_tarefas qt ON qt.tarefa_id = sub.id
          WHERE qt.quadro_id = $1 AND sub.user_id = $2
          ORDER BY qt.ordem NULLS LAST, sub.created_at DESC`,
        [acesso.quadroId, acesso.ownerId]
      );

      // dados do quadro (descrição/vista) + convidados, pra o convidado gerenciar
      const qr = await c.query<{ descricao: string | null; vista_padrao: string }>(
        `SELECT descricao, vista_padrao FROM quadros WHERE id = $1`,
        [acesso.quadroId],
      );
      const convR = await c.query(
        `SELECT id, nome, token, created_at, last_seen_at
           FROM quadro_convidados
          WHERE quadro_id = $1 AND revoked_at IS NULL
          ORDER BY created_at DESC`,
        [acesso.quadroId],
      );

      return {
        quadro: {
          id: acesso.quadroId,
          nome: acesso.quadroNome,
          descricao: qr.rows[0]?.descricao ?? null,
          vista_padrao: qr.rows[0]?.vista_padrao ?? "lista",
        },
        convidado: {
          id: acesso.convidadoId,
          nome: acesso.convidadoNome,
        },
        tarefas: tarefasResult.rows,
        convidados: convR.rows,
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
          false, // convidado nunca injeta tarefa no /plano do dono
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

      // Re-seleciona no shape enriquecido (pessoas/frente/meeting_*) — MESMO
      // shape do GET, pra o cliente (GuestTaskProvider) não substituir a tarefa
      // por uma linha crua sem pessoas/área ao criar.
      const enriched = await c.query(`${TAREFA_SELECT} WHERE t.id = $1`, [tarefa.id]);
      return enriched.rows[0] ?? tarefa;
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

import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError, membershipDoQuadro, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import { TAREFA_SELECT } from "@/lib/queries";

type Ctx = { params: Promise<{ token: string; id: string }> };

const VALID_STATUS = ["aberta", "em_andamento", "aguardando_aprovacao", "concluida", "cancelada"] as const;
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
  depende_de: string | null;
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
        // desde quando está nesta situação — é o "entrou nesta coluna" do quadro
        sets.push("situacao_desde = now()");
        if (body.status === "concluida") sets.push("concluida_em = now()");
        if (body.status === "cancelada") sets.push("cancelada_em = now()");
        if (body.status === "aberta" || body.status === "em_andamento") {
          sets.push("concluida_em = NULL", "cancelada_em = NULL");
        }
      }
      if (body.depende_de !== undefined) {
        const dep = typeof body.depende_de === "string" ? body.depende_de.trim() : null;
        push("depende_de", dep && dep !== "—" ? dep.slice(0, 300) : null);
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

      // Mudou dono/ação sem `pessoas` explícitas → recalcula o flag `principal`
      // (que decide o agrupamento por pessoa), espelhando a rota do dono:
      //   executar → ninguém principal (agrupa em "Você")
      //   cobrar/aguardar → principal = a pessoa do novo dono (cria/vincula)
      if (!hasPessoas && sets.length && (body.owner !== undefined || body.acao !== undefined)) {
        const cur = await c.query<{ acao: string; owner: string }>(
          "SELECT acao, owner FROM tarefas WHERE id = $1",
          [id],
        );
        const acao = String(cur.rows[0]?.acao ?? "");
        const owner = String(cur.rows[0]?.owner ?? "").trim();
        if (acao === "executar") {
          await c.query(
            "UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1 AND principal",
            [id],
          );
        } else {
          await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1", [id]);
          if (owner && owner !== "?" && owner.toLowerCase() !== "vitor") {
            const found = await c.query<{ pessoa_id: string }>(
              `SELECT tp.pessoa_id FROM tarefa_pessoas tp
                 JOIN pessoas p ON p.id = tp.pessoa_id
                WHERE tp.tarefa_id = $1 AND app_slugify(p.nome) = app_slugify($2) LIMIT 1`,
              [id, owner],
            );
            let pessoaId = found.rows[0]?.pessoa_id;
            if (!pessoaId) {
              const pr = await c.query<{ id: string }>(
                `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
                 ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
                [acesso.ownerId, owner],
              );
              pessoaId = pr.rows[0].id;
            }
            await c.query(
              `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,true)
               ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
              [id, pessoaId],
            );
          }
        }
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

      // Retornar tarefa no shape enriquecido (pessoas/frente/meeting_*) — MESMO
      // shape do GET. Sem isso o cliente (GuestTaskProvider) substitui a tarefa
      // por uma linha crua sem pessoas/área, e a edição (ex.: mudar a data)
      // parece quebrar/sumir chips ao re-renderizar.
      const { rows } = await c.query(`${TAREFA_SELECT} WHERE t.id = $1`, [id]);
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
 * O convidado NÃO exclui a tarefa — só a REMOVE do quadro (desvincula em
 * quadro_tarefas). A tarefa continua existindo pro dono.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { token, id } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    await withGuest(token, ip, async ({ acesso, c }) => {
      // Decisão do Vitor (20/08/2026): quem entra pelo link exclui de verdade,
      // como o dono. Antes daqui a tarefa só saía do quadro.
      // Guarda um retrato inteiro antes de apagar — é o que permite recuperar
      // depois que o "Desfazer" da tela some.
      const antes = await c.query(
        `SELECT to_jsonb(t) AS tarefa,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('pessoa_id', tp.pessoa_id, 'principal', tp.principal))
                          FROM tarefa_pessoas tp WHERE tp.tarefa_id = t.id), '[]'::jsonb) AS pessoas
           FROM tarefas t WHERE t.id = $1`,
        [id],
      );
      if (!antes.rows.length) return;

      await c.query(
        `INSERT INTO audit_log (user_id, action, target_id, metadata)
         VALUES ($1, 'tarefa.excluida_por_convidado', $2, $3)`,
        [
          acesso.ownerId,
          id,
          JSON.stringify({
            quadro_id: acesso.quadroId,
            convidado_id: acesso.convidadoId,
            convidado_nome: acesso.convidadoNome,
            snapshot: antes.rows[0],
          }),
        ],
      );

      await c.query("DELETE FROM tarefa_eventos WHERE tarefa_id = $1", [id]);
      await c.query("DELETE FROM tarefas WHERE id = $1", [id]);
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return guestErrorResponse(e);
  }
}

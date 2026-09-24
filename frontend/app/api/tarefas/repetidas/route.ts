import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { aposentarCopia, registrarMencao } from "@/lib/tarefas-repetidas-db";
import { getOwnerSlug, isOwner } from "@/lib/owner-slug";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body =
  | { acao: "juntar"; tarefa_id: string; alvo_id: string }
  | { acao: "diferentes"; tarefa_id: string }
  | { acao: "separar"; mencao_id: string };

type Linha = {
  id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: string;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: string;
  evidencia: string | null;
  area_raw: string | null;
  pessoas_raw: unknown;
  status: string;
  parece_com_id: string | null;
};

function feedback(nova: Pick<Linha, "titulo" | "descricao">, existente: Pick<Linha, "titulo" | "descricao">) {
  return JSON.stringify({
    nova: { titulo: nova.titulo, descricao: nova.descricao },
    existente: { titulo: existente.titulo, descricao: existente.descricao },
  });
}

/**
 * POST /api/tarefas/repetidas — os botões da tela:
 *   juntar     "É a mesma, juntar": o card vira "falada de novo" no outro e sai da lista
 *   diferentes "São diferentes": tira o aviso de repetida
 *   separar    "Virar tarefa separada": a menção volta a ser um card próprio
 * Todo clique vira exemplo pra próxima comparação (extracao_feedback).
 */
export const POST = withAuth(async (user, req) => {
  const body = (await (req as NextRequest).json().catch(() => null)) as Body | null;
  if (!body || !("acao" in body)) return NextResponse.json({ error: "corpo inválido" }, { status: 400 });

  try {
    const r = await withTenant(user.id, async (c) => {
      const pegar = async (id: string) =>
        (await c.query<Linha>(`SELECT * FROM tarefas WHERE id = $1 FOR UPDATE`, [id])).rows[0] ?? null;

      if (body.acao === "juntar") {
        if (!UUID_RE.test(body.tarefa_id) || !UUID_RE.test(body.alvo_id) || body.tarefa_id === body.alvo_id)
          return { status: 400, error: "ids inválidos" };
        const copia = await pegar(body.tarefa_id);
        const alvo = await pegar(body.alvo_id);
        if (!copia || !alvo) return { status: 404, error: "tarefa não encontrada" };
        await registrarMencao(c, {
          userId: user.id,
          alvoId: alvo.id,
          meetingId: copia.meeting_id,
          t: {
            titulo: copia.titulo,
            descricao: copia.descricao,
            owner: copia.owner,
            acao: copia.acao,
            prazo: copia.prazo,
            prazo_text: copia.prazo_text,
            prioridade: copia.prioridade,
            evidencia: copia.evidencia,
            area_raw: copia.area_raw,
            pessoas_raw: copia.pessoas_raw ? JSON.stringify(copia.pessoas_raw) : null,
            precisa_revisao: false,
          },
          origem: "juntada",
          tarefaOrigemId: copia.id,
        });
        // a juntada tem que acontecer mesmo se a menção já existia (clique repetido)
        await aposentarCopia(c, { copiaId: copia.id, principalId: alvo.id, motivo: "repetida" });
        await c.query(
          `INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'repetida',$3)`,
          [user.id, copia.meeting_id, feedback(copia, alvo)],
        );
        return { status: 200, ok: true, principal_id: alvo.id };
      }

      if (body.acao === "diferentes") {
        if (!UUID_RE.test(body.tarefa_id)) return { status: 400, error: "id inválido" };
        const t = await pegar(body.tarefa_id);
        if (!t) return { status: 404, error: "tarefa não encontrada" };
        const outra = t.parece_com_id ? await pegar(t.parece_com_id) : null;
        await c.query(`UPDATE tarefas SET parece_com_id = NULL WHERE id = $1`, [t.id]);
        if (outra) {
          await c.query(
            `INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'diferente',$3)`,
            [user.id, t.meeting_id, feedback(t, outra)],
          );
        }
        return { status: 200, ok: true };
      }

      if (body.acao === "separar") {
        if (!UUID_RE.test(body.mencao_id)) return { status: 400, error: "id inválido" };
        const m = (
          await c.query<{
            id: string;
            tarefa_id: string;
            meeting_id: string | null;
            titulo_falado: string;
            descricao_falada: string | null;
            evidencia: string | null;
            owner_falado: string | null;
            acao_falada: string | null;
            prazo_falado: string | null;
            prazo_text_falado: string | null;
            prioridade_falada: string | null;
            pessoas_falado: unknown;
            area_falada: string | null;
            prazo_anterior: string | null;
            tarefa_origem_id: string | null;
          }>(`SELECT * FROM tarefa_mencoes WHERE id = $1`, [body.mencao_id])
        ).rows[0];
        if (!m) return { status: 404, error: "menção não encontrada" };
        const card = await pegar(m.tarefa_id);

        // Veio de um card que foi juntado? Ele volta; senão nasce um card novo.
        let novaId: string | null = null;
        if (m.tarefa_origem_id) {
          const r = await c.query<{ id: string }>(
            `UPDATE tarefas SET status = 'aberta', cancelada_em = NULL, situacao_desde = now()
              WHERE id = $1 AND status = 'cancelada' RETURNING id`,
            [m.tarefa_origem_id],
          );
          novaId = r.rows[0]?.id ?? null;
          if (novaId) {
            await c.query(`INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'reaberta',$2)`, [
              novaId,
              JSON.stringify({ motivo: "virou_tarefa_separada" }),
            ]);
          }
        }
        if (!novaId) {
          const dono = (m.owner_falado ?? "").trim() || getOwnerSlug();
          const acao = ["executar", "cobrar", "aguardar"].includes(String(m.acao_falada))
            ? m.acao_falada
            : isOwner(dono)
              ? "executar"
              : "cobrar";
          const r = await c.query<{ id: string }>(
            `INSERT INTO tarefas (user_id, meeting_id, titulo, descricao, owner, acao, prazo, prazo_text,
                                  prioridade, evidencia, area_raw, pessoas_raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
            [
              user.id,
              m.meeting_id,
              m.titulo_falado,
              m.descricao_falada,
              dono,
              acao,
              m.prazo_falado,
              m.prazo_text_falado,
              ["baixa", "media", "alta", "urgente"].includes(String(m.prioridade_falada))
                ? m.prioridade_falada
                : "media",
              m.evidencia,
              m.area_falada,
              m.pessoas_falado ? JSON.stringify(m.pessoas_falado) : null,
            ],
          );
          novaId = r.rows[0].id;
        }
        // o prazo que essa menção trouxe pro card volta a ser o de antes
        if (card && m.prazo_anterior && m.prazo_falado && card.prazo &&
            new Date(card.prazo).getTime() === new Date(m.prazo_falado).getTime()) {
          await c.query(`UPDATE tarefas SET prazo = $2 WHERE id = $1`, [card.id, m.prazo_anterior]);
        }
        await c.query(`DELETE FROM tarefa_mencoes WHERE id = $1`, [m.id]);
        if (card) {
          await c.query(
            `INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'diferente',$3)`,
            [user.id, m.meeting_id, feedback({ titulo: m.titulo_falado, descricao: m.descricao_falada }, card)],
          );
        }
        return { status: 200, ok: true, tarefa_id: novaId };
      }

      return { status: 400, error: "ação desconhecida" };
    });
    const { status, ...resto } = r;
    return NextResponse.json(resto, { status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

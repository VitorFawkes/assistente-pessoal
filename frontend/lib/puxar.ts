// Quem estava na reunião puxa uma ação dela para a própria lista (pedido do Vitor, 27/09/2026:
// "quem estava nela pode conseguir achar ela e ver as tarefas pra puxar").
//
// A ação continua de quem criou (quem marcou a reunião): passa a ter a pessoa como quem faz,
// como quando o dono passa a um colega, e o dono acompanha ("Eu cobro"). O banco confere se a
// pessoa foi chamada para a reunião (equipe_posso_puxar, db/equipe/010); o app age no tenant
// do dono, no mesmo desenho das outras telas da equipe.

import { withTenant } from "./db";
import { acessoTarefa, ajustarPrincipal, registrarEvento } from "./equipe-compartilhado";
import { getOwnerSlug } from "./owner-slug";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHADAS = ["concluida", "cancelada"];

type Resultado = { ok: true } | { ok: false; status: number; erro: string };

async function podePuxar(userId: string, tarefaId: string) {
  if (!UUID_RE.test(tarefaId)) return null;
  const r = await withTenant(userId, (c) =>
    c.query<{ dono_id: string; responsavel_id: string | null; status: string }>(
      `SELECT dono_id::text, responsavel_id::text, status FROM equipe_posso_puxar($1)`,
      [tarefaId],
    ),
  );
  return r.rows[0] ?? null;
}

export async function puxarAcao(eu: { id: string; nome: string }, tarefaId: string): Promise<Resultado> {
  const t = await podePuxar(eu.id, tarefaId);
  if (!t) return { ok: false, status: 404, erro: "Você não estava nesta reunião." };
  if (FECHADAS.includes(t.status)) return { ok: false, status: 409, erro: "Essa ação já foi fechada." };
  if (t.responsavel_id === eu.id) return { ok: true };
  if (t.responsavel_id) return { ok: false, status: 409, erro: "Essa ação já está com outra pessoa." };

  const mudou = await withTenant(t.dono_id, async (c) => {
    const antes = (
      await c.query<{ owner: string; acao: string }>(
        `SELECT owner, acao FROM tarefas WHERE id = $1 AND responsavel_user_id IS NULL FOR UPDATE`,
        [tarefaId],
      )
    ).rows[0];
    if (!antes) return false;
    await c.query(
      `UPDATE tarefas SET owner = $2, acao = 'cobrar', responsavel_user_id = $3 WHERE id = $1`,
      [tarefaId, eu.nome, eu.id],
    );
    await ajustarPrincipal(c, tarefaId, t.dono_id, "cobrar", eu.nome);
    await registrarEvento(
      c,
      tarefaId,
      "editada",
      { origem: "puxada", changed: { owner: { de: antes.owner, para: eu.nome }, acao: { de: antes.acao, para: "cobrar" } } },
      eu.id,
    );
    return true;
  });
  return mudou ? { ok: true } : { ok: false, status: 409, erro: "Essa ação já está com outra pessoa." };
}

/** Devolve a ação puxada: volta a quem fazia antes de puxar (ou a quem criou). Basta a ação
 *  estar com a pessoa: vale mesmo se quem marcou depois fechou a reunião ("Só eu"). */
export async function devolverAcao(eu: { id: string; nome: string }, tarefaId: string): Promise<Resultado> {
  const acesso = UUID_RE.test(tarefaId) ? await acessoTarefa(eu.id, tarefaId) : null;
  if (!acesso || acesso.papel !== "responsavel") return { ok: false, status: 404, erro: "Essa ação não está com você." };
  const t = { dono_id: acesso.donoId };

  await withTenant(t.dono_id, async (c) => {
    const puxada = (
      await c.query<{ payload: { changed?: { owner?: { de?: string }; acao?: { de?: string } } } }>(
        `SELECT payload FROM tarefa_eventos
          WHERE tarefa_id = $1 AND evento = 'editada' AND ator_user_id = $2 AND payload->>'origem' = 'puxada'
          ORDER BY created_at DESC LIMIT 1`,
        [tarefaId, eu.id],
      )
    ).rows[0]?.payload;
    const owner = puxada?.changed?.owner?.de || getOwnerSlug();
    const acaoAntes = puxada?.changed?.acao?.de;
    const acao = owner === getOwnerSlug() ? "executar" : acaoAntes === "aguardar" ? "aguardar" : "cobrar";
    await c.query(
      `UPDATE tarefas SET owner = $2, acao = $3, responsavel_user_id = NULL WHERE id = $1 AND responsavel_user_id = $4`,
      [tarefaId, owner, acao, eu.id],
    );
    await ajustarPrincipal(c, tarefaId, t.dono_id, acao, owner);
    await registrarEvento(
      c,
      tarefaId,
      "editada",
      { origem: "devolvida", changed: { owner: { de: eu.nome, para: owner } } },
      eu.id,
    );
  });
  return { ok: true };
}

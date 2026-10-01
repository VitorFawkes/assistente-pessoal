// Central do Marketing (01/10/2026, pedido do Vitor: "um hub para as meninas do marketing… é lá que
// pedidos pro marketing devem aparecer"): os pedidos que chegaram ao marketing, para quem é do marketing
// ou administrador (pedido_posso_mexer). Cada pedido vem como as outras listas do TTARS mostram.
import { query, withTenant } from "./db";
import { carregarTarefas } from "./equipe-compartilhado";
import { paraTela } from "./ttars-tela";

const QUANTOS = 300;

export async function souDoMarketing(userId: string): Promise<boolean> {
  const r = await withTenant(userId, (c) =>
    c.query<{ ok: boolean }>(`SELECT pedido_posso_mexer() AS ok`),
  );
  return r.rows[0]?.ok === true;
}

/** Os pedidos mais novos primeiro, os cancelados por último (o dono de cada ação é quem pediu). */
export async function pedidosDaCentral(userId: string) {
  const linhas = await query<{ tarefa_id: string; dono_id: string }>(
    `SELECT tarefa_id::text AS tarefa_id, pedido_por::text AS dono_id
       FROM tarefa_pedidos
      ORDER BY cancelado, criado_em DESC
      LIMIT ${QUANTOS}`,
  );
  if (!linhas.length) return [];
  const ordem = new Map(linhas.map((l, i) => [l.tarefa_id, i]));
  const tarefas = await carregarTarefas(userId, linhas, { donoNome: true });
  tarefas.sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
  return paraTela(userId, tarefas);
}

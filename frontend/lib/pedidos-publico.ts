// Quem pode pedir e que time pode acompanhar um pedido (Pedidos ao Marketing, 30/09/2026), pela lista de
// pessoas do TTARS que o Ações guarda (ttars_pessoas: empresas e times de cada um).
import { query } from "./db";
import { pessoasDaEquipe } from "./equipe-compartilhado";
import { podeTime, timeIdValido, timesDasPessoas } from "./hub";
import { mexeNoPedido, pedidosDasTarefas } from "./pedidos-trava";
import { estaNoPublico, timeNoPublico, type PessoaDoPublico, type Publico } from "./pedidos-tipos";

/** A pessoa na lista do TTARS (null = não está, ex.: conta de teste do Ações). */
export async function pessoaDoPublico(email: string | null | undefined): Promise<PessoaDoPublico | null> {
  if (!email) return null;
  const r = await query<PessoaDoPublico>(`SELECT organizacao, times FROM ttars_pessoas WHERE email = LOWER($1)`, [email]);
  return r[0] ?? null;
}

export async function euNoPublico(email: string | null | undefined, publico: Publico): Promise<boolean> {
  return estaNoPublico(await pessoaDoPublico(email), publico);
}

/** Os times do TTARS que podem acompanhar pedidos deste público. */
export async function timesDoPublico(publico: Publico): Promise<{ id: string; nome: string; empresa: string | null }[]> {
  const todos = timesDasPessoas(await pessoasDaEquipe());
  return [...todos.values()]
    .filter((t) => timeNoPublico(t, publico))
    .map((t) => ({ id: t.id, nome: t.nome, empresa: t.organizacao }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function timeValeNoPublico(publico: Publico, timeId: string): Promise<boolean> {
  if (!timeIdValido(timeId)) return false;
  return (await timesDoPublico(publico)).some((t) => t.id === timeId);
}

/**
 * Exceção à regra "só um time seu" (equipe_pode_time), só para ação que nasceu de pedido: qualquer time
 * das empresas do público do formulário pode acompanhar, mesmo que quem pediu não seja dele.
 */
export async function timeValeNoPedido(tarefaId: string, timeId: string): Promise<boolean> {
  const r = await query<{ publico: Publico }>(
    `SELECT f.publico FROM tarefa_pedidos tp JOIN pedido_formularios f ON f.id = tp.formulario_id WHERE tp.tarefa_id = $1`,
    [tarefaId],
  ).catch((e: unknown) => {
    if ((e as { code?: string })?.code === "42P01") return [] as { publico: Publico }[];
    throw e;
  });
  return !!r[0] && (await timeValeNoPublico(r[0].publico, timeId));
}

/**
 * O time que pode ficar numa ação. Fora de pedido: um time de quem muda (equipe_pode_time). Num pedido, para
 * quem não é do marketing: só um time das empresas do público do formulário, a mesma regra do envio (trocar o
 * time muda quem vê o pedido).
 */
export async function timeValeNaTarefa(userId: string, tarefaId: string, timeId: string): Promise<boolean> {
  if (!timeIdValido(timeId)) return false;
  if ((await pedidosDasTarefas([tarefaId])).size && !(await mexeNoPedido(userId))) return timeValeNoPedido(tarefaId, timeId);
  return (await podeTime(userId, timeId)) || (await timeValeNoPedido(tarefaId, timeId));
}

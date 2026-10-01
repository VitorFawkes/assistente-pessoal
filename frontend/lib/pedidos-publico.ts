// Quem pode pedir e que time pode acompanhar um pedido (Pedidos ao Marketing, 30/09/2026), pela lista de
// pessoas do TTARS que o Ações guarda (ttars_pessoas: empresas e times de cada um).
import { query } from "./db";
import { pessoasDaEquipe } from "./equipe-compartilhado";
import { podeTime, timeIdValido, timesDasPessoas } from "./hub";
import { mexeNoPedido, pedidosDasTarefas } from "./pedidos-trava";
import { ehErro, estaNoPublico, limparPublico, timeNoPublico, type PessoaDoPublico, type Publico } from "./pedidos-tipos";

/** A pessoa pelo e-mail, com a empresa e os times da lista do TTARS (fora da lista: só o e-mail, que vale
 *  quando ela foi escolhida pelo nome no público). */
export async function pessoaDoPublico(email: string | null | undefined): Promise<PessoaDoPublico | null> {
  const alvo = (email ?? "").trim().toLowerCase();
  if (!alvo) return null;
  const r = await query<PessoaDoPublico>(`SELECT email, organizacao, times FROM ttars_pessoas WHERE email = $1`, [alvo]);
  return r[0] ?? { email: alvo, organizacao: null, times: null };
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
  const r = await query<{ publico: unknown }>(
    `SELECT f.publico FROM tarefa_pedidos tp JOIN pedido_formularios f ON f.id = tp.formulario_id WHERE tp.tarefa_id = $1`,
    [tarefaId],
  ).catch((e: unknown) => {
    if ((e as { code?: string })?.code === "42P01") return [] as { publico: unknown }[];
    throw e;
  });
  // Guardado no formato antigo ("empresas"/"times") ou no combinado: lido sempre do mesmo jeito.
  const publico = r[0] ? limparPublico(r[0].publico) : null;
  return !!publico && !ehErro(publico) && (await timeValeNoPublico(publico, timeId));
}

export const NAO_ESTA_NO_TIME = "Você não está nesse time.";
export const TIME_FORA_DO_PUBLICO = "Esse time não pode acompanhar pedidos deste formulário.";

/**
 * O time que pode ficar numa ação (null = pode; senão, o motivo da recusa). Fora de pedido: um time de quem
 * muda (equipe_pode_time). Num pedido, para quem não é do marketing: só um time das empresas do público do
 * formulário, a mesma regra do envio (trocar o time muda quem vê o pedido).
 */
export async function recusaDoTimeNaTarefa(userId: string, tarefaId: string, timeId: string): Promise<string | null> {
  if (!timeIdValido(timeId)) return NAO_ESTA_NO_TIME;
  if ((await pedidosDasTarefas([tarefaId])).size && !(await mexeNoPedido(userId))) {
    return (await timeValeNoPedido(tarefaId, timeId)) ? null : TIME_FORA_DO_PUBLICO;
  }
  return (await podeTime(userId, timeId)) || (await timeValeNoPedido(tarefaId, timeId)) ? null : NAO_ESTA_NO_TIME;
}

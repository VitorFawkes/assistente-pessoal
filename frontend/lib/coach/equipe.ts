// O Coach no Ações da equipe (TTARS). A pessoa vê, além das tarefas dela, as que colegas passaram para ela e as
// marcadas para ela (como em "Minhas ações"), cada uma do ponto de vista dela. Mudar e criar passam pela mesma
// regra da tela (lib/tarefa-mudar, lib/nova-acao). Fora da equipe nada muda.
import { getUserById, type User } from "../auth";
import { listarProjetos } from "../projetos";
import { projetosDasTarefas, tarefasMarcadasParaMim, tarefasParaMim } from "../equipe-compartilhado";
import type { Tarefa } from "../queries";
import { isTeamMode } from "../team-mode";

export type TarefaDeOutro = Tarefa & { projetos_ids: string[] };

/** Tarefas de colegas que a pessoa enxerga em "Minhas ações", do ponto de vista dela (o dono é `user_id`). */
export async function tarefasDeOutros(userId: string): Promise<TarefaDeOutro[]> {
 if (!isTeamMode()) return [];
 const [paraMim, marcadas] = await Promise.all([tarefasParaMim(userId), tarefasMarcadasParaMim(userId)]);
 const unicas = [...new Map([...paraMim, ...marcadas].filter(t => t.user_id !== userId).map(t => [t.id, t])).values()];
 if (!unicas.length) return [];
 const projetos = await projetosDasTarefas(userId, unicas.map(t => t.id));
 return unicas.map(t => ({ ...t, projetos_ids: (projetos.get(t.id) ?? []).map(p => p.id) }));
}

/** Projetos que a pessoa vê (os dela e os em que foi chamada), para os pedidos "as do projeto X". */
export async function projetosDoCoach(userId: string): Promise<{ id: string; nome: string }[] | null> {
 if (!isTeamMode()) return null;
 return (await listarProjetos(userId)).map(p => ({ id: p.id, nome: p.nome }));
}

export async function usuarioDoCoach(userId: string): Promise<User> {
 const u = await getUserById(userId);
 if (!u) throw new Error("coach_user_missing");
 return u;
}

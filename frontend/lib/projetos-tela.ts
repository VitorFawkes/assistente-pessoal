// Projetos como as telas do Ações dentro do TTARS usam: com os números (abertas, feitas,
// vencidas, o prazo mais próximo), o time e o objetivo — tudo do ponto de vista de quem vê.
import { listarProjetos } from "./projetos";
import { nomesDosObjetivos, nomesDosTimes, resumoDosProjetos } from "./hub";
import { projetosDoNotion, type ProjetoDoNotion } from "./notion-sync";

export type ProjetoNaTela = {
  id: string;
  nome: string;
  descricao: string | null;
  n_tarefas: number;
  pessoas: { user_id: string; nome: string; e_dono: boolean }[];
  sou_dono: boolean;
  abertas: number;
  feitas: number;
  vencidas: number;
  proximo_prazo: string | null;
  time_id: string | null;
  time_nome: string | null;
  objetivo: { id: string; nome: string } | null;
  /** Projeto que espelha o Notion do marketing (a tela junta todos no grupo "Marketing"). */
  notion: ProjetoDoNotion | null;
};

/** Os projetos de quem pede (só `ids`, se vier). */
export async function projetosParaTela(userId: string, ids?: string[]): Promise<ProjetoNaTela[]> {
  const todos = await listarProjetos(userId);
  const projetos = ids ? todos.filter((p) => ids.includes(p.id)) : todos;
  if (!projetos.length) return [];
  const [resumo, objetivos, times, doNotion] = await Promise.all([
    resumoDosProjetos(userId, projetos.map((p) => p.id)),
    nomesDosObjetivos(userId, projetos.map((p) => p.objetivo_id ?? "").filter(Boolean)),
    projetos.some((p) => p.time_id) ? nomesDosTimes() : Promise.resolve(new Map<string, string>()),
    projetosDoNotion(),
  ]);
  return projetos.map((p) => {
    const r = resumo.get(p.id);
    const objetivoNome = p.objetivo_id ? objetivos.get(p.objetivo_id) : undefined;
    return {
      id: p.id,
      nome: p.nome,
      descricao: p.descricao ?? null,
      n_tarefas: p.n_tarefas,
      pessoas: p.pessoas,
      sou_dono: p.sou_dono,
      abertas: r?.abertas ?? 0,
      feitas: r?.feitas ?? 0,
      vencidas: r?.vencidas ?? 0,
      proximo_prazo: r?.proximo_prazo ?? null,
      time_id: p.time_id ?? null,
      time_nome: p.time_id ? (times.get(p.time_id) ?? null) : null,
      objetivo: p.objetivo_id && objetivoNome ? { id: p.objetivo_id, nome: objetivoNome } : null,
      notion: doNotion.get(p.id) ?? null,
    };
  });
}

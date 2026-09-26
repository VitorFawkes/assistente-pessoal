// A tarefa como as telas do Ações dentro do TTARS usam: do ponto de vista de quem vê, com
// projetos, nome curto da reunião, Notion e (no painel) o histórico de quem mudou o quê.
import { withTenant } from "./db";
import { meetingSubject } from "./meeting-label";
import { notionDasAcoes } from "./notion-sync";
import type { Tarefa } from "./queries";
import { acessoTarefa, carregarTarefas, comProjetos, nomesDeUsuarios, type Papel } from "./equipe-compartilhado";

export async function paraTela(userId: string, tarefas: Tarefa[]) {
  const [comP, notion] = await Promise.all([comProjetos(userId, tarefas), notionDasAcoes(tarefas.map((t) => t.id))]);
  return comP.map((t) => ({
    ...t,
    reuniao_rotulo: t.meeting_id ? meetingSubject(t.meeting_summary, t.meeting_nome) || "Reunião" : null,
    notion: notion.get(t.id) ?? null,
  }));
}

export type TarefaNaTela = Awaited<ReturnType<typeof paraTela>>[number];

/** Uma tarefa que `userId` pode ver (dele, passada a ele ou de projeto dele). null = não pode. */
export async function tarefaNaTela(userId: string, id: string): Promise<{ tarefa: TarefaNaTela; papel: Papel; donoId: string } | null> {
  const acesso = await acessoTarefa(userId, id);
  if (!acesso) return null;
  const [t] = await carregarTarefas(userId, [{ tarefa_id: id, dono_id: acesso.donoId }], { donoNome: true });
  if (!t) return null;
  const [tarefa] = await paraTela(userId, [t]);
  return { tarefa, papel: acesso.papel, donoId: acesso.donoId };
}

const CAMPO: Record<string, string> = {
  titulo: "o título",
  descricao: "a descrição",
  owner: "quem faz",
  acao: "quem faz",
  prazo: "o prazo",
  prazo_text: "o prazo",
  prioridade: "a prioridade",
  area_raw: "a área",
  status: "a situação",
};

function juntar(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}

/** O que o evento diz, em português. Só nomes de campo: o de→para fica com quem criou. */
export function textoDoEvento(evento: string, payload: Record<string, unknown> | null): string | null {
  switch (evento) {
    case "criada":
      return payload?.origem === "agente" ? "criou pelo Assistente" : "criou";
    case "concluida":
      return "concluiu";
    case "cancelada":
      return "cancelou";
    case "reaberta":
      return "reabriu";
    case "prazo_alterado":
      return "mudou o prazo";
    case "editada": {
      const changed = payload && typeof payload.changed === "object" && payload.changed ? Object.keys(payload.changed) : [];
      const campos = [...new Set(changed.map((k) => CAMPO[k]).filter(Boolean))];
      return campos.length ? `mudou ${juntar(campos)}` : "editou";
    }
    default:
      return null;
  }
}

export type ItemDoHistorico = { quando: string; quem: string; texto: string };

export async function historicoDaTarefa(donoId: string, tarefaId: string, viewerId: string): Promise<ItemDoHistorico[]> {
  const r = await withTenant(donoId, (c) =>
    c.query<{ evento: string; payload: Record<string, unknown> | null; ator: string | null; quando: string }>(
      `SELECT evento, payload, COALESCE(ator_user_id, $2::uuid)::text AS ator,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS quando
         FROM tarefa_eventos WHERE tarefa_id = $1
        ORDER BY created_at DESC LIMIT 30`,
      [tarefaId, donoId],
    ),
  );
  const nomes = await nomesDeUsuarios(r.rows.map((x) => x.ator));
  const itens: ItemDoHistorico[] = [];
  for (const e of r.rows) {
    const texto = textoDoEvento(e.evento, e.payload);
    if (!texto) continue;
    const quem = e.ator === viewerId ? "Você" : (e.ator && nomes.get(e.ator)) || "Alguém";
    itens.push({ quando: e.quando, quem, texto });
  }
  return itens;
}

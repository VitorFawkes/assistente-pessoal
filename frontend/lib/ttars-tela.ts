// A tarefa como as telas do Ações dentro do TTARS usam: do ponto de vista de quem vê, com
// projetos, nome curto da reunião, Notion e (no painel) o histórico de quem mudou o quê.
import { withTenant } from "./db";
import { meetingSubject } from "./meeting-label";
import { notionDasAcoes } from "./notion-sync";
import type { Tarefa } from "./queries";
import { acessoTarefa, carregarTarefas, comProjetos, nomesDeUsuarios, type Papel } from "./equipe-compartilhado";
import { nomesDosObjetivos, nomesDosTimes, origemDaReuniao, UUID_RE } from "./hub";

export async function paraTela(userId: string, tarefas: Tarefa[]) {
  const comTime = tarefas.some((t) => t.time_id);
  const [comP, notion, objetivos, times] = await Promise.all([
    comProjetos(userId, tarefas),
    notionDasAcoes(tarefas.map((t) => t.id)),
    nomesDosObjetivos(userId, tarefas.map((t) => t.objetivo_id ?? "").filter(Boolean)),
    comTime ? nomesDosTimes() : Promise.resolve(new Map<string, string>()),
  ]);
  return comP.map((t) => {
    const objetivoNome = t.objetivo_id ? objetivos.get(t.objetivo_id) : undefined;
    return {
      ...t,
      reuniao_rotulo: t.meeting_id ? meetingSubject(t.meeting_summary, t.meeting_nome) || "Reunião" : null,
      meeting_origem: t.meeting_id ? origemDaReuniao(t.meeting_source) : null,
      time_nome: t.time_id ? (times.get(t.time_id) ?? null) : null,
      // Objetivo que quem vê não enxerga não aparece (nem o id).
      objetivo: t.objetivo_id && objetivoNome ? { id: t.objetivo_id, nome: objetivoNome } : null,
      objetivo_id: t.objetivo_id && objetivoNome ? t.objetivo_id : null,
      objetivo_escondido: !!t.objetivo_id && !objetivoNome,
      // Quem recebe não vê a reunião, mas sabe que a ação saiu de uma (e não que foi criada à mão).
      de_reuniao: t.de_reuniao ?? !!t.meeting_id,
      notion: notion.get(t.id) ?? null,
    };
  });
}

export type TarefaNaTela = Awaited<ReturnType<typeof paraTela>>[number];

/** Uma tarefa que `userId` pode ver (dele, passada a ele, de projeto ou do time dele). null = não pode. */
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
  time_id: "o time",
  objetivo_id: "o objetivo",
  quem_ve: "quem vê",
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

// ── Comentários (pedido do Vitor, 28/09/2026) ─────────────────────────────────────────
// Tabela tarefa_comentarios (db/equipe/014), no tenant do dono da tarefa. Quem vê a ação
// comenta; só quem escreveu apaga. Não avisa ninguém (regra do dono: não dispara nada).

export type ComentarioDaTarefa = { id: string; quem: string; quando: string; texto: string; meu: boolean };

export const TEXTO_MAX_DO_COMENTARIO = 4000;

export async function comentariosDaTarefa(donoId: string, tarefaId: string, viewerId: string): Promise<ComentarioDaTarefa[]> {
  // Sem a tabela (servidor publicado antes da 014), o painel da ação continua abrindo, só sem comentários.
  const r = await withTenant(donoId, (c) =>
    c.query<{ id: string; texto: string | null; ator: string | null; quando: string }>(
      `SELECT id::text AS id, texto, autor_user_id::text AS ator,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS quando
         FROM (SELECT * FROM tarefa_comentarios WHERE tarefa_id = $1
                ORDER BY created_at DESC LIMIT 200) ultimos
        ORDER BY created_at ASC`,
      [tarefaId],
    ),
  ).catch((e: unknown) => {
    if (semTabela(e)) return { rows: [] as { id: string; texto: string | null; ator: string | null; quando: string }[] };
    throw e;
  });
  const nomes = await nomesDeUsuarios(r.rows.map((x) => x.ator));
  return r.rows
    .filter((x) => x.texto)
    .map((x) => ({
      id: x.id,
      quem: x.ator === viewerId ? "Você" : (x.ator && nomes.get(x.ator)) || "Alguém",
      quando: x.quando,
      texto: x.texto!,
      meu: !!x.ator && x.ator === viewerId,
    }));
}

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; erro: string };

const NAO_ACHOU = { ok: false, status: 404, erro: "Essa ação não existe mais ou não está com você." } as const;

// A tabela chega pela db/equipe/014, aplicada à parte: até lá o painel abre sem comentários e comentar avisa.
const SEM_COMENTARIOS = { ok: false, status: 503, erro: "Os comentários ainda estão sendo ligados. Tente de novo mais tarde." } as const;
const semTabela = (e: unknown) => (e as { code?: string })?.code === "42P01";

export async function comentarNaTarefa(userId: string, tarefaId: string, bruto: unknown): Promise<Resultado<ComentarioDaTarefa>> {
  // O banco recusa o caractere nulo (viraria erro 500 em vez de 400).
  const texto = typeof bruto === "string" ? bruto.replace(/\u0000/g, "").trim() : "";
  if (!texto) return { ok: false, status: 400, erro: "Escreva o comentário." };
  if (texto.length > TEXTO_MAX_DO_COMENTARIO) return { ok: false, status: 400, erro: `O comentário passa de ${TEXTO_MAX_DO_COMENTARIO} letras.` };
  const acesso = UUID_RE.test(tarefaId) ? await acessoTarefa(userId, tarefaId) : null;
  if (!acesso) return NAO_ACHOU;
  const r = await withTenant(acesso.donoId, (c) =>
    c.query<{ id: string; quando: string }>(
      `INSERT INTO tarefa_comentarios (tarefa_id, texto, autor_user_id) VALUES ($1, $2, $3)
       RETURNING id::text AS id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS quando`,
      [tarefaId, texto, userId],
    ),
  ).catch((e: unknown) => {
    if (semTabela(e)) return null;
    throw e;
  });
  if (!r) return SEM_COMENTARIOS;
  const linha = r.rows[0];
  if (!linha) return NAO_ACHOU;
  return { ok: true, valor: { id: linha.id, quem: "Você", quando: linha.quando, texto, meu: true } };
}

export async function apagarComentarioDaTarefa(userId: string, tarefaId: string, comentarioId: string): Promise<Resultado<null>> {
  const acesso = UUID_RE.test(tarefaId) && UUID_RE.test(comentarioId) ? await acessoTarefa(userId, tarefaId) : null;
  if (!acesso) return NAO_ACHOU;
  return withTenant(acesso.donoId, async (c): Promise<Resultado<null>> => {
    const achado = await c.query<{ ator: string | null }>(
      `SELECT autor_user_id::text AS ator FROM tarefa_comentarios WHERE id = $1 AND tarefa_id = $2`,
      [comentarioId, tarefaId],
    );
    const ator = achado.rows[0];
    if (!ator) return { ok: false, status: 404, erro: "Esse comentário já foi apagado." } as const;
    if (ator.ator !== userId) return { ok: false, status: 403, erro: "Só quem escreveu apaga o comentário." } as const;
    await c.query(`DELETE FROM tarefa_comentarios WHERE id = $1 AND tarefa_id = $2 AND autor_user_id = $3`, [comentarioId, tarefaId, userId]);
    return { ok: true, valor: null } as const;
  }).catch((e: unknown) => {
    if (semTabela(e)) return SEM_COMENTARIOS;
    throw e;
  });
}

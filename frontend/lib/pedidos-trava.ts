// A trava dos Pedidos ao Marketing (30/09/2026): numa ação que nasceu de um pedido, quem não é do
// marketing (quem monta os pedidos ou está nos projetos do Notion do marketing) nem administrador só
// comenta, mexe no próprio Quem vê e anexa. Situação, prazo, título, quem faz, área, prioridade e projeto são
// do marketing; o time, quem pediu troca, mas só por um das empresas do público do formulário. Cancelar ou apagar: quem pediu, só enquanto o marketing não começou (página do Notion em
// "Not started" ou ainda não criada).
//
// UM ponto só: toda rota que muda, cancela ou apaga ação chama travaDoPedido antes de gravar
// (PATCH/DELETE de uma ação, em massa, Coach, Assistente, link de convidado, situação e área do Notion,
// puxar/devolver, também fazem). A rodada do Notion não passa por aqui: é o marketing mudando lá.
import { query, withTenant } from "./db";

export const SO_O_MARKETING = "Só o marketing muda este pedido";
export const JA_COMECOU = "O marketing já começou: fale pelos comentários";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que só o marketing muda num pedido (os nomes que as rotas usam). */
const CAMPOS_DO_MARKETING = new Set([
  "titulo",
  "descricao",
  "owner",
  "acao",
  "prazo",
  "inicio",
  "prazo_text",
  "prioridade",
  "status",
  "pessoas",
  "responsavel_user_id",
  "responsavel_email",
  "quem_nome_fora",
  "depende_de",
  "area",
  "quem_faz",
  "tambem_fazem",
  // Pôr ou tirar de projeto (o projeto do pedido é o do Notion do marketing).
  "projeto",
]);

export type PedidoDaTarefa = { tarefa_id: string; pedido_por: string; tem_pagina: boolean; status_notion: string | null };

// Servidor publicado antes da 020: nenhuma ação é pedido.
const semTabela = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** As ações (dentre `ids`) que são pedido ao marketing, com a situação da página no Notion. */
export async function pedidosDasTarefas(ids: string[]): Promise<Map<string, PedidoDaTarefa>> {
  const validos = [...new Set(ids.filter((x) => typeof x === "string" && UUID_RE.test(x)))];
  if (!validos.length) return new Map();
  const r = await query<PedidoDaTarefa>(
    `SELECT tp.tarefa_id::text AS tarefa_id, tp.pedido_por::text AS pedido_por,
            (np.page_id IS NOT NULL) AS tem_pagina, np.status_notion
       FROM tarefa_pedidos tp
       LEFT JOIN notion_paginas np ON np.tarefa_id = tp.tarefa_id
      WHERE tp.tarefa_id = ANY($1::uuid[])`,
    [validos],
  ).catch((e: unknown) => {
    if (semTabela(e)) return [] as PedidoDaTarefa[];
    throw e;
  });
  return new Map(r.map((x) => [x.tarefa_id, x]));
}

/** É do marketing (ou administrador): mexe no pedido como em qualquer ação. */
export async function mexeNoPedido(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !UUID_RE.test(userId)) return false;
  const r = await withTenant(userId, (c) => c.query<{ ok: boolean }>(`SELECT pedido_posso_mexer() AS ok`));
  return r.rows[0]?.ok === true;
}

/** O marketing ainda não começou: a página do Notion não existe ou está em "Not started". */
export const marketingNaoComecou = (p: Pick<PedidoDaTarefa, "tem_pagina" | "status_notion">) =>
  !p.tem_pagina || (p.status_notion ?? "Not started").trim().toLowerCase() === "not started";

export type Mexida = {
  /** Campos que mudam (nomes das rotas; "status" de cancelar vai em `cancelar`). */
  campos?: string[];
  cancelar?: boolean;
  apagar?: boolean;
};

/** Traduz um pedido de mudança (corpo das rotas) no que a trava olha. */
export function mexidaDoCorpo(corpo: Record<string, unknown> | null | undefined): Mexida {
  const campos = Object.entries(corpo ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  const cancelar = corpo?.status === "cancelada";
  return { campos: cancelar ? campos.filter((k) => k !== "status") : campos, cancelar };
}

export type Recusa = { status: 403; erro: string };

/**
 * null = pode. `atorId` null = quem entra por link de convidado (nunca é do marketing).
 * Várias ações de uma vez (em massa): basta uma travada para recusar tudo.
 */
export async function travaDoPedido(atorId: string | null, tarefaIds: string[], m: Mexida): Promise<Recusa | null> {
  const pedidos = await pedidosDasTarefas(tarefaIds);
  if (!pedidos.size) return null;
  const protegidos = (m.campos ?? []).filter((k) => CAMPOS_DO_MARKETING.has(k));
  if (!protegidos.length && !m.cancelar && !m.apagar) return null;
  if (await mexeNoPedido(atorId)) return null;
  if (protegidos.length) return { status: 403, erro: SO_O_MARKETING };
  for (const p of pedidos.values()) {
    if (!atorId || p.pedido_por !== atorId) return { status: 403, erro: SO_O_MARKETING };
    if (!marketingNaoComecou(p)) return { status: 403, erro: JA_COMECOU };
  }
  return null;
}

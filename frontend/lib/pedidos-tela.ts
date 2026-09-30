// O pedido de cada ação como as telas do TTARS mostram (Pedidos ao Marketing, 30/09/2026): de que
// formulário veio, as respostas (com as perguntas da versão em que foi pedido) e o que quem vê pode fazer.
import { query } from "./db";
import { marketingNaoComecou, mexeNoPedido } from "./pedidos-trava";
import { casalDoPedido, rotuloDaPergunta, textoDaResposta, type PedidoDaAcao, type Pergunta, type Resposta } from "./pedidos-tipos";

type Linha = {
  tarefa_id: string;
  formulario_id: string;
  formulario_nome: string;
  versao: number;
  perguntas_snapshot: Pergunta[];
  respostas: Record<string, Resposta>;
  card_id: string | null;
  card_titulo: string | null;
  pedido_por: string;
  tem_pagina: boolean;
  status_notion: string | null;
};

/** `tarefas` = as ações que a tela vai mostrar (com a situação de cada uma). */
export async function pedidosParaTela(
  viewerId: string,
  tarefas: { id: string; status: string }[],
): Promise<Map<string, PedidoDaAcao>> {
  const out = new Map<string, PedidoDaAcao>();
  if (!tarefas.length) return out;
  const linhas = await query<Linha>(
    `SELECT tp.tarefa_id::text AS tarefa_id, tp.formulario_id::text AS formulario_id, f.nome AS formulario_nome, tp.versao,
            tp.perguntas_snapshot, tp.respostas, tp.card_id::text AS card_id, tp.card_titulo, tp.pedido_por::text AS pedido_por,
            (np.page_id IS NOT NULL) AS tem_pagina, np.status_notion
       FROM tarefa_pedidos tp
       JOIN pedido_formularios f ON f.id = tp.formulario_id
       LEFT JOIN notion_paginas np ON np.tarefa_id = tp.tarefa_id
      WHERE tp.tarefa_id = ANY($1::uuid[])`,
    [tarefas.map((t) => t.id)],
  ).catch((e: unknown) => {
    if ((e as { code?: string })?.code === "42P01") return [] as Linha[];
    throw e;
  });
  if (!linhas.length) return out;
  const doMarketing = await mexeNoPedido(viewerId);
  const status = new Map(tarefas.map((t) => [t.id, t.status]));
  for (const l of linhas) {
    const perguntas = Array.isArray(l.perguntas_snapshot) ? l.perguntas_snapshot : [];
    const aberta = status.get(l.tarefa_id) !== "cancelada";
    const respostas = l.respostas ?? {};
    const casal = casalDoPedido(perguntas, respostas, l.card_titulo);
    out.set(l.tarefa_id, {
      formulario_id: l.formulario_id,
      formulario_nome: l.formulario_nome,
      versao: l.versao,
      card_id: l.card_id,
      card_titulo: l.card_titulo,
      respostas: perguntas.map((p) => ({ rotulo: rotuloDaPergunta(p, casal), texto: textoDaResposta(p, respostas[p.id]) })),
      somente_leitura: !doMarketing,
      pode_cancelar: aberta && (doMarketing || (l.pedido_por === viewerId && marketingNaoComecou(l))),
    });
  }
  return out;
}

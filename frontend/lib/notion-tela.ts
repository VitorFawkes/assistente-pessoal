// O que as telas do Ações no TTARS pedem ao Notion do marketing além da rodada de cada minuto
// (29/09/2026, "visualização igual à do Notion"): mudar a situação pelo NOME de lá (o quadro com
// as 8 colunas; This Week, Daily e To Day são todas "fazendo" no Ações) e ler o texto escrito
// dentro da página (10 das 126 tarefas têm), só para mostrar.
import { query } from "./db";
import { blocosDaPagina, lerFonte, mudarPagina, type BlocoDoNotion } from "./notion-api";
import { PROPS, statusDoNotion, type StatusAcoes } from "./notion-mapa";
import { conexaoAtiva } from "./notion-sync";

export type BlocoNaTela = {
  tipo: "paragrafo" | "titulo" | "item" | "numerado" | "marcar" | "citacao" | "destaque" | "codigo" | "divisor";
  texto: string;
  /** Só em "marcar" (a caixinha de lá). */
  marcado?: boolean;
  /** 0 = na página; 1 = dentro de um item. */
  nivel: number;
};

const TIPOS: Record<string, BlocoNaTela["tipo"]> = {
  paragraph: "paragrafo",
  heading_1: "titulo",
  heading_2: "titulo",
  heading_3: "titulo",
  bulleted_list_item: "item",
  numbered_list_item: "numerado",
  to_do: "marcar",
  toggle: "item",
  quote: "citacao",
  callout: "destaque",
  code: "codigo",
  divider: "divisor",
};

/** Um bloco do Notion como a tela mostra (null = tipo que a tela não mostra ou parágrafo vazio). */
export function blocoNaTela(b: BlocoDoNotion, nivel: number): BlocoNaTela | null {
  const tipo = TIPOS[b.type];
  if (!tipo) return null;
  if (tipo === "divisor") return { tipo, texto: "", nivel };
  const dados = (b[b.type] ?? {}) as { rich_text?: { plain_text?: string }[]; checked?: boolean };
  const texto = (dados.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
  if (!texto) return null;
  return tipo === "marcar" ? { tipo, texto, marcado: !!dados.checked, nivel } : { tipo, texto, nivel };
}

async function paginaDaAcao(tarefaId: string) {
  const c = await conexaoAtiva();
  if (!c) return null;
  const r = await query<{ page_id: string; url: string | null }>(
    `SELECT page_id, url FROM notion_paginas WHERE tarefa_id = $1 AND conexao_id = $2`,
    [tarefaId, c.id],
  );
  return r[0] ? { conexao: c, pageId: r[0].page_id, url: r[0].url } : null;
}

/** O texto de dentro da página no Notion (até 200 blocos; um nível dentro dos itens). */
export async function textoDaPaginaNoNotion(tarefaId: string): Promise<{ url: string | null; blocos: BlocoNaTela[] } | null> {
  const p = await paginaDaAcao(tarefaId);
  if (!p) return null;
  const blocos: BlocoNaTela[] = [];
  for (const b of await blocosDaPagina(p.conexao.token, p.pageId)) {
    const visto = blocoNaTela(b, 0);
    if (visto) blocos.push(visto);
    if (b.has_children && b.type !== "child_page" && b.type !== "child_database" && blocos.length < 200) {
      for (const f of await blocosDaPagina(p.conexao.token, b.id, 50)) {
        const filho = blocoNaTela(f, 1);
        if (filho) blocos.push(filho);
      }
    }
  }
  return { url: p.url, blocos: blocos.slice(0, 200) };
}

/**
 * Grava a situação pelo nome exato no Notion e guarda como a última vista dos dois lados: a
 * rodada seguinte não troca "To Day" pelo nome padrão de "fazendo" (This Week). Quem chama muda a
 * situação da ação no Ações ANTES (a rodada que cair no meio leva o nome padrão, que este
 * pedido sobrescreve logo depois).
 */
export async function gravarSituacaoNoNotion(tarefaId: string, nome: string): Promise<StatusAcoes | null> {
  const p = await paginaDaAcao(tarefaId);
  if (!p) return null;
  const pg = await mudarPagina(p.conexao.token, p.pageId, { properties: { [PROPS.status]: { status: { name: nome } } } });
  const status = statusDoNotion(nome);
  await query(
    `UPDATE notion_paginas
        SET status_notion = $2,
            ultimos = jsonb_set(ultimos, '{status}', to_jsonb($3::text)),
            editado_notion = COALESCE($4, editado_notion)
      WHERE page_id = $1`,
    [p.pageId, nome, status, pg?.last_edited_time ?? null],
  );
  return status;
}

let situacoesGuardadas: { em: number; nomes: string[] } | null = null;

/** As situações que existem hoje na coluna Status do Notion (guardadas por 5 minutos). */
export async function situacoesDoNotion(): Promise<string[]> {
  if (situacoesGuardadas && Date.now() - situacoesGuardadas.em < 5 * 60_000) return situacoesGuardadas.nomes;
  const c = await conexaoAtiva();
  if (!c) return [];
  const fonte = await lerFonte(c.token, c.data_source_id);
  const coluna = fonte.properties[PROPS.status] as { status?: { options?: { name?: string }[] } } | undefined;
  const nomes = (coluna?.status?.options ?? []).map((o) => o.name ?? "").filter(Boolean);
  situacoesGuardadas = { em: Date.now(), nomes };
  return nomes;
}

/** A ação está ligada a uma página do Notion? */
export async function ligadaAoNotion(tarefaId: string): Promise<boolean> {
  return !!(await paginaDaAcao(tarefaId));
}

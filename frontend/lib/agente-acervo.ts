// Acervo do Assistente do Ações: tudo o que quem pergunta vê, uma linha por ação, e a escolha pelo SENTIDO.
//
// Vitor, 02/10/2026 ("você está sendo raso demais"): a busca por palavra trazia 20 ações de TTARS quando havia
// umas 46 nas reuniões dele — "renomear o assistente para Cooper" ou "editar as sessões" não dizem "TTARS". Aqui o
// acervo inteiro (lista, passadas, marcadas, reuniões que a pessoa abre, projetos e times) vai a uma chamada rápida
// que só devolve as refs que servem; a conversa principal trabalha só com as escolhidas (o catálogo inteiro na
// conversa principal deixava a resposta lenta e chegou a estourar o tempo).
import type { Tarefa } from "./queries";
import { withTenant, withTenantLeituraEquipe } from "./db";
import { isTeamMode } from "./team-mode";
import { carregarTarefas } from "./equipe-compartilhado";
import { ordenarPendencias } from "./compartilhar";
import { paraTela } from "./ttars-tela";
import { chamarModelo } from "./ia";
import type { TarefaVista } from "./agente-regras";

/** Acima disto o acervo corta pelas mais recentes (e a resposta avisa). */
export const MAX_ACERVO = 900;

type Par = { tarefa_id: string; dono_id: string };

const ABERTAS = "('aberta','em_andamento','aguardando_aprovacao')";

/**
 * Tudo o que quem pergunta vê no Ações, do ponto de vista dela: as dela e as das reuniões que ela abre (regra de
 * quem vê do banco), as passadas e marcadas para ela, as dos projetos em que está e as dos times que vê.
 * Canceladas nunca; concluídas só com `concluidas`.
 */
export async function acervo(userId: string, opcoes: { concluidas: boolean }): Promise<{ tarefas: TarefaVista[]; cortado: boolean }> {
  const situacao = opcoes.concluidas ? `(t.status IN ${ABERTAS} OR t.status = 'concluida')` : `t.status IN ${ABERTAS}`;
  const visiveis = await (isTeamMode() ? withTenantLeituraEquipe : withTenant)(userId, (c) =>
    c.query<Par>(
      `SELECT t.id::text AS tarefa_id, t.user_id::text AS dono_id FROM tarefas t
        WHERE ${situacao}
        ORDER BY t.created_at DESC
        LIMIT ${MAX_ACERVO + 1}`,
    ),
  );
  // As ligadas à pessoa (passadas, marcadas, projetos, times) vêm primeiro: se o acervo passar do limite, o corte cai
  // nas reuniões mais antigas, não nelas (revisão de 02/10/2026).
  const pares = new Map<string, Par>();
  if (isTeamMode()) {
    // Moram no tenant de outra pessoa e só chegam pelas funções que conferem o acesso (as mesmas das telas).
    const deOutros = await withTenant(userId, (c) =>
      c.query<Par>(
        `SELECT tarefa_id::text, dono_id::text FROM equipe_tarefas_para_mim()
         UNION SELECT tarefa_id::text, dono_id::text FROM equipe_tarefas_marcadas_para_mim()
         UNION SELECT p.tarefa_id::text, p.dono_id::text FROM equipe_meus_projetos() mp CROSS JOIN LATERAL equipe_tarefas_do_projeto(mp.quadro_id) p
         UNION SELECT p.tarefa_id::text, p.dono_id::text FROM unnest(equipe_meus_times()) AS tm(id) CROSS JOIN LATERAL equipe_tarefas_do_time(tm.id) p`,
      ),
    );
    for (const p of deOutros.rows) pares.set(p.tarefa_id, p);
  }
  for (const p of visiveis.rows) if (!pares.has(p.tarefa_id)) pares.set(p.tarefa_id, p);
  const lista = [...pares.values()];
  const cortado = lista.length > MAX_ACERVO;
  const carregadas = await carregarTarefas(userId, lista.slice(0, MAX_ACERVO), { donoNome: true });
  const vale = (t: Tarefa) =>
    t.status === "aberta" || t.status === "em_andamento" || t.status === "aguardando_aprovacao" || (opcoes.concluidas && t.status === "concluida");
  const tarefas = (await paraTela(userId, carregadas.filter(vale).sort(ordenarPendencias))) as TarefaVista[];
  return { tarefas, cortado };
}

const ESCOLHA = {
  type: "object",
  additionalProperties: false,
  properties: {
    refs: { type: "array", items: { type: "string" }, description: "refs (t…) das ações que atendem ao pedido." },
    repetidas: {
      type: "array",
      items: { type: "array", items: { type: "string" } },
      description: "Grupos de refs que são o mesmo combinado (2 ou mais por grupo). [] se o pedido não fala de repetidas ou não há.",
    },
  },
  required: ["refs", "repetidas"],
};

function instrucoesDaEscolha(nome: string): string {
  return [
    `Você escolhe, numa lista de ações do Ações (TTARS da Welcome), as que atendem a um pedido de ${nome}. "você" nas linhas é ${nome}.`,
    "Escolha pelo SENTIDO, nunca só pela palavra. Ex.: 'coisas no TTARS/CRM/sistema' inclui telas, cards, funil, etapas, régua, relatórios, painéis, visão geral, busca, acessos e senhas, módulos, assistente, papéis e times do sistema, atendimento e WhatsApp do sistema, guias e vídeos de uso, mesmo sem a palavra TTARS; não inclui vaga de emprego chamada CRM nem e-mail marketing, a não ser que o pedido peça.",
    "Pedido sobre uma pessoa: veja quem faz e de quem é a lista. 'O que X me deve' = X faz e a ação está na minha lista ou eu cobro. 'O que eu devo a X' = quem faz é você numa ação da lista de X ou que X cobra. 'Com o meu nome', 'atribuídas a mim', 'que eu fiquei de fazer' = quem faz é você. 'Que não está na minha lista' = 'lista de' outra pessoa. 'Reuniões com X' = ações de reuniões da lista de X ou que citam X; ação da lista de quem pergunta só entra se citar X.",
    "Seja completo e certeiro: inclua toda ação que atende ao pedido, mesmo dita com outras palavras, e nenhuma que não tenha relação com ele (estar na lista da pessoa não basta). Com LIMITE DE PESSOA, o limite dito ('só as minhas', 'que o marketing espera de mim') vale.",
    "LIMITE DE PESSOA: nenhum = ela não limitou por pessoa: escolha só pelo assunto, de qualquer pessoa (quem faz e de quem é a lista não importam), mesmo que o pedido diga 'que " + nome + " faz' ou 'que " + nome + " ficou de fazer'.",
    "repetidas: só com AGRUPAR REPETIDAS = sim. Agrupe as que são o mesmo combinado (mesma entrega), mesmo com palavras, reuniões ou donos diferentes. Variações para marcas diferentes (Trips, Weddings) não são repetidas.",
    "Responda só com as refs.",
  ].join("\n");
}

/** A chamada rápida: o pedido + o acervo em linhas → as refs que servem (e os grupos de repetidas). */
export async function escolherPeloSentido(
  user: { id: string; nome: string },
  pedido: string,
  linhas: string[],
  agruparRepetidas: boolean,
  /** As palavras dela que limitam por pessoa; null = de qualquer pessoa (o pedido reescrito não limita sozinho). */
  limite: string | null,
): Promise<{ refs: string[]; repetidas: string[][]; custoUsd: number }> {
  const r = await chamarModelo({
    userId: user.id,
    instrucoes: instrucoesDaEscolha(user.nome),
    entrada: [
      {
        role: "user",
        content: `PEDIDO: ${pedido}\nLIMITE DE PESSOA: ${limite ? `"${limite}"` : "nenhum"}\nAGRUPAR REPETIDAS: ${agruparRepetidas ? "sim" : "não"}\n\nAÇÕES (uma por linha):\n${linhas.join("\n")}`,
      },
    ],
    formato: { nome: "escolha", schema: ESCOLHA },
    esforco: "low",
    maxSaida: 4000,
    signal: AbortSignal.timeout(60_000),
  });
  const d = JSON.parse(r.texto || "{}") as { refs?: unknown; repetidas?: unknown };
  const refs = Array.isArray(d.refs) ? d.refs.filter((x): x is string => typeof x === "string") : [];
  const repetidas = Array.isArray(d.repetidas)
    ? d.repetidas.map((g) => (Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [])).filter((g) => g.length > 1)
    : [];
  return { refs, repetidas, custoUsd: r.custoUsd };
}

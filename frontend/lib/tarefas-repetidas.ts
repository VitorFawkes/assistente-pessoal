// Tarefa falada de novo entra no card que já existe.
//
// Antes, cada reunião criava as suas tarefas sem olhar as anteriores: o mesmo
// assunto virava um card novo toda vez que voltava a ser falado (a página de
// planejamento do TARS virou 8 cards entre 25/06 e 06/08/2026). Aqui mora a
// comparação que roda antes de criar:
//
//   1. acha, pelo SENTIDO, as 10 tarefas existentes mais parecidas com cada
//      nova. Comparar palavras não serve: de 57 pares com as mesmas palavras,
//      só 12 eram a mesma tarefa — o resto era passo diferente do mesmo assunto.
//   2. uma IA decide 3 vezes, cada vez com as candidatas noutra ordem e sem ver
//      as outras decisões, se a nova é a mesma que alguma candidata.
//   3. 3 de 3 → "mesma": não nasce card, vira "falada de novo" no card antigo.
//      1 ou 2 de 3 → "duvida": nasce o card com o aviso "parece repetida".
//      0 de 3 → "nova": nasce normal.
//
// Juntar errado esconde uma tarefa real dentro de outra, e isso é pior que
// repetir. Por isso a trava é a unanimidade, candidata concluída nunca junta
// sozinha, e qualquer falha (IA fora do ar, resposta estranha) cai em criar.

import { createHash } from "node:crypto";
import { dataBR as dataBRFmt, ehDataValida } from "./data-br";

export const MODELO_VETOR = "text-embedding-3-small";
export const DIMENSOES_VETOR = 512;
export const EXECUCOES_JUIZ = 3;
export const CANDIDATAS_POR_NOVA = 10;
/** Concluída há mais que isto não entra na comparação. */
export const DIAS_CONCLUIDA = 30;

export type TarefaNova = {
  titulo: string;
  descricao?: string | null;
  owner?: string | null;
  evidencia?: string | null;
};

export type Candidata = {
  id: string;
  titulo: string;
  descricao: string | null;
  owner: string | null;
  status: string;
  criada_em: string | null;
  reuniao_em: string | null;
  concluida_em: string | null;
};

export type Voto = { decisao: "mesma" | "nova"; candidata: string | null };

export type Decisao =
  | { tipo: "nova"; votos: number }
  | { tipo: "mesma"; tarefaId: string; votos: number }
  | { tipo: "duvida"; tarefaId: string; votos: number };

/** Clique da pessoa ("é a mesma" / "são diferentes") que vira exemplo pro juiz. */
export type Exemplo = { tipo: "repetida" | "diferente"; nova: string; existente: string };

export type Uso = { entrada: number; saida: number; chamadas: number; falhas: number };

export type Julgamento = { votos: Map<number, Voto>; entrada: number; saida: number };
export type Juiz = (mensagens: Mensagem[]) => Promise<Julgamento>;
export type Mensagem = { role: "system" | "user"; content: string };

// ─── texto e vetor ───────────────────────────────────────────────────

export function textoParaVetor(t: { titulo: string; descricao?: string | null }): string {
  const desc = (t.descricao ?? "").trim().slice(0, 600);
  return desc ? `${t.titulo.trim()}\n${desc}` : t.titulo.trim();
}

export function hashTexto(texto: string): string {
  return createHash("sha256")
    .update(`${MODELO_VETOR}|${DIMENSOES_VETOR}|${texto}`)
    .digest("hex");
}

export function cosseno(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** Vetor de sentido de cada texto, em lotes. Lança erro se a OpenAI falhar. */
export async function vetorizar(textos: string[], signal?: AbortSignal): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente no ambiente");
  const out: number[][] = [];
  for (let i = 0; i < textos.length; i += 256) {
    const lote = textos.slice(i, i + 256).map((t) => t.slice(0, 8000) || "(vazio)");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODELO_VETOR, input: lote, dimensions: DIMENSOES_VETOR }),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const rows = (data.data ?? []).sort((a, b) => a.index - b.index);
    if (rows.length !== lote.length) throw new Error("OpenAI embeddings: resposta incompleta");
    for (const r of rows) out.push(r.embedding);
  }
  return out;
}

// ─── o juiz ──────────────────────────────────────────────────────────

const INSTRUCOES = `Você evita que a lista de tarefas de uma pessoa tenha cards repetidos.

Cada TAREFA NOVA saiu de uma reunião que acabou de acontecer. Para cada uma, você recebe as CANDIDATAS: tarefas que já estão na lista dessa pessoa e se parecem com ela. Decida se a tarefa nova é A MESMA que uma das candidatas, ou se é NOVA.

É A MESMA quando pede a mesma entrega ou a mesma ação concreta, ainda que dita com outras palavras, com mais ou menos detalhe, com prazo novo ou com outro dono. Exemplos:
- "Finalizar o desenho da página de planejamento no sistema" e "Colocar a página de planejamento em uso até sexta" → mesma: a entrega é a página de planejamento funcionando.
- "Enviar proposta ao João" e "Mandar a proposta revisada pro João" → mesma.
- "Definir metas de CRM para a Fernanda" e "Estabelecer metas mensais da frente de CRM da Fernanda" → mesma.

É NOVA quando é outro passo do mesmo assunto, outra entrega, outra ocasião ou outro objeto. Exemplos:
- "Ajustar critérios de qualificação de leads" e "Ajustar a nota de corte do score de leads para 58" → nova: é um ajuste específico diferente.
- "Entregar a página de planejamento" e "Revisar a página de planejamento com o uso real do time" → nova: é o passo seguinte.
- "Agendar reunião com o Thiago" e "Preparar a apresentação para o Thiago" → nova.
- "Dar feedback para a Vanessa sobre foco" (junho) e "Dar feedback para a Vanessa sobre o novo cargo" (agosto) → nova: outra conversa.
- "Criar o grupo de WhatsApp do time de mídia" e "Adicionar a nova gestora ao grupo de WhatsApp de mídia" → nova.

Candidata CONCLUÍDA só é a mesma se a reunião nova volta a pedir exatamente a mesma entrega.

Na dúvida, responda NOVA. Juntar errado esconde uma tarefa real dentro de outra, e isso é pior que deixar repetido.

Responda com uma decisão para cada tarefa nova. Em "candidata", o rótulo da candidata (ex.: "C3") quando for a mesma, ou null quando for nova. Em "motivo", uma frase curta.`;

const SCHEMA = {
  type: "object",
  properties: {
    decisoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nova: { type: "integer" },
          decisao: { type: "string", enum: ["mesma", "nova"] },
          candidata: { type: ["string", "null"] },
          motivo: { type: "string" },
        },
        required: ["nova", "decisao", "candidata", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisoes"],
  additionalProperties: false,
} as const;

function dataBR(iso: string | null | undefined): string {
  return iso && ehDataValida(iso) ? dataBRFmt(iso) : "?";
}

function corta(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const STATUS_LEGIVEL: Record<string, string> = {
  aberta: "aberta",
  em_andamento: "fazendo",
  aguardando_aprovacao: "aguardando aprovação",
  concluida: "CONCLUÍDA",
  cancelada: "cancelada",
};

/** Embaralha de forma determinística (cada execução do juiz vê outra ordem). */
export function embaralhar<T>(lista: T[], semente: number): T[] {
  const out = [...lista];
  let s = (semente * 2654435761) >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type ItemComparacao = {
  nova: TarefaNova;
  candidatas: { rotulo: string; c: Candidata }[];
};

export function montarMensagens(
  dataReuniao: string | null,
  itens: ItemComparacao[],
  exemplos: Exemplo[],
  semente: number,
): Mensagem[] {
  let system = INSTRUCOES;
  if (exemplos.length) {
    const linhas = exemplos.slice(0, 12).map(
      (e) =>
        `- "${corta(e.nova, 140)}" e "${corta(e.existente, 140)}" → ${e.tipo === "repetida" ? "mesma" : "nova"}`,
    );
    system += `\n\nDecisões que esta pessoa já tomou na mão (siga o mesmo critério):\n${linhas.join("\n")}`;
  }
  const blocos: string[] = [`Reunião de ${dataBR(dataReuniao)}.`];
  itens.forEach((it, i) => {
    if (!it.candidatas.length) return;
    const linhas = [
      `TAREFA NOVA ${i + 1}: ${corta(it.nova.titulo, 220)}`,
      it.nova.descricao ? `Detalhe: ${corta(it.nova.descricao, 420)}` : "",
      it.nova.owner ? `Dono: ${corta(it.nova.owner, 60)}` : "",
      it.nova.evidencia ? `Trecho da reunião: "${corta(it.nova.evidencia, 300)}"` : "",
      "Candidatas:",
      ...embaralhar(it.candidatas, semente * 131 + i).map(({ rotulo, c }) => {
        const quando = c.reuniao_em ? `falada em ${dataBR(c.reuniao_em)}` : `criada em ${dataBR(c.criada_em)}`;
        const status =
          c.status === "concluida" && c.concluida_em
            ? `CONCLUÍDA em ${dataBR(c.concluida_em)}`
            : STATUS_LEGIVEL[c.status] ?? c.status;
        const dono = c.owner ? ` (dono: ${corta(c.owner, 40)})` : "";
        const desc = c.descricao ? ` — ${corta(c.descricao, 220)}` : "";
        return `  ${rotulo} [${status}, ${quando}] ${corta(c.titulo, 200)}${desc}${dono}`;
      }),
    ].filter(Boolean);
    blocos.push(linhas.join("\n"));
  });
  return [
    { role: "system", content: system },
    { role: "user", content: blocos.join("\n\n") },
  ];
}

/** Juiz de verdade: OpenAI com resposta em formato fixo. */
export function juizOpenAI(opts?: { modelo?: string; esforco?: string; timeoutMs?: number }): Juiz {
  const modelo = opts?.modelo ?? process.env.DEDUP_MODEL ?? "gpt-5.1";
  const esforco = opts?.esforco ?? process.env.DEDUP_REASONING ?? "low";
  return async (mensagens) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY ausente no ambiente");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelo,
        reasoning_effort: esforco,
        max_completion_tokens: 12_000,
        response_format: { type: "json_schema", json_schema: { name: "decisoes", strict: true, schema: SCHEMA } },
        messages: mensagens,
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI: resposta sem conteúdo");
    return {
      votos: lerVotos(content),
      entrada: data.usage?.prompt_tokens ?? 0,
      saida: data.usage?.completion_tokens ?? 0,
    };
  };
}

/** Converte a resposta do juiz em votos por tarefa nova (índice 0-based). */
export function lerVotos(content: string): Map<number, Voto> {
  const parsed = JSON.parse(content) as { decisoes?: { nova?: unknown; decisao?: unknown; candidata?: unknown }[] };
  const votos = new Map<number, Voto>();
  for (const d of parsed.decisoes ?? []) {
    const n = typeof d.nova === "number" ? d.nova : Number(d.nova);
    if (!Number.isInteger(n) || n < 1) continue;
    const decisao = d.decisao === "mesma" ? "mesma" : "nova";
    const candidata = typeof d.candidata === "string" && d.candidata.trim() ? d.candidata.trim().toUpperCase() : null;
    if (!votos.has(n - 1)) votos.set(n - 1, { decisao, candidata });
  }
  return votos;
}

/**
 * A regra, sem IA: junta só com as 3 execuções dizendo "mesma" e apontando a
 * MESMA candidata aberta. Qualquer "mesma" a menos (ou candidata concluída)
 * vira dúvida; nenhuma, nova. Execução que falhou não conta como voto — então,
 * com menos de 3 execuções de pé, o máximo possível é dúvida.
 */
export function decidir(
  qtdNovas: number,
  execucoes: (Map<number, Voto> | null)[],
  rotulosPorNova: string[][],
  candidataPorRotulo: Map<string, Candidata>,
): Decisao[] {
  const ok = execucoes.filter((e): e is Map<number, Voto> => !!e);
  const out: Decisao[] = [];
  for (let i = 0; i < qtdNovas; i++) {
    const validos = new Set(rotulosPorNova[i] ?? []);
    const contagem = new Map<string, number>();
    for (const e of ok) {
      const v = e.get(i);
      if (v?.decisao !== "mesma" || !v.candidata || !validos.has(v.candidata)) continue;
      contagem.set(v.candidata, (contagem.get(v.candidata) ?? 0) + 1);
    }
    const totalMesma = [...contagem.values()].reduce((a, b) => a + b, 0);
    if (!totalMesma) {
      out.push({ tipo: "nova", votos: 0 });
      continue;
    }
    // Empate: vence a candidata mais parecida (rotulosPorNova já vem em ordem).
    let melhor = "";
    let melhorN = 0;
    for (const r of rotulosPorNova[i]) {
      const n = contagem.get(r) ?? 0;
      if (n > melhorN) {
        melhor = r;
        melhorN = n;
      }
    }
    const cand = candidataPorRotulo.get(melhor)!;
    const unanime = ok.length === EXECUCOES_JUIZ && melhorN === EXECUCOES_JUIZ;
    if (unanime && cand.status !== "concluida") {
      out.push({ tipo: "mesma", tarefaId: cand.id, votos: melhorN });
    } else {
      out.push({ tipo: "duvida", tarefaId: cand.id, votos: totalMesma });
    }
  }
  return out;
}

// ─── a comparação inteira (sem banco: quem chama traz os dados) ──────

export type ResultadoComparacao = {
  decisoes: Decisao[];
  /** Por tarefa nova: as candidatas mostradas ao juiz, da mais parecida pra menos. */
  mostradas: { id: string; similaridade: number }[][];
  uso: Uso;
};

export async function compararComExistentes(p: {
  dataReuniao: string | null;
  novas: TarefaNova[];
  vetoresNovas: number[][];
  candidatas: Candidata[];
  vetoresCandidatas: Map<string, number[]>;
  exemplos?: Exemplo[];
  juiz?: Juiz;
  k?: number;
}): Promise<ResultadoComparacao> {
  const k = p.k ?? CANDIDATAS_POR_NOVA;
  const uso: Uso = { entrada: 0, saida: 0, chamadas: 0, falhas: 0 };

  // 1. as k mais parecidas por sentido, pra cada nova
  const mostradas = p.novas.map((_, i) => {
    const v = p.vetoresNovas[i];
    return p.candidatas
      .map((c) => {
        const vc = p.vetoresCandidatas.get(c.id);
        return { c, similaridade: v && vc ? cosseno(v, vc) : -1 };
      })
      .filter((x) => x.similaridade > -1)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, k);
  });

  if (!mostradas.some((m) => m.length)) {
    return { decisoes: p.novas.map(() => ({ tipo: "nova", votos: 0 })), mostradas: mostradas.map(() => []), uso };
  }

  // 2. rótulos curtos (C1, C2…), iguais pra mesma candidata em todas as novas
  const rotuloDe = new Map<string, string>();
  const candidataPorRotulo = new Map<string, Candidata>();
  for (const m of mostradas) {
    for (const { c } of m) {
      if (!rotuloDe.has(c.id)) {
        const r = `C${rotuloDe.size + 1}`;
        rotuloDe.set(c.id, r);
        candidataPorRotulo.set(r, c);
      }
    }
  }
  const itens: ItemComparacao[] = p.novas.map((nova, i) => ({
    nova,
    candidatas: mostradas[i].map(({ c }) => ({ rotulo: rotuloDe.get(c.id)!, c })),
  }));
  const rotulosPorNova = itens.map((it) => it.candidatas.map((x) => x.rotulo));

  // 3. o juiz, 3 vezes em paralelo, cada uma com as candidatas noutra ordem
  const juiz = p.juiz ?? juizOpenAI();
  const execucoes = await Promise.all(
    Array.from({ length: EXECUCOES_JUIZ }, async (_, run) => {
      uso.chamadas++;
      try {
        const j = await juiz(montarMensagens(p.dataReuniao, itens, p.exemplos ?? [], run + 1));
        uso.entrada += j.entrada;
        uso.saida += j.saida;
        return j.votos;
      } catch (e) {
        uso.falhas++;
        console.error("[tarefas-repetidas] juiz falhou:", e instanceof Error ? e.message : e);
        return null;
      }
    }),
  );

  return {
    decisoes: decidir(p.novas.length, execucoes, rotulosPorNova, candidataPorRotulo),
    mostradas: mostradas.map((m) => m.map(({ c, similaridade }) => ({ id: c.id, similaridade }))),
    uso,
  };
}

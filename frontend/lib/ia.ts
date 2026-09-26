// Chamada ao modelo barato (GPT-6 Luna) para as telas do Ações no TTARS: ler uma frase
// ("pedir pra Paula revisar até sexta") e o Assistente de tarefas. Pedido do Vitor:
// "quando ele é coach pode ser o caro, mas pras tarefas e etc não dá".
//
// Responses API sem guardar nada do lado da OpenAI (store:false) e sem escrever cache
// (a GPT-6 cobra 1,25× pra escrever; aqui o texto quase nunca se repete).

import { hojeBR } from "./data-br";

export const MODELO_TAREFAS = process.env.ACOES_TAREFAS_MODEL || "gpt-6-luna";

/** US$ por 1M tokens (tabela da OpenAI, 25/09/2026). Modelo sem preço conferido conta caro. */
const PRECO: Record<string, { entrada: number; cache: number; saida: number }> = {
  "gpt-6-luna": { entrada: 0.1, cache: 0.01, saida: 0.5 },
  "gpt-6-sol": { entrada: 2, cache: 0.2, saida: 10 },
};
const PRECO_DESCONHECIDO = { entrada: 5, cache: 0.5, saida: 25 };

/** Teto por pessoa por dia (conta em memória; reiniciar o servidor zera). */
export const TETO_DIARIO_USD = Number(process.env.ACOES_IA_TETO_DIA_USD || 1);
const gasto = new Map<string, { dia: string; usd: number }>();

export class IaIndisponivel extends Error {}

export function gastoDeHoje(userId: string): number {
  const g = gasto.get(userId);
  return g && g.dia === hojeBR() ? g.usd : 0;
}

function somarGasto(userId: string, usd: number) {
  const dia = hojeBR();
  const g = gasto.get(userId);
  gasto.set(userId, { dia, usd: (g && g.dia === dia ? g.usd : 0) + usd });
}

export function custoUsd(modelo: string, uso: { entrada: number; cache: number; saida: number }): number {
  const p = PRECO[modelo.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? PRECO_DESCONHECIDO;
  const cache = Math.min(uso.cache, uso.entrada);
  return ((uso.entrada - cache) * p.entrada + cache * p.cache + uso.saida * p.saida) / 1e6;
}

export type Item = Record<string, unknown>;
export type Ferramenta = { name: string; description: string; parameters: Record<string, unknown> };
export type Chamada = { call_id: string; name: string; args: Record<string, unknown> };

export type Resposta = {
  /** Tudo o que o modelo devolveu (inclui o raciocínio cifrado): volta inteiro na rodada seguinte. */
  itens: Item[];
  texto: string;
  chamadas: Chamada[];
  custoUsd: number;
};

/**
 * Uma rodada. `formato` = JSON Schema da resposta final (strict). Sem `formato`, texto livre.
 * Lança IaIndisponivel com mensagem pra tela quando não dá (sem chave, teto, OpenAI fora).
 */
export async function chamarModelo(opts: {
  userId: string;
  instrucoes: string;
  entrada: Item[];
  ferramentas?: Ferramenta[];
  formato?: { nome: string; schema: Record<string, unknown> };
  maxSaida?: number;
  signal?: AbortSignal;
}): Promise<Resposta> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) throw new IaIndisponivel("A IA ainda não está ligada neste servidor.");
  if (gastoDeHoje(opts.userId) >= TETO_DIARIO_USD) {
    throw new IaIndisponivel("Você chegou no limite de uso da IA por hoje. Amanhã volta.");
  }
  const corpo = {
    model: MODELO_TAREFAS,
    store: false,
    instructions: opts.instrucoes,
    input: opts.entrada,
    reasoning: { effort: "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_options: { mode: "explicit" },
    max_output_tokens: opts.maxSaida ?? 2500,
    ...(opts.formato
      ? { text: { format: { type: "json_schema", name: opts.formato.nome, strict: true, schema: opts.formato.schema } } }
      : {}),
    ...(opts.ferramentas?.length
      ? {
          tools: opts.ferramentas.map((f) => ({ type: "function", strict: true, ...f })),
          parallel_tool_calls: true,
          tool_choice: "auto",
        }
      : {}),
  };
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo),
      signal: opts.signal ?? AbortSignal.timeout(45_000),
    });
  } catch {
    throw new IaIndisponivel("Não consegui falar com a IA agora. Tente de novo.");
  }
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    console.error(`[ia] OpenAI ${res.status}: ${detalhe.slice(0, 300)}`);
    throw new IaIndisponivel(
      res.status === 429 ? "A IA está no limite de uso agora. Tente em alguns minutos." : "A IA não respondeu direito. Tente de novo.",
    );
  }
  const r = (await res.json()) as {
    status?: string;
    model?: string;
    output?: Item[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  const uso = {
    entrada: r.usage?.input_tokens ?? 0,
    cache: r.usage?.input_tokens_details?.cached_tokens ?? 0,
    saida: r.usage?.output_tokens ?? 0,
  };
  const custo = custoUsd(r.model || MODELO_TAREFAS, uso);
  somarGasto(opts.userId, custo);
  console.log(
    `[ia] ${r.model || MODELO_TAREFAS} user=${opts.userId.slice(0, 8)} in=${uso.entrada} cache=${uso.cache} out=${uso.saida} usd=${custo.toFixed(5)}`,
  );
  if (r.status !== "completed" || !Array.isArray(r.output)) {
    throw new IaIndisponivel("A IA não terminou a resposta. Tente de novo.");
  }
  const itens = r.output;
  const chamadas: Chamada[] = [];
  for (const it of itens) {
    if (it.type !== "function_call" || typeof it.call_id !== "string" || typeof it.name !== "string") continue;
    let args: Record<string, unknown> = {};
    try {
      args = typeof it.arguments === "string" ? (JSON.parse(it.arguments) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    chamadas.push({ call_id: it.call_id, name: it.name, args });
  }
  const texto = itens
    .filter((it) => it.type === "message" && Array.isArray(it.content))
    .flatMap((it) => it.content as Item[])
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
  return { itens, texto, chamadas, custoUsd: custo };
}

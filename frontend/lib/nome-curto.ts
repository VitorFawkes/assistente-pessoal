// Nome curto das reuniões que ninguém batizou. Pedido do Vitor (28/09): "Tire as palavras
// irrelevantes dos nomes". O rótulo era o começo do resumo da IA ("Áudio curto de teste em que a
// pessoa verifica se a gravação está funcionando…"): metade passava de 190 letras. A IA barata
// lê o resumo e devolve de 2 a 6 palavras. O nome entra em `nome` só enquanto ninguém deu outro,
// e fica anotado em raw_ai_response.nome_ia (dá para saber o que foi a IA e desfazer).

import { query, withTenant } from "./db";
import { chamarModelo } from "./ia";

/** Reuniões por chamada à IA; uma varrida também para em MAX_POR_VARRIDA no total. */
export const POR_VEZ = 25;
export const MAX_POR_VARRIDA = 100;

const INSTRUCOES = [
  "Você dá um nome curto a reuniões gravadas, lendo o resumo de cada uma.",
  "O nome tem de 2 a 6 palavras, em português, e começa pelo assunto principal.",
  "Sem palavras que não dizem nada: reunião, áudio, trecho, gravação, conversa, call, alinhamento, discussão, curto, rápido, breve, informal, trivial, apenas, sobre, entre.",
  "Sem data e sem o nome do dono da conta (dono_da_conta). Cite uma pessoa, casal ou empresa só quando é ela que identifica a reunião (ex.: 'Casal Silvia e Isadora: Caribe', 'Proposta da ActiveCampaign').",
  "Se o resumo diz que foi só um teste de gravação ou que o áudio não tem conteúdo: 'Teste de gravação'.",
  "Só a primeira letra e os nomes próprios em maiúscula. Sem ponto final e sem aspas.",
  "Exemplos: 'Reunião entre Vitor e Paula focada em diagnóstico do time de marketing e conflitos com vendas' → 'Diagnóstico do marketing com Paula'; 'Papel de Vitor no negócio, sua remuneração e metas comerciais para os próximos quatro meses' → 'Papel, remuneração e metas comerciais'.",
  "Devolva um nome para cada código recebido.",
].join("\n");

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nomes"],
  properties: {
    nomes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "nome"],
        properties: { codigo: { type: "string" }, nome: { type: "string" } },
      },
    },
  },
};

/**
 * A última palavra do servidor sobre o que a IA escreveu: curto de verdade, sem aspas nem ponto e sem o
 * primeiro nome do dono da conta ("Remuneração e comissão de Vitor" → "Remuneração e comissão").
 */
export function limparNome(bruto: string | null | undefined, dono = ""): string | null {
  let s = (bruto ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’«»]+/, "")
    .replace(/["'“”‘’«».;:!]+$/, "")
    .trim();
  const primeiro = dono.trim().split(" ")[0] ?? "";
  if (primeiro.length >= 3) {
    const nome = primeiro.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sem = s
      .replace(new RegExp(`(?:\\s*,)?\\s*(?:(?:de|do|da|com|e|para|pro|pra)\\s+)?(?<!\\p{L})${nome}(?!\\p{L})`, "giu"), "")
      .replace(/^[\s,:–-]*(?:(?:e|de|do|da|com)\s+)?/iu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (sem.length >= 3) s = sem;
  }
  if (s.length < 3 || s.length > 70 || s.split(" ").length > 9) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Uma chamada à IA barata: um nome curto (ou null, se não prestar) para cada resumo, na mesma ordem. */
export async function pedirNomes(userId: string, dono: string, resumos: string[]): Promise<(string | null)[]> {
  const r = await chamarModelo({
    userId,
    instrucoes: INSTRUCOES,
    entrada: [{ role: "user", content: JSON.stringify({ dono_da_conta: dono, reunioes: resumos.map((resumo, i) => ({ codigo: `r${i + 1}`, resumo })) }) }],
    formato: { nome: "nomes", schema: ESQUEMA },
    maxSaida: 2500,
  });
  const lidos = (JSON.parse(r.texto) as { nomes?: { codigo: string; nome: string }[] }).nomes ?? [];
  return resumos.map((_, i) => limparNome(lidos.find((x) => x.codigo === `r${i + 1}`)?.nome, dono));
}

/**
 * Dá nome às reuniões prontas da pessoa que ainda não têm nome. Devolve quantas ganharam nome.
 * Nome que não preste também é anotado (vazio), para a varrida não pagar de novo a cada 5 minutos;
 * nesse caso a reunião continua com o rótulo tirado do resumo.
 */
export async function nomearReunioes(userId: string, limite = POR_VEZ): Promise<number> {
  const pendentes = await withTenant(userId, async (db) =>
    (
      await db.query<{ id: string; summary: string }>(
        `SELECT id, left(summary, 900) AS summary FROM meetings
          WHERE user_id = $1 AND status = 'done' AND (nome IS NULL OR btrim(nome) = '')
            AND summary IS NOT NULL AND btrim(summary) <> ''
            AND NOT coalesce(jsonb_typeof(raw_ai_response) = 'object' AND raw_ai_response ? 'nome_ia', false)
          ORDER BY coalesce(recorded_at, created_at) DESC
          LIMIT $2`,
        [userId, limite],
      )
    ).rows,
  );
  if (!pendentes.length) return 0;
  const dono = (await query<{ nome: string | null }>("SELECT nome FROM users WHERE id = $1", [userId]))[0]?.nome ?? "";
  const nomes = await pedirNomes(userId, dono, pendentes.map((m) => m.summary));
  let feitos = 0;
  await withTenant(userId, async (db) => {
    for (const [i, m] of pendentes.entries()) {
      const nome = nomes[i];
      const res = await db.query(
        `UPDATE meetings SET nome = coalesce($2, nome),
           raw_ai_response = CASE
             WHEN raw_ai_response IS NULL OR jsonb_typeof(raw_ai_response) = 'null' THEN jsonb_build_object('nome_ia', coalesce($2, ''))
             WHEN jsonb_typeof(raw_ai_response) = 'object' THEN raw_ai_response || jsonb_build_object('nome_ia', coalesce($2, ''))
             ELSE raw_ai_response END
         WHERE id = $1 AND user_id = $3 AND (nome IS NULL OR btrim(nome) = '')`,
        [m.id, nome, userId],
      );
      if (nome && res.rowCount) feitos++;
    }
  });
  return feitos;
}

/** Uma varrida: cada conta com reunião sem nome, até MAX_POR_VARRIDA reuniões no total. */
export async function nomearTodas(): Promise<{ nomeadas: number; falhas: number }> {
  const contas = await query<{ id: string }>("SELECT id FROM users");
  let nomeadas = 0, falhas = 0;
  for (const c of contas) {
    if (nomeadas >= MAX_POR_VARRIDA) break;
    try {
      nomeadas += await nomearReunioes(c.id, Math.min(POR_VEZ, MAX_POR_VARRIDA - nomeadas));
    } catch (err) {
      falhas++;
      console.error("nome curto", c.id.slice(0, 8), err instanceof Error ? err.message : err);
    }
  }
  return { nomeadas, falhas };
}

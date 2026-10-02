import { providerCompletion, type CoachTelemetry } from "./provider";
import { CONFERENCIA } from "./framework-v2";

/**
 * Conferente de fatos do Coach v2: só barra o que é falso ou proibido, nunca o estilo. Primeiro uma checagem sem IA
 * (texto interno, linhas demais, perguntas demais); depois uma leitura barata que lista fatos sem apoio nos dados.
 */
const PROIBIDO: [RegExp, string][] = [
 [/SEM_NOVIDADE/u, "texto interno SEM_NOVIDADE"],
 [/^\s*\*{0,2}Orienta[cç][aã]o\*{0,2}\s*$/imu, "cabeçalho Orientação"],
 [/Sem observa[cç][oõ]es verificadas/iu, "rodapé técnico"],
 [/\bassistant_dossier|dossi[eê]|\bconsulta\b.*\bservidor\b|frases_prontas|objetivo_id|changes_done_now/iu, "palavra interna do sistema"],
 [/\b[tpr]\d{1,3}\b/u, "código interno de ação ou pessoa"],
 [/caminho mais direto|oportunidade mais pr[oó]xima|isso move a meta|o foco [eé] fechar contratos/iu, "justificativa genérica"],
 [/;/u, "ponto e vírgula"],
];
export const linhasDe = (texto: string) => texto.split("\n").map(l => l.trim()).filter(Boolean).length;

export function checagemSemIa(texto: string, limiteLinhas: number): string[] {
 const problemas: string[] = [];
 for (const [re, nome] of PROIBIDO) if (re.test(texto)) problemas.push(`Tem ${nome}: tire.`);
 const linhas = linhasDe(texto);
 if (linhas > limiteLinhas) problemas.push(`Tem ${linhas} linhas: o máximo é ${limiteLinhas}. Corte o que não muda a decisão dele.`);
 if ((texto.match(/\?/g) || []).length > 1) problemas.push("Tem mais de uma pergunta: deixe só a mais importante, no fim.");
 return problemas;
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["problemas"], properties: { problemas: { type: "array", maxItems: 6, items: { type: "string", minLength: 3, maxLength: 300 } } } };

/** Fatos sem apoio nos dados, lidos pelo modelo barato. Falha da leitura não barra a resposta (a checagem sem IA já passou). */
export async function fatosSemApoio(texto: string, dados: unknown, onTelemetry?: (e: CoachTelemetry) => void): Promise<string[]> {
 try {
  const raw = await providerCompletion(CONFERENCIA, { mensagem: texto, dados }, SCHEMA, { role: "quick", reasoningEffort: "low", timeoutMs: 60000, onTelemetry });
  return Array.isArray(raw.problemas) ? raw.problemas.filter((p): p is string => typeof p === "string" && p.trim().length > 2).slice(0, 6) : [];
 } catch { return []; }
}

/** Limpa o que o modelo às vezes devolve: espaços, linhas em branco duplas, negrito de Markdown. */
export function limparTexto(texto: string) {
 return texto.replace(/\r/g, "").replace(/\*\*([^*\n]+)\*\*/g, "$1").split("\n").map(l => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** Uma linha em branco entre as linhas (pedido do Vitor, 04/09): cada linha com texto vira um parágrafo. */
export function arejado(texto: string) {
 return texto.split("\n").map(l => l.trim()).filter(Boolean).join("\n\n");
}

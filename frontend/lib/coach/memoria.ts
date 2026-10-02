import { providerCompletion, type CoachTelemetry } from "./provider";
import { coachStore } from "./store";
import { arquivarObjetivo, criarObjetivo, objetivosDoCoach, type ObjetivoDoCoach } from "./objetivos";
import type { CoachMemory } from "./types";

/**
 * O que o Vitor conta sobre ele fica guardado e ele vê o "Guardei: …" (02/10/2026). Antes só valiam frases que
 * começavam de jeitos fixos ("meu objetivo é…"); "meus dois principais focos são…" e "Closer é entrevista…" se
 * perderam. Agora uma leitura barata de cada mensagem acha o que vale guardar; o servidor confere que o trecho é
 * literal da mensagem antes de gravar. Foco vira Objetivo; correção, preferência e fato viram memória.
 */
export type TipoDeMemoria = "foco" | "correcao" | "preferencia" | "fato" | "vida";
export type ItemDeMemoria = { tipo: TipoDeMemoria; texto: string; trecho: string };

const INSTRUCAO = `Você lê UMA mensagem que o Vitor mandou ao Coach dele e separa o que ele CONTOU sobre si, sobre o trabalho dele ou sobre a vida, que valha lembrar nas próximas conversas.
Tipos:
- foco: um objetivo ou foco de resultado que ele diz ter agora ("meu foco é vender 5 contratos por mês", "quero que a área de convidados venda mais"). Um item por foco; texto curto, como nome de objetivo (até 12 palavras), com o número se ele disse.
- correcao: ele corrige algo que o Coach entendeu errado ou explica o que algo significa ("Closer na agenda é entrevista de closer", "a Paula agora cuida do marketing").
- preferencia: como ele quer ser tratado pelo Coach ("não me manda mensagem no fim de semana", "prefiro respostas curtas").
- fato: fato estável sobre ele ou a empresa que muda conselhos futuros ("estou contratando duas closers", "a Ana saiu").
- vida: objetivo da vida pessoal (saúde, família, lazer).
Não guarde: pedido de tarefa ("me lembra de…", "conclui…"), pergunta, desabafo do momento ("tô cansado hoje"), o que vale só para hoje, opinião sobre uma pessoa, nem nada que o Coach disse.
texto: curto, no máximo 12 palavras, como uma regra ou um fato, sem "ele" e sem "o Vitor" ("Closer na agenda = entrevista de contratação, não venda"; "Contratando duas closers para a Weddings"). trecho: o pedaço LITERAL da mensagem que sustenta o item, copiado exatamente.
Na dúvida, não guarde. A maioria das mensagens não tem nada para guardar: itens vazio.`;

const SCHEMA = { type: "object", additionalProperties: false, required: ["itens"], properties: { itens: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["tipo", "texto", "trecho"], properties: {
 tipo: { type: "string", enum: ["foco", "correcao", "preferencia", "fato", "vida"] }, texto: { type: "string", minLength: 3, maxLength: 200 }, trecho: { type: "string", minLength: 3, maxLength: 600 },
} } } } };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** O trecho tem que estar na mensagem (ignorando acento, pontuação e caixa). */
export function trechoLiteral(mensagem: string, trecho: string) { const t = norm(trecho); return t.length >= 3 && norm(mensagem).includes(t); }

export function validarItens(raw: unknown, mensagem: string, jaSabe: string[]): ItemDeMemoria[] {
 const itens = (raw && typeof raw === "object" && Array.isArray((raw as { itens?: unknown }).itens) ? (raw as { itens: unknown[] }).itens : []);
 const sabidos = new Set(jaSabe.map(norm));
 const out: ItemDeMemoria[] = [];
 for (const i of itens.slice(0, 3)) {
  if (!i || typeof i !== "object") continue;
  const { tipo, texto, trecho } = i as Record<string, unknown>;
  if (!["foco", "correcao", "preferencia", "fato", "vida"].includes(String(tipo)) || typeof texto !== "string" || typeof trecho !== "string") continue;
  const limpo = texto.replace(/\s+/g, " ").trim().replace(/[.;]+$/u, "");
  if (limpo.length < 3 || !trechoLiteral(mensagem, trecho) || sabidos.has(norm(limpo)) || out.some(o => norm(o.texto) === norm(limpo))) continue;
  out.push({ tipo: tipo as TipoDeMemoria, texto: limpo.slice(0, 200), trecho: trecho.trim().slice(0, 600) });
 }
 return out;
}

/** Só lê mensagem que pode ter algo a guardar: curta demais, "sim", "ok" e pedido de desfazer passam direto. */
export function valeLer(mensagem: string) { const s = norm(mensagem); return s.split(" ").length >= 4 && s.length <= 3000; }

export async function lerMemoria(input: { mensagem: string; jaSabe: string[]; onTelemetry?: (e: CoachTelemetry) => void }): Promise<ItemDeMemoria[]> {
 if (!valeLer(input.mensagem)) return [];
 const raw = await providerCompletion(INSTRUCAO, { mensagem: input.mensagem, ja_guardado: input.jaSabe.slice(0, 30) }, SCHEMA, { role: "quick", reasoningEffort: "low", timeoutMs: 60000, onTelemetry: input.onTelemetry });
 return validarItens(raw, input.mensagem, input.jaSabe);
}

export const PREFIXO = "Informado por você na conversa: ";
/** Foco de contratos ou de convidados ganha o placar automático; o número dito vira a meta do mês. */
export function medidorDoFoco(texto: string): { medidor: "contratos_ww_mes" | "convidados_site_mes" | null; meta: number | null } {
 const s = norm(texto);
 if (/\bcontrato/u.test(s)) { const n = s.match(/\b(\d{1,3})\b/u); return { medidor: "contratos_ww_mes", meta: n ? Number(n[1]) : null }; }
 if (/\bconvidad/u.test(s)) return { medidor: "convidados_site_mes", meta: null };
 return { medidor: null, meta: null };
}
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

/** Grava e devolve as linhas que a pessoa lê ("Guardei: …"). */
export async function guardarMemoria(userId: string, revision: number, itens: ItemDeMemoria[]): Promise<string[]> {
 const store = coachStore(userId);
 const linhas: string[] = [];
 for (const item of itens) {
  if (item.tipo === "foco") {
   const r = await criarObjetivo(userId, { nome: item.texto, ...medidorDoFoco(item.texto) });
   if (r) { linhas.push(r.criado ? `Guardei como objetivo: ${item.texto}.` : `Esse objetivo já está guardado: ${r.objetivo.nome}.`); continue; }
   const atuais = await objetivosDoCoach(userId);
   linhas.push(`Você já tem 3 objetivos: ${juntar(atuais.map(o => o.nome))}. Para guardar "${item.texto}", diga qual deles sai.`);
   continue;
  }
  const kind: CoachMemory["kind"] = item.tipo === "vida" ? "goal" : "context";
  const content = item.tipo === "vida" ? `${PREFIXO}Objetivo de vida pessoal: ${item.texto}` : `${PREFIXO}${item.texto}`;
  try { await store.rememberUserNote({ kind, content, status: "confirmed", evidence: [] }, revision); linhas.push(`Guardei: ${item.texto}.`); }
  catch { /* memória que não grava não vira promessa na resposta */ }
 }
 return linhas;
}

const ESQUECE = /^(?:por favor )?(?:esquece|esqueca|esqueça|apaga|apague|nao guarda|não guarda|nao guarde|não guarde|desconsidera|desconsidere)(?: (?:isso|isso ai|isso aí|essa|esse|o que eu disse|o que voce guardou|o que você guardou|por favor))*[.!]*$/iu;
export const pedidoDeEsquecer = (mensagem: string) => ESQUECE.test(mensagem.trim());

/** "esquece": desfaz o que a última resposta guardou (memória fica rejeitada; objetivo criado agora vai para o arquivo). */
export async function esquecerUltima(userId: string, ultimaResposta: string, now = new Date()): Promise<string> {
 const guardados = [...ultimaResposta.matchAll(/^Guardei(?: como objetivo)?: (.+?)\.?$/gmu)].map(m => m[1].trim());
 if (!guardados.length) return "Não guardei nada na última resposta.";
 const store = coachStore(userId);
 const memorias = await store.memories();
 const objetivos: ObjetivoDoCoach[] = await objetivosDoCoach(userId);
 const feitos: string[] = [];
 for (const texto of guardados) {
  const m = memorias.find(x => x.status === "confirmed" && norm(x.content).endsWith(norm(texto)) && now.getTime() - Date.parse(x.updated_at ?? x.created_at) < 24 * 3600_000);
  if (m) { await store.correctMemory(m.id, m.content, "rejected").catch(() => null); feitos.push(texto); continue; }
  const o = objetivos.find(x => norm(x.nome) === norm(texto));
  if (o && await arquivarObjetivo(userId, o.id)) feitos.push(texto);
 }
 return feitos.length ? `Esqueci: ${juntar(feitos)}.` : "Não achei o que esquecer.";
}

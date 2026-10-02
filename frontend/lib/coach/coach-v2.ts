import { withTenant } from "../db";
import { answerInfo, buildDossier } from "./assistant";
import { budgetNotice, budgetReply, budgetState, runCostUsd } from "./budget";
import { calendarContext } from "./calendar";
import { aceitarCombinado, combinadoDoDia, combinadosDoPeriodo, combinarAgora, comMinuscula, diaAnteriorDoCoach, diaFalado, diaLocal, diaSeguinte, eAceite, eRecusa, fimDeSemana, fimDeSemanaLigado, fraseDoCombinado, horaValida, mensagemDas18h, proporCombinado, proximoDiaDoCoach, recusarCombinado, resolverCombinado, resultadoCurto, sincronizarComTarefa, type Combinado } from "./combinado";
import { arejado, checagemSemIa, fatosSemApoio, limparTexto } from "./conferir";
import { usuarioDoCoach } from "./equipe";
import { reviewPeriod } from "./evidence";
import { CONVERSA, MANHA, SEXTA, SISTEMA } from "./framework-v2";
import { esquecerUltima, guardarMemoria, lerMemoria, pedidoDeEsquecer, PREFIXO } from "./memoria";
import { dueTasks, localDayRange } from "./morning-agenda";
import { atualizarAgora, metaDeContratos, objetivosDoCoach, type ObjetivoDoCoach } from "./objetivos";
import { lerPlacar, linhasDoPlacar, nomeDoCasal, placarParaModelo, type LeituraDoPlacar, type Negociacao } from "./placar";
import { CoachAIError, providerCompletion, type CoachTelemetry } from "./provider";
import { recordModelRuns } from "./retrieval";
import type { coachStore } from "./store";
import { handleTaskMessage, withoutRepeats } from "./task-actions";
import type { CoachMessage, CoachProfile, ReviewContent } from "./types";

/**
 * Coach v2 (02/10/2026): uma porta (o WhatsApp), dois cérebros. Pedido de tarefa ou de informação vai para o
 * Assistente (faz na hora, responde curto, "desfaz" volta) e a resposta fica fora da memória de conversa do Coach.
 * O resto vai para o Coach: placar real, objetivos do TTARS, combinado do dia, curto e firme, sem rodapé.
 */
type Store = ReturnType<typeof coachStore>;
const ASSISTENTE = "assistente" as const, COACH = "coach" as const;
const LIMITE_CONVERSA = 8, LIMITE_MANHA = 6, LIMITE_SEXTA = 15;

// ── Agenda de hoje, com o tipo de cada compromisso ───────────────────────────────────────────────
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const palavras = (s: string) => semAcento(s).replace(/^dw\s*\|\s*/u, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Os primeiros nomes do casal ("Cássia Serrazine & Daniel" → cassia, daniel). */
export function nomesDoCasal(casal: string) {
 return palavras(casal.replace(/&|\+|\//g, " e ")).split(/ e /).map(p => p.trim().split(" ")[0]).filter(n => n && n.length >= 2);
}
export type TipoDeCompromisso = "entrevista" | "venda" | "possivel_venda" | "pensar" | "interna";
export function tipoDoCompromisso(titulo: string, carteira: Negociacao[]): { tipo: TipoDeCompromisso; casal?: string; etapa?: string } {
 const t = palavras(titulo);
 if (/^closer\b/u.test(t)) return { tipo: "entrevista" };
 if (/pensar estrategico/u.test(t)) return { tipo: "pensar" };
 const casal = carteira.find(n => { const nomes = nomesDoCasal(n.casal); return nomes.length >= 2 && nomes.every(nome => new RegExp(`\\b${nome}\\b`, "u").test(t)); });
 if (casal) return { tipo: "venda", casal: nomeDoCasal(casal.casal), etapa: casal.etapa };
 if (/welcome weddings/u.test(t) && /\b[a-z]{2,} e [a-z]{2,}\b/u.test(t.replace(/welcome weddings/u, ""))) return { tipo: "possivel_venda" };
 return { tipo: "interna" };
}
async function agendaDeHoje(userId: string, timezone: string, now: Date, carteira: Negociacao[]) {
 const range = localDayRange(timezone, now);
 const ctx = await calendarContext(userId, { from: range.from.toISOString(), to: range.to.toISOString() }, { timezone }).catch(() => null);
 if (!ctx || ctx.status !== "connected") return { lida: false as const, aviso: "Agenda de hoje não foi lida: não diga que está vazia." };
 const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
 const compromissos = [...ctx.events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).filter(e => !/^almo[cç]o$/iu.test(e.subject.trim())).slice(0, 12)
  .map(e => e.is_private ? { hora: hora.format(new Date(e.start)), titulo: "Compromisso particular", tipo: "interna" as TipoDeCompromisso } : { hora: e.is_all_day ? "dia inteiro" : hora.format(new Date(e.start)), titulo: e.subject.slice(0, 120), ...tipoDoCompromisso(e.subject, carteira) });
 return { lida: true as const, compromissos };
}

// ── O que o Coach lê em toda mensagem ────────────────────────────────────────────────────────────
const quando = (timezone: string, now: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "full", timeStyle: "short" }).format(now);
const diaCurto = (iso: string, timezone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(new Date(iso));
const situacaoDoCombinado: Record<Combinado["status"], string> = { proposto: "proposto, ainda sem resposta", aceito: "aceito, ainda não marcado como feito", feito: "feito", nao_deu: "não saiu", adiado: "passou para o dia seguinte", expirado: "não foi aceito", recusado: "recusado" };
const doCombinado = (c: Combinado | null) => (c ? { titulo: c.titulo, ate: c.ate, situacao: situacaoDoCombinado[c.status], motivo: c.motivo } : null);
const memoriaParaModelo = (conteudo: string) => (conteudo.startsWith(PREFIXO) ? conteudo.slice(PREFIXO.length) : conteudo);
/** A conversa recente com o Coach: as respostas do Assistente (listas, concluí) ficam fora. */
export function conversaDoCoach(mensagens: CoachMessage[], limite = 10) {
 const out: { quem: string; texto: string }[] = [];
 const visiveis = mensagens.filter(m => !m.stale);
 for (let i = 0; i < visiveis.length; i++) {
  const m = visiveis[i];
  if (m.role === "assistant" && m.autor === ASSISTENTE) continue;
  // O pedido que o Assistente atendeu sozinho também sai: a conversa do Coach é a de pensar.
  if (m.role === "user" && visiveis[i + 1]?.role === "assistant" && visiveis[i + 1]?.autor === ASSISTENTE) continue;
  out.push({ quem: m.role === "user" ? "Vitor" : "Coach", texto: m.content.length > 900 ? `${m.content.slice(0, 900)}…` : m.content });
 }
 return out.slice(-limite);
}

type Contexto = { dados: Record<string, unknown>; objetivos: ObjetivoDoCoach[]; leitura: LeituraDoPlacar; combinado: Combinado | null; meta: number | null };
export async function montarContexto(userId: string, store: Store, profile: CoachProfile, now: Date, extra: Record<string, unknown> = {}): Promise<Contexto> {
 const tz = profile.timezone;
 const hoje = diaLocal(tz, now);
 // Com o fim de semana desligado, o "dia anterior" da segunda é a sexta e o "próximo" da sexta é a segunda.
 const fds = await fimDeSemanaLigado(userId);
 const anterior = diaAnteriorDoCoach(hoje, fds);
 const [objetivos, leitura, combinado0, devidas, memorias, mensagens, doAnterior] = await Promise.all([
  objetivosDoCoach(userId), lerPlacar(userId, tz, now), combinadoDoDia(userId, tz, now), dueTasks(userId, tz, now, 8).catch(() => null), store.memories(), store.messages(), combinadosDoPeriodo(userId, anterior, diaSeguinte(anterior)).catch(() => []),
 ]);
 const combinado = await sincronizarComTarefa(userId, combinado0);
 const meta = metaDeContratos(objetivos);
 const placar = placarParaModelo(leitura, meta, tz);
 const agenda = await agendaDeHoje(userId, tz, now, leitura.placar?.carteira ?? []);
 // A tela de Objetivos mostra o placar na linha "Agora:" do "Como medir".
 const linhas = linhasDoPlacar(leitura, meta, tz);
 if (linhas) for (const o of objetivos) {
  const linha = o.medidor === "contratos_ww_mes" ? linhas.resumo_contratos : o.medidor === "convidados_site_mes" ? linhas.resumo_convidados : null;
  if (linha) await atualizarAgora(userId, o, `${linha} (${diaCurto(now.toISOString(), tz)})`).catch(() => false);
 }
 const ativas = memorias.filter(m => m.status === "confirmed" && (!m.lifecycle || m.lifecycle === "active") && !(m.kind === "goal" && m.goal_area === "life"));
 const dados = {
  agora: quando(tz, now),
  objetivos: objetivos.map(o => ({ objetivo_id: o.id, nome: o.nome, meta: o.meta, prazo: o.prazo })),
  placar,
  combinado_de_hoje: doCombinado(combinado),
  combinado_do_dia_anterior: doAnterior.length ? { dia: diaFalado(anterior, hoje), ...doCombinado(doAnterior.at(-1)!) } : null,
  proximo_dia_do_coach: diaFalado(proximoDiaDoCoach(hoje, fds), hoje),
  agenda_de_hoje: agenda,
  acoes: devidas ? {
   vencem_hoje: devidas.due_today, atrasadas: devidas.overdue,
   lista: devidas.items.slice(0, 8).map(i => ({ titulo: i.titulo, prazo: i.vence_hoje ? "hoje" : diaCurto(i.prazo, tz), de_quem: i.acao === "cobrar" && i.owner && !/^(?:eu|vitor)\b/iu.test(i.owner) ? `cobrar ${i.owner}` : "sua" })),
  } : { aviso: "Não consegui ler as ações agora." },
  memorias: ativas.map(m => ({ dito_em: diaCurto(m.created_at, tz), texto: memoriaParaModelo(m.content) })).slice(-25),
  conversa_recente: conversaDoCoach(mensagens),
  ...extra,
 };
 return { dados, objetivos, leitura, combinado, meta };
}

// ── Chamada ao modelo, com o conferente de fatos e um conserto ───────────────────────────────────
const textoSchema = (max: number) => ({ type: "string", minLength: 1, maxLength: max });
async function escrever(instrucao: string, dados: Record<string, unknown>, schema: Record<string, unknown>, limite: number, onTelemetry: (e: CoachTelemetry) => void): Promise<{ resultado: Record<string, unknown>; texto: string; problemas: string[] }> {
 let resultado = await providerCompletion(`${SISTEMA}\n\n${instrucao}`, dados, schema, { role: "primary", reasoningEffort: "medium", timeoutMs: 150000, onTelemetry });
 let texto = limparTexto(String(resultado.texto ?? ""));
 let problemas = [...checagemSemIa(texto, limite), ...(texto ? await fatosSemApoio(texto, dados, onTelemetry) : ["Resposta vazia."])];
 if (!problemas.length) return { resultado, texto, problemas };
 resultado = await providerCompletion(`${SISTEMA}\n\n${instrucao}\n\nCONSERTO: a versão anterior (texto_anterior) tinha estes problemas. Reescreva a mensagem inteira corrigindo cada um, com os mesmos dados.`,
  { ...dados, texto_anterior: texto, problemas }, schema, { role: "primary", reasoningEffort: "medium", timeoutMs: 150000, onTelemetry });
 texto = limparTexto(String(resultado.texto ?? ""));
 problemas = texto ? checagemSemIa(texto, limite) : ["Resposta vazia."];
 return { resultado, texto, problemas };
}

const combinadoSchema = (objetivos: string[]) => ({ type: "object", additionalProperties: false, required: ["titulo", "ate", "objetivo_id"], properties: {
 titulo: { type: "string", maxLength: 300 }, ate: { type: "string", maxLength: 5 }, objetivo_id: { type: "string", enum: ["", ...objetivos] },
} });
function combinadoValido(raw: unknown, objetivos: ObjetivoDoCoach[]) {
 if (!raw || typeof raw !== "object") return null;
 const c = raw as Record<string, unknown>;
 const titulo = typeof c.titulo === "string" ? c.titulo.replace(/\s+/g, " ").trim().replace(/[.!]+$/u, "") : "";
 if (titulo.length < 3) return null;
 const objetivo = typeof c.objetivo_id === "string" && objetivos.some(o => o.id === c.objetivo_id) ? c.objetivo_id : null;
 return { titulo: `${titulo[0].toUpperCase()}${titulo.slice(1)}`, ate: horaValida(c.ate), objetivo_id: objetivo };
}

// ── Conversa ─────────────────────────────────────────────────────────────────────────────────────
type Salvar = (texto: string, autor: "coach" | "assistente") => Promise<CoachMessage>;
export async function conversaV2(userId: string, store: Store, profile: CoachProfile, message: string, now: Date, runId?: string) {
 const tz = profile.timezone;
 const history = await store.messages();
 const visiveis = history.filter(m => !m.stale);
 const ultima = visiveis.at(-1);
 const ultimaDoCoach = [...visiveis].reverse().find(m => m.role === "assistant") ?? null;
 const telemetry: CoachTelemetry[] = [];
 const onTelemetry = (e: CoachTelemetry) => telemetry.push(e);
 let userSaved = false;
 const salvarPedido = async () => { if (!userSaved) { await store.addMessage("user", message, [], undefined, runId ? `${runId}:user` : undefined); userSaved = true; } };
 const salvar: Salvar = async (texto, autor) => { await salvarPedido(); return store.addMessage("assistant", texto, [], undefined, runId ? `${runId}:assistant` : undefined, [], [], autor); };
 try {
  // 1) "esquece": desfaz o que a última resposta guardou.
  if (pedidoDeEsquecer(message)) { await salvar(await esquecerUltima(userId, ultimaDoCoach?.content ?? "", now), COACH); return; }
  // 2) Resposta curta ao combinado (sem IA): "ok" à proposta das 8h, "sim/não/amanhã" à pergunta das 18h.
  const user = await usuarioDoCoach(userId);
  const combinado = await sincronizarComTarefa(userId, await combinadoDoDia(userId, tz, now));
  const respondeuProposta = combinado?.status === "proposto" && ultima?.role === "assistant" && (ultima.id === combinado.mensagem_id || ultima.content.includes("Fechado?"));
  if (combinado && respondeuProposta && eAceite(message)) {
   const aceito = await aceitarCombinado(user, combinado);
   await salvar(`Fechado: ${fraseDoCombinado(aceito)}.\n\nEstá na sua lista do TTARS. Às 18h te pergunto.`, COACH);
   return;
  }
  if (combinado && respondeuProposta && eRecusa(message)) {
   await recusarCombinado(userId, combinado);
   await salvar("Tudo bem, sem combinado hoje.\n\nSe quiser, me diga um passo e eu acompanho.", COACH);
   return;
  }
  const perguntou18h = combinado?.status === "aceito" && ultima?.role === "assistant" && ultima.content.startsWith("Combinado de hoje:") && ultima.content.includes("Saiu?");
  const curto = perguntou18h ? resultadoCurto(message) : null;
  if (combinado && curto) {
   const r = await resolverCombinado(user, combinado, curto);
   const quando = r.retomar_em ? diaFalado(r.retomar_em, combinado.dia) : "amanhã";
   await salvar(curto === "feito" ? `Boa. Marquei como feito: ${comMinuscula(r.titulo)}.`
    : curto === "adiado" ? `Passei para ${quando}: ${comMinuscula(r.titulo)}.\n\n${quando === "amanhã" ? "Amanhã" : `Na ${quando},`} às 18h te pergunto de novo.`
    : "Entendi, não saiu.\n\nO que travou?", COACH);
   return;
  }
  // 3) Assistente de tarefas: pedido e informação de tarefas, pessoas, reuniões e agenda. A resposta à proposta das
  // 8h ("prefiro ligar pro Guilherme") ou à pergunta das 18h ("não, ela não respondeu") é conversa do combinado: vai
  // direto para o Coach, senão vira uma ação solta e o combinado fica sem resposta.
  const budget = await budgetState(userId, tz, now);
  const recent = visiveis.map(m => ({ role: m.role, content: m.content }));
  const doCombinado = !!(respondeuProposta || perguntou18h);
  // O que ele conta sobre si fica guardado seja quem for responder (Assistente ou Coach): a leitura roda junto.
  const [memorias, objetivosAgora] = await Promise.all([store.memories(), objetivosDoCoach(userId)]);
  const jaSabe = [...memorias.filter(m => m.status === "confirmed").map(m => memoriaParaModelo(m.content)), ...objetivosAgora.map(o => o.nome)];
  const leitura = budget.exceeded ? Promise.resolve([]) : lerMemoria({ mensagem: message, jaSabe, onTelemetry }).catch(() => []);
  const guardar = async () => guardarMemoria(userId, (await store.profile()).revision, await leitura).catch(() => [] as string[]);
  const handled = doCombinado ? null : await handleTaskMessage(userId, message, recent, tz, now, runId, { ai: !budget.exceeded }).catch(() => { console.error("coach task actions failed"); return null; });
  if (handled && "reply" in handled) { await salvar(arejado([handled.reply, ...await guardar()].join("\n")), ASSISTENTE); return; }
  const feito = handled?.done ?? [], esperando = handled?.waiting ?? [];
  if (budget.exceeded) { await salvar(budgetReply(budget.cap), COACH); return; }
  if (handled?.lane === "tarefas") {
   const dossier = await buildDossier({ userId, message, recent, lane: "tarefas", timezone: tz, now, selfPersonIds: await store.selfPersonIds(), listings: handled.listings ?? [], onTelemetry });
   const answer = await answerInfo({ message, recent, done: feito, waiting: esperando, dossier, timezone: tz, now, onTelemetry });
   const teto = budget.spent + runCostUsd(telemetry) >= budget.cap ? budgetNotice(budget.cap) : "";
   await salvar(arejado([feito.join("\n"), withoutRepeats(answer, feito), ...esperando.filter(n => !answer.includes(n)), ...await guardar(), teto].filter(Boolean).join("\n")), ASSISTENTE);
   return;
  }
  // 4) Coach.
  const ctxPromise = montarContexto(userId, store, profile, now, {
   mensagem_do_vitor: message,
   ...(feito.length || esperando.length ? { changes_done_now: [...feito, ...esperando] } : {}),
   ...(respondeuProposta ? { respondendo_a: "proposta de combinado das 8h (combinado_de_hoje)" } : perguntou18h ? { respondendo_a: "pergunta das 18h sobre o combinado_de_hoje" } : {}),
  });
  const ctx = await ctxPromise;
  const schema = { type: "object", additionalProperties: false, required: ["texto", "combinado"], properties: {
   texto: textoSchema(1500),
   combinado: { type: "object", additionalProperties: false, required: ["acao", "titulo", "ate", "objetivo_id", "resultado", "motivo"], properties: {
    acao: { type: "string", enum: ["nenhum", "combinar", "resultado"] }, titulo: { type: "string", maxLength: 300 }, ate: { type: "string", maxLength: 5 },
    objetivo_id: { type: "string", enum: ["", ...ctx.objetivos.map(o => o.id)] }, resultado: { type: "string", enum: ["", "feito", "nao_deu", "adiado"] }, motivo: { type: "string", maxLength: 500 },
   } },
  } };
  const { resultado, texto, problemas } = await escrever(CONVERSA, ctx.dados, schema, LIMITE_CONVERSA, onTelemetry);
  if (problemas.length && !texto) throw new CoachAIError("O coach não retornou uma orientação válida.");
  const linhas: string[] = [];
  let resposta = texto;
  const pedido = (resultado.combinado ?? {}) as Record<string, unknown>;
  if (pedido.acao === "combinar") {
   const novo = combinadoValido(pedido, ctx.objetivos);
   if (novo) {
    const c = await combinarAgora(user, novo, tz, now);
    // A linha do combinado é do servidor; a do modelo, se ele escreveu, sairia repetida.
    resposta = texto.split("\n").filter(l => !/^\s*combinad[oa]\b/iu.test(l)).join("\n").trim();
    linhas.push(`Combinado: ${fraseDoCombinado(c)}. Está na sua lista. Às 18h te pergunto.`);
   }
  } else if (pedido.acao === "resultado" && ctx.combinado?.status === "aceito" && ["feito", "nao_deu", "adiado"].includes(String(pedido.resultado))) {
   const r = await resolverCombinado(user, ctx.combinado, pedido.resultado as "feito" | "nao_deu" | "adiado", typeof pedido.motivo === "string" ? pedido.motivo : null);
   if (r.retomar_em) linhas.push(`Passei para ${diaFalado(r.retomar_em, ctx.combinado.dia)}: ${comMinuscula(r.titulo)}.`);
  }
  linhas.push(...await guardar());
  await salvar(arejado([feito.join("\n"), esperando.join("\n"), feito.length ? withoutRepeats(resposta, feito) : resposta, ...linhas].filter(Boolean).join("\n")), COACH);
 } finally {
  await recordModelRuns(userId, "chat", runId || null, telemetry).catch(() => {});
 }
}

// ── 8h e 18h ─────────────────────────────────────────────────────────────────────────────────────
function manhaSemIa(ctx: Contexto, timezone: string) {
 const linhas = linhasDoPlacar(ctx.leitura, ctx.meta, timezone);
 const agenda = ctx.dados.agenda_de_hoje as { lida: boolean; compromissos?: { hora: string; titulo: string; tipo: string; casal?: string }[] };
 const vendas = agenda.lida ? (agenda.compromissos ?? []).filter(c => c.tipo === "venda").map(c => `${c.hora} ${c.casal}`) : [];
 return [linhas?.contratos, vendas.length ? `Hoje tem reunião de venda: ${vendas.join(" e ")}.` : null, "Me diga qual é o passo de hoje que eu acompanho."].filter(Boolean).join("\n");
}

export async function checkinV2(userId: string, store: Store, profile: CoachProfile, kind: "morning" | "evening", now: Date, runId?: string) {
 const tz = profile.timezone;
 if (fimDeSemana(tz, now) && !await fimDeSemanaLigado(userId)) return;
 if (runId && await store.messageByKey(`${runId}:assistant`)) return;
 if (kind === "evening") {
  const texto = mensagemDas18h(await sincronizarComTarefa(userId, await combinadoDoDia(userId, tz, now)));
  if (texto) await store.addMessage("assistant", texto, [], undefined, runId ? `${runId}:assistant` : undefined, [], [], COACH);
  return;
 }
 const budget = await budgetState(userId, tz, now);
 if (budget.exceeded) return;
 const telemetry: CoachTelemetry[] = [];
 try {
  const ctx = await montarContexto(userId, store, profile, now, { dia_da_semana: new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long" }).format(now) });
  const schema = { type: "object", additionalProperties: false, required: ["texto", "combinado"], properties: { texto: textoSchema(1200), combinado: combinadoSchema(ctx.objetivos.map(o => o.id)) } };
  let texto: string, combinado: ReturnType<typeof combinadoValido> = null;
  try {
   const r = await escrever(MANHA, ctx.dados, schema, LIMITE_MANHA, e => telemetry.push(e));
   texto = r.problemas.length ? manhaSemIa(ctx, tz) : r.texto;
   combinado = r.problemas.length ? null : combinadoValido(r.resultado.combinado, ctx.objetivos);
  } catch (e) {
   if (!(e instanceof CoachAIError)) throw e;
   // A mensagem das 8h nunca se perde: sai com o que vem do banco.
   texto = manhaSemIa(ctx, tz);
  }
  const final = arejado(`${texto}${combinado ? `\nCombinado de hoje: ${fraseDoCombinado(combinado)}. Fechado?` : ""}`);
  const msg = await store.addMessage("assistant", final, [], undefined, runId ? `${runId}:assistant` : undefined, [], [], COACH);
  if (combinado) await proporCombinado(userId, { ...combinado, origem: "manha", mensagem_id: msg.id }, tz, now);
 } finally {
  await recordModelRuns(userId, "checkin_morning", runId || null, telemetry).catch(() => {});
 }
}

// ── Sexta 17h ────────────────────────────────────────────────────────────────────────────────────
async function semanaDasAcoes(userId: string, de: string, ate: string) {
 return withTenant(userId, async db => {
  const r = (await db.query<{ promessas: number; andaram: number; paradas: string[] | null; novas: number; projetos: number; reunioes: number }>(
   `SELECT
     (SELECT count(*) FROM tarefas WHERE user_id=$1 AND meeting_id IS NOT NULL AND is_mine AND created_at>=$2 AND created_at<$3)::int AS promessas,
     (SELECT count(*) FROM tarefas WHERE user_id=$1 AND meeting_id IS NOT NULL AND is_mine AND created_at>=$2 AND created_at<$3 AND (status IN ('concluida','cancelada') OR updated_at>created_at+interval '1 hour'))::int AS andaram,
     (SELECT array_agg(titulo ORDER BY created_at) FROM (SELECT titulo,created_at FROM tarefas WHERE user_id=$1 AND meeting_id IS NOT NULL AND is_mine AND created_at>=$2 AND created_at<$3 AND status NOT IN ('concluida','cancelada') AND updated_at<=created_at+interval '1 hour' ORDER BY created_at LIMIT 3) x) AS paradas,
     (SELECT count(*) FROM tarefas WHERE user_id=$1 AND meeting_id IS NULL AND created_at>=$2 AND created_at<$3)::int AS novas,
     (SELECT count(*) FROM quadros WHERE user_id=$1 AND created_at>=$2 AND created_at<$3)::int AS projetos,
     (SELECT count(*) FROM meetings WHERE user_id=$1 AND coalesce(recorded_at,created_at)>=$2 AND coalesce(recorded_at,created_at)<$3 AND status NOT IN ('archived_session'))::int AS reunioes`,
   [userId, de, ate])).rows[0];
  return { acoes_suas_que_sairam_das_reunioes: r.promessas, dessas_andaram: r.andaram, paradas_exemplos: r.paradas ?? [], acoes_novas_fora_de_reuniao: r.novas, projetos_novos: r.projetos, reunioes_gravadas: r.reunioes };
 });
}

export async function revisaoV2(userId: string, store: Store, profile: CoachProfile, now: Date, force: boolean, scheduled: boolean) {
 if (scheduled && !profile.weekly_enabled) return null;
 const tz = profile.timezone;
 const period = reviewPeriod(now, tz, profile.review_day, profile.review_hour);
 const existentes = await store.reviews();
 const existe = existentes.find(r => r.week_start === period.weekStart);
 if (existe && (scheduled || !force)) return existe;
 const telemetry: CoachTelemetry[] = [];
 try {
  const deDia = diaLocal(tz, new Date(period.from)), ateDia = diaSeguinte(diaLocal(tz, new Date(Date.parse(period.to) - 1)));
  const [combinados, acoes] = await Promise.all([combinadosDoPeriodo(userId, deDia, ateDia), semanaDasAcoes(userId, period.from, period.to)]);
  const ctx = await montarContexto(userId, store, profile, now, {
   semana: { de: diaCurto(period.from, tz), ate: diaCurto(period.to, tz) },
   combinados_da_semana: { aceitos: combinados.filter(c => ["aceito", "feito", "nao_deu", "adiado"].includes(c.status)).length, feitos: combinados.filter(c => c.status === "feito").length, lista: combinados.filter(c => c.status !== "expirado").map(c => ({ dia: c.dia.split("-").reverse().slice(0, 2).join("/"), titulo: c.titulo, situacao: situacaoDoCombinado[c.status], motivo: c.motivo })) },
   acoes_da_semana: acoes,
  });
  const p = ctx.leitura.placar;
  if (p) (ctx.dados as Record<string, unknown>).contratos_na_semana = p.contratos.filter(c => Date.parse(c.data) >= Date.parse(period.from) && Date.parse(c.data) < Date.parse(period.to)).map(c => c.casal);
  const schema = { type: "object", additionalProperties: false, required: ["texto"], properties: { texto: textoSchema(2500) } };
  let texto: string;
  try {
   const r = await escrever(SEXTA, ctx.dados, schema, LIMITE_SEXTA, e => telemetry.push(e));
   texto = r.problemas.length ? "" : r.texto;
  } catch (e) { if (!(e instanceof CoachAIError)) throw e; texto = ""; }
  if (!texto) {
   const linhas = linhasDoPlacar(ctx.leitura, ctx.meta, tz);
   const cs = (ctx.dados as Record<string, { aceitos: number; feitos: number }>).combinados_da_semana;
   texto = [linhas?.contratos, linhas?.convidados, `Combinados da semana: ${cs.feitos} de ${cs.aceitos} saíram.`, `Reuniões: ${acoes.acoes_suas_que_sairam_das_reunioes} ações suas, ${acoes.dessas_andaram} andaram.`].filter(Boolean).join("\n");
  }
  const content: ReviewContent & { texto: string } = { headline: "Revisão da semana", focus: arejado(texto), observations: [], progress: "", experiment: "", question: "", limitations: [], texto: arejado(texto) };
  return await store.saveReview(period.weekStart, content, "coach-v2", (await store.profile()).revision, !!existe);
 } finally {
  await recordModelRuns(userId, "weekly", null, telemetry).catch(() => {});
 }
}

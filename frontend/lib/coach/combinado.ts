import { withTenant } from "../db";
import { criarAcao } from "../nova-acao";
import { mudarTarefa } from "../tarefa-mudar";
import type { User } from "../auth";

/**
 * O combinado do dia (02/10/2026). Às 8h o Coach propõe um passo concreto ligado a um foco; "ok" aceita e ele vira
 * ação na lista do TTARS com prazo hoje; às 18h o Coach pergunta se saiu (ou reconhece, se a ação já foi concluída).
 * Sem resposta não vira combinado e ninguém cobra. Sábado e domingo ficam fora (quem decide é o agendador).
 */
export type StatusCombinado = "proposto" | "aceito" | "feito" | "nao_deu" | "adiado" | "expirado" | "recusado";
export type Combinado = {
 id: string; dia: string; titulo: string; ate: string | null; objetivo_id: string | null; status: StatusCombinado; origem: "manha" | "conversa";
 tarefa_id: string | null; motivo: string | null; mensagem_id: string | null; proposto_em: string; aceito_em: string | null; resolvido_em: string | null;
};
type Linha = Omit<Combinado, "dia" | "proposto_em" | "aceito_em" | "resolvido_em"> & { dia: Date | string; proposto_em: Date | string; aceito_em: Date | string | null; resolvido_em: Date | string | null };
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
const daLinha = (r: Linha): Combinado => ({ ...r, dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia).slice(0, 10), proposto_em: iso(r.proposto_em)!, aceito_em: iso(r.aceito_em), resolvido_em: iso(r.resolvido_em) });
const COLUNAS = "id,dia,titulo,ate,objetivo_id,status,origem,tarefa_id,motivo,mensagem_id,proposto_em,aceito_em,resolvido_em";

export const diaLocal = (timezone: string, now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const diaSeguinte = (dia: string) => new Date(Date.parse(`${dia}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const somaDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();
/** Para quando vai o que ficou para depois: o dia seguinte; com o fim de semana desligado, sexta passa para segunda. */
export function proximoDiaDoCoach(dia: string, fimDeSemana: boolean) {
 let d = somaDias(dia, 1);
 while (!fimDeSemana && (diaDaSemana(d) === 0 || diaDaSemana(d) === 6)) d = somaDias(d, 1);
 return d;
}
/** O último dia em que o Coach falou antes deste (na segunda, a sexta). */
export function diaAnteriorDoCoach(dia: string, fimDeSemana: boolean) {
 let d = somaDias(dia, -1);
 while (!fimDeSemana && (diaDaSemana(d) === 0 || diaDaSemana(d) === 6)) d = somaDias(d, -1);
 return d;
}
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** "amanhã" ou "segunda, 05/10". */
export const diaFalado = (dia: string, hoje: string) => (dia === somaDias(hoje, 1) ? "amanhã" : `${SEMANA[diaDaSemana(dia)]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`);
/** Ligado só se a pessoa pediu mensagem no fim de semana (coluna da 024; sem ela, desligado). */
export async function fimDeSemanaLigado(userId: string): Promise<boolean> {
 try { return (await withTenant(userId, db => db.query<{ fim_de_semana: boolean }>("SELECT fim_de_semana FROM coach_profiles WHERE user_id=$1", [userId]))).rows[0]?.fim_de_semana === true; }
 catch { return false; }
}
export function fimDeSemana(timezone: string, now: Date) {
 const d = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
 return d === "Sat" || d === "Sun";
}

const limpo = (s: string, max: number) => s.replace(/\s+/g, " ").trim().replace(/[.!]+$/u, "").slice(0, max);
export function horaValida(v: unknown): string | null {
 if (typeof v !== "string") return null;
 const m = v.trim().match(/^(\d{1,2})(?::|h)?(\d{2})?$/u);
 if (!m) return null;
 const h = Number(m[1]), min = Number(m[2] ?? "0");
 return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}
const horaFalada = (ate: string | null) => (ate ? (ate.endsWith(":00") ? `${Number(ate.slice(0, 2))}h` : ate.replace(":", "h")) : null);
/** A frase do combinado como ele aparece nas mensagens. */
export const fraseDoCombinado = (c: Pick<Combinado, "titulo" | "ate">) => `${c.ate ? `até ${horaFalada(c.ate)}, ` : ""}${c.titulo[0].toLowerCase()}${c.titulo.slice(1)}`;

/** O combinado de hoje que ainda conta (o último proposto ou aceito; o expirado e o recusado não contam). */
export async function combinadoDoDia(userId: string, timezone: string, now = new Date()): Promise<Combinado | null> {
 return withTenant(userId, async db => {
  const r = (await db.query<Linha>(`SELECT ${COLUNAS} FROM coach_combinados WHERE user_id=$1 AND dia=$2::date AND status NOT IN ('expirado','recusado') ORDER BY proposto_em DESC LIMIT 1`, [userId, diaLocal(timezone, now)])).rows[0];
  return r ? daLinha(r) : null;
 });
}

export async function combinadoPorId(userId: string, id: string): Promise<Combinado | null> {
 return withTenant(userId, async db => { const r = (await db.query<Linha>(`SELECT ${COLUNAS} FROM coach_combinados WHERE user_id=$1 AND id=$2`, [userId, id])).rows[0]; return r ? daLinha(r) : null; });
}

/** Um proposto por dia: o novo substitui o que ainda não foi aceito. */
export async function proporCombinado(userId: string, novo: { titulo: string; ate?: string | null; objetivo_id?: string | null; origem: "manha" | "conversa"; mensagem_id?: string | null }, timezone: string, now = new Date()): Promise<Combinado> {
 const titulo = limpo(novo.titulo, 300);
 if (titulo.length < 3) throw new Error("combinado_sem_titulo");
 const dia = diaLocal(timezone, now);
 return withTenant(userId, async db => {
  await db.query("UPDATE coach_combinados SET status='expirado',updated_at=now() WHERE user_id=$1 AND dia=$2::date AND status='proposto'", [userId, dia]);
  const r = (await db.query<Linha>(`INSERT INTO coach_combinados(user_id,dia,titulo,ate,objetivo_id,origem,mensagem_id) VALUES($1,$2::date,$3,$4,$5,$6,$7) RETURNING ${COLUNAS}`,
   [userId, dia, titulo, horaValida(novo.ate ?? null), novo.objetivo_id ?? null, novo.origem, novo.mensagem_id ?? null])).rows[0];
  return daLinha(r);
 });
}

export async function ligarMensagem(userId: string, id: string, mensagemId: string) {
 await withTenant(userId, db => db.query("UPDATE coach_combinados SET mensagem_id=$3,updated_at=now() WHERE user_id=$1 AND id=$2", [userId, id, mensagemId]));
}

/** "ok": vira ação na lista, com prazo hoje e ligada ao foco, como a caixa "Nova ação" grava. */
export async function aceitarCombinado(user: User, c: Combinado): Promise<Combinado> {
 if (c.status !== "proposto") return c;
 const criada = await criarAcao(user, { titulo: c.titulo, prazo: c.dia, objetivo_id: c.objetivo_id, origem: "coach", prioridade: "alta", descricao: `Combinado com o Coach em ${c.dia.split("-").reverse().join("/")}${c.ate ? `, até ${horaFalada(c.ate)}` : ""}.` });
 // Objetivo que a pessoa não enxerga mais não impede o combinado: a ação nasce sem ele.
 const tarefa = criada.ok ? criada : await criarAcao(user, { titulo: c.titulo, prazo: c.dia, origem: "coach", prioridade: "alta" });
 const tarefaId = tarefa.ok ? tarefa.tarefa.id : null;
 return withTenant(user.id, async db => daLinha((await db.query<Linha>(`UPDATE coach_combinados SET status='aceito',aceito_em=now(),tarefa_id=$3,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING ${COLUNAS}`, [user.id, c.id, tarefaId])).rows[0]));
}

export async function recusarCombinado(userId: string, c: Combinado) {
 await withTenant(userId, db => db.query("UPDATE coach_combinados SET status='recusado',resolvido_em=now(),updated_at=now() WHERE user_id=$1 AND id=$2 AND status='proposto'", [userId, c.id]));
}

/** Combinado que a própria pessoa disse na conversa já nasce aceito. */
export async function combinarAgora(user: User, novo: { titulo: string; ate?: string | null; objetivo_id?: string | null }, timezone: string, now = new Date()) {
 return aceitarCombinado(user, await proporCombinado(user.id, { ...novo, origem: "conversa" }, timezone, now));
}

/**
 * O que a pessoa contou do combinado: feito conclui a ação; "amanhã" passa a ação e o combinado para o próximo dia
 * em que o Coach fala (na sexta, com o fim de semana desligado, segunda: senão a pergunta prometida nunca chega).
 */
export async function resolverCombinado(user: User, c: Combinado, resultado: "feito" | "nao_deu" | "adiado", motivo?: string | null): Promise<Combinado & { retomar_em: string | null }> {
 if (resultado === "feito" && c.tarefa_id) await mudarTarefa(user, c.tarefa_id, { status: "concluida" }).catch(() => null);
 const retomar = resultado === "adiado" ? proximoDiaDoCoach(c.dia, await fimDeSemanaLigado(user.id)) : null;
 if (retomar && c.tarefa_id) await mudarTarefa(user, c.tarefa_id, { prazo: retomar }).catch(() => null);
 return withTenant(user.id, async db => {
  const r = (await db.query<Linha>(`UPDATE coach_combinados SET status=$3,motivo=coalesce($4,motivo),resolvido_em=now(),updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING ${COLUNAS}`,
   [user.id, c.id, resultado, motivo ? limpo(motivo, 1000) : null])).rows[0];
  if (retomar) await db.query("INSERT INTO coach_combinados(user_id,dia,titulo,ate,objetivo_id,status,origem,tarefa_id,aceito_em) VALUES($1,$2::date,$3,$4,$5,'aceito','conversa',$6,now())",
   [user.id, retomar, c.titulo, c.ate, c.objetivo_id, c.tarefa_id]);
  return { ...daLinha(r), retomar_em: retomar };
 });
}

/** A ação concluída na tela também fecha o combinado. */
export async function sincronizarComTarefa(userId: string, c: Combinado | null): Promise<Combinado | null> {
 if (!c || c.status !== "aceito" || !c.tarefa_id) return c;
 return withTenant(userId, async db => {
  const t = (await db.query<{ status: string; concluida_em: Date | null }>("SELECT status,concluida_em FROM tarefas WHERE id=$1", [c.tarefa_id])).rows[0];
  if (t?.status !== "concluida") return c;
  const r = (await db.query<Linha>(`UPDATE coach_combinados SET status='feito',resolvido_em=coalesce($3,now()),updated_at=now() WHERE user_id=$1 AND id=$2 AND status='aceito' RETURNING ${COLUNAS}`, [userId, c.id, t.concluida_em])).rows[0];
  return r ? daLinha(r) : c;
 });
}

export const comMinuscula = (t: string) => `${t[0].toLowerCase()}${t.slice(1)}`;
/**
 * A promessa de quando o Coach volta ao combinado só sai se for cumprida: "Às 18h te pergunto." só antes da pergunta
 * das 18h de um dia em que ela roda (aceite às 19h ou no sábado não ganha promessa; a manhã seguinte retoma).
 */
export function promessaDas18h(timezone: string, now: Date, fimDeSemana18h: boolean, horaDaNoite = 18, ligada = true) {
 const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
 return ligada && (fimDeSemana18h || !fimDeSemana(timezone, now)) && hora < horaDaNoite ? `Às ${horaDaNoite}h te pergunto.` : "";
}

/** Já tem combinado aceito hoje: o passo novo dito na conversa vai para a lista, e o de hoje segue sendo o das 18h. */
export async function anotarNaLista(user: User, novo: { titulo: string; objetivo_id?: string | null }, timezone: string, now = new Date()) {
 const prazo = diaLocal(timezone, now);
 const r = await criarAcao(user, { titulo: novo.titulo, prazo, objetivo_id: novo.objetivo_id ?? null, origem: "coach", prioridade: "alta", descricao: "Passo dito na conversa com o Coach." });
 return r.ok ? r : criarAcao(user, { titulo: novo.titulo, prazo, origem: "coach", prioridade: "alta" });
}
/** A mensagem das 18h é escrita pelo servidor, sem IA: pergunta o combinado aceito ou reconhece o que já saiu. */
export function mensagemDas18h(c: Combinado | null): string | null {
 if (!c) return null;
 if (c.status === "feito") return `Vi que saiu o combinado de hoje: ${comMinuscula(c.titulo)}. Boa.`;
 if (c.status === "aceito") return `Combinado de hoje: ${comMinuscula(c.titulo)}.\n\nSaiu? Responda sim, não ou amanhã.`;
 return null;
}

export async function combinadosDoPeriodo(userId: string, de: string, ate: string): Promise<Combinado[]> {
 return withTenant(userId, async db => (await db.query<Linha>(`SELECT ${COLUNAS} FROM coach_combinados WHERE user_id=$1 AND dia>=$2::date AND dia<$3::date ORDER BY dia,proposto_em`, [userId, de, ate])).rows.map(daLinha));
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}👍 ]+/gu, " ").replace(/\s+/g, " ").trim();
/** Aceite curto da proposta das 8h ("ok", "fechado", "👍"). Frase maior vai para o Coach entender. */
export function eAceite(msg: string) {
 const s = norm(msg);
 return s.length <= 40 && /^(?:ok|okay|okk|blz|beleza|fechado|fechou|combinado|sim|s|pode|pode ser|bora|vamos|vamo|certo|ta|ta bom|ta certo|feito|show|perfeito|claro|com certeza|👍|ok 👍|sim pode|pode deixar|deixa comigo|vou fazer)(?: (?:sim|fechado|combinado|bora|pode|👍))*$/u.test(s);
}
export function eRecusa(msg: string) {
 const s = norm(msg);
 return s.length <= 40 && /^(?:nao|n|agora nao|hoje nao|nao da|nao vai dar|melhor nao|passo|pula|sem combinado)$/u.test(s);
}
/** Resposta curta à pergunta das 18h. */
export function resultadoCurto(msg: string): "feito" | "nao_deu" | "adiado" | null {
 const s = norm(msg);
 if (!s || s.length > 60) return null;
 if (/^(?:amanha|fica pra amanha|fica para amanha|adia|adia pra amanha|deixa pra amanha|passa pra amanha|amanha cedo|amanha eu faco)$/u.test(s)) return "adiado";
 if (/^(?:nao|n|nao deu|nao saiu|nao consegui|ainda nao|nao rolou|nao fiz)$/u.test(s)) return "nao_deu";
 if (/^(?:sim|s|saiu|fiz|feito|foi|deu|deu certo|consegui|ja fiz|ja foi|sim saiu|sim fiz|feito ja|pronto|ok feito|👍)$/u.test(s)) return "feito";
 return null;
}

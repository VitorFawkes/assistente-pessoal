import { withTenant } from "../db";

/**
 * O placar dos focos do Vitor (02/10/2026): contratos da Weddings no mês, as negociações dele como closer e as vendas
 * a convidados (hospedagem, passeio, presente e passagem). Quem calcula é o TTARS (função coach-placar-read, mesma ponte e mesmo token da
 * agenda); aqui só se lê, guarda cada leitura e entrega ao Coach. Leitura que falha nunca vira zero.
 */
export type Contrato = { casal: string; data: string; valor: number | null };
export type Negociacao = { casal: string; etapa: string; desde: string | null };
export type VendaConvidados = { quantidade: number; valor: number };
export type VendasDoMes = { hospedagem: VendaConvidados; passeio: VendaConvidados; presente: VendaConvidados; passagem: VendaConvidados };
export type Placar = {
 mes: string;
 atualizado_em: string;
 contratos: Contrato[];
 contratos_mes_anterior: number;
 carteira: Negociacao[];
 convidados: { mes: VendasDoMes; mes_anterior: VendasDoMes } | null;
 limitacoes: string[];
};
export type LeituraDoPlacar = { status: "ok" | "indisponivel" | "nao_configurado"; placar: Placar | null; de_quando: string | null };

const FRESCO_MS = 15 * 60_000;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function mesLocal(timezone: string, now: Date) {
 return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}
export const nomeDoMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
export function mesAnterior(mes: string) {
 const [a, m] = mes.split("-").map(Number);
 return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

function config() {
 const base = process.env.COACH_TTARS_CALENDAR_BASE_URL?.replace(/\/+$/, "");
 const token = process.env.COACH_TTARS_CALENDAR_TOKEN;
 if (!base || !token) return null;
 try { const url = new URL(base); if (url.protocol !== "https:" || !url.pathname.endsWith("/functions/v1")) return null; } catch { return null; }
 return { base, token };
}

const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const data = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
function venda(v: unknown): VendaConvidados | null {
 if (!v || typeof v !== "object") return null;
 const o = v as Record<string, unknown>;
 const quantidade = numero(o.quantidade), valor = numero(o.valor);
 return quantidade === null || valor === null || !Number.isInteger(quantidade) ? null : { quantidade, valor: Math.round(valor) };
}
function vendasDoMes(v: unknown): VendasDoMes | null {
 if (!v || typeof v !== "object") return null;
 const o = v as Record<string, unknown>;
 const hospedagem = venda(o.hospedagem), passeio = venda(o.passeio), presente = venda(o.presente), passagem = venda(o.passagem);
 return hospedagem && passeio && presente && passagem ? { hospedagem, passeio, presente, passagem } : null;
}

/** Só passa o que tem forma certa; qualquer peça errada derruba a leitura inteira (melhor "não consegui ler" que um zero falso). */
export function validarPlacar(raw: unknown, mes: string): Placar {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("placar_invalido");
 const o = raw as Record<string, unknown>;
 if (o.version !== 1 || o.mes !== mes || !data(o.atualizado_em)) throw new Error("placar_invalido");
 if (!Array.isArray(o.contratos) || !Array.isArray(o.carteira) || !Number.isInteger(o.contratos_mes_anterior) || (o.contratos_mes_anterior as number) < 0) throw new Error("placar_invalido");
 const contratos = o.contratos.slice(0, 60).map(c => {
  const x = (c ?? {}) as Record<string, unknown>;
  const casal = texto(x.casal, 120), quando = data(x.data);
  if (!casal || !quando) throw new Error("placar_invalido");
  return { casal, data: quando, valor: numero(x.valor) };
 });
 const carteira = o.carteira.slice(0, 40).map(n => {
  const x = (n ?? {}) as Record<string, unknown>;
  const casal = texto(x.casal, 120), etapa = texto(x.etapa, 80);
  if (!casal || !etapa) throw new Error("placar_invalido");
  return { casal, etapa, desde: data(x.desde) };
 });
 let convidados: Placar["convidados"] = null;
 if (o.convidados !== null && o.convidados !== undefined) {
  const c = o.convidados as Record<string, unknown>;
  const atual = vendasDoMes(c.mes), antes = vendasDoMes(c.mes_anterior);
  if (!atual || !antes) throw new Error("placar_invalido");
  convidados = { mes: atual, mes_anterior: antes };
 }
 const limitacoes = Array.isArray(o.limitacoes) ? o.limitacoes.map(l => texto(l, 200)).filter((l): l is string => !!l).slice(0, 6) : [];
 return { mes, atualizado_em: data(o.atualizado_em)!, contratos, contratos_mes_anterior: o.contratos_mes_anterior as number, carteira, convidados, limitacoes };
}

async function ultimaLeitura(userId: string, mes: string) {
 return withTenant(userId, async db => (await db.query<{ dados: unknown; capturado_em: Date }>(
  "SELECT dados,capturado_em FROM coach_placar WHERE user_id=$1 AND mes=$2 ORDER BY capturado_em DESC LIMIT 1", [userId, mes])).rows[0] ?? null);
}

/** Lê o placar do mês (no fuso da pessoa); a leitura dos últimos 15 minutos é reaproveitada. */
export async function lerPlacar(userId: string, timezone: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<LeituraDoPlacar> {
 const mes = mesLocal(timezone, now);
 const guardada = await ultimaLeitura(userId, mes).catch(() => null);
 if (guardada && now.getTime() - new Date(guardada.capturado_em).getTime() < FRESCO_MS) {
  try { return { status: "ok", placar: validarPlacar(guardada.dados, mes), de_quando: new Date(guardada.capturado_em).toISOString() }; } catch { /* lê de novo */ }
 }
 const cfg = config();
 if (!cfg) return { status: "nao_configurado", placar: null, de_quando: null };
 try {
  const res = await fetcher(`${cfg.base}/coach-placar-read?mes=${mes}`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!res.ok) throw new Error(`placar_${res.status}`);
  const placar = validarPlacar(await res.json(), mes);
  await withTenant(userId, db => db.query("INSERT INTO coach_placar(user_id,mes,dados) VALUES($1,$2,$3::jsonb)", [userId, mes, JSON.stringify({ version: 1, ...placar })])).catch(() => null);
  return { status: "ok", placar, de_quando: now.toISOString() };
 } catch {
  // A leitura antiga do mesmo mês ainda vale como "de quando" ela é; sem nenhuma, o Coach diz que não leu.
  if (guardada) { try { return { status: "ok", placar: validarPlacar(guardada.dados, mes), de_quando: new Date(guardada.capturado_em).toISOString() }; } catch { /* sem leitura */ } }
  return { status: "indisponivel", placar: null, de_quando: null };
 }
}

/** "Marcela & Luiza" vira "Marcela e Luiza" na mensagem (o & lido em voz alta e no WhatsApp fica estranho). */
export const nomeDoCasal = (casal: string) => casal.replace(/\s*&\s*/g, " e ").replace(/\s+/g, " ").trim();
const dia = (iso: string, timezone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(new Date(iso));
const reais = (n: number) => `R$ ${new Intl.NumberFormat("pt-BR").format(Math.round(n))}`;
const somaVendas = (v: VendasDoMes) => v.hospedagem.quantidade + v.passeio.quantidade + v.presente.quantidade + v.passagem.quantidade;
const ITENS = [["hospedagem", "hospedagem", "hospedagens"], ["passeio", "passeio", "passeios"], ["presente", "presente", "presentes"], ["passagem", "passagem", "passagens"]] as const;
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
/** "6 passeios" ou "57 hospedagens, 38 passeios, 42 presentes e 2 passagens": só o que vendeu, para a frase caber numa linha. */
const vendasEmTexto = (v: VendasDoMes) => juntar(ITENS.filter(([k]) => v[k].quantidade > 0).map(([k, um, varios]) => `${v[k].quantidade} ${v[k].quantidade === 1 ? um : varios}`)) || "nenhuma venda";

/** As frases prontas do placar: o Coach usa estas, com estes números, nunca recalcula. */
export function linhasDoPlacar(leitura: LeituraDoPlacar, meta: number | null, timezone: string): { contratos: string; convidados: string | null; negociacoes: string[]; resumo_contratos: string; resumo_convidados: string | null } | null {
 const p = leitura.placar;
 if (leitura.status !== "ok" || !p) return null;
 const n = p.contratos.length;
 const mes = nomeDoMes(p.mes), anterior = nomeDoMes(mesAnterior(p.mes));
 const nomes = n ? `: ${p.contratos.map(c => `${nomeDoCasal(c.casal)} (${dia(c.data, timezone)})`).join(", ")}` : "";
 const contratos = meta
  ? `${mes[0].toUpperCase()}${mes.slice(1)}: ${n} de ${meta} contratos${nomes}. ${anterior[0].toUpperCase()}${anterior.slice(1)} fechou em ${p.contratos_mes_anterior}.`
  : `${mes[0].toUpperCase()}${mes.slice(1)}: ${n} ${n === 1 ? "contrato" : "contratos"}${nomes}. ${anterior[0].toUpperCase()}${anterior.slice(1)} fechou em ${p.contratos_mes_anterior}.`;
 const c = p.convidados;
 const convidados = c ? `Vendas a convidados em ${mes}: ${vendasEmTexto(c.mes)}. ${anterior[0].toUpperCase()}${anterior.slice(1)}: ${vendasEmTexto(c.mes_anterior)}.` : null;
 const negociacoes = p.carteira.map(x => `${nomeDoCasal(x.casal)}: ${x.etapa}${x.desde ? ` desde ${dia(x.desde, timezone)}` : ""}`);
 const Mes = `${mes[0].toUpperCase()}${mes.slice(1)}`;
 const resumo_contratos = meta ? `${Mes}: ${n} de ${meta} contratos` : `${Mes}: ${n} ${n === 1 ? "contrato" : "contratos"}`;
 const resumo_convidados = c ? `${Mes}: ${vendasEmTexto(c.mes)}` : null;
 return { contratos, convidados, negociacoes, resumo_contratos, resumo_convidados };
}

/** O que o modelo lê do placar: os números já contados e as frases prontas. */
export function placarParaModelo(leitura: LeituraDoPlacar, meta: number | null, timezone: string) {
 const p = leitura.placar;
 if (leitura.status !== "ok" || !p) return { lido: false, aviso: leitura.status === "nao_configurado" ? "O placar de vendas ainda não está ligado." : "Não consegui ler o placar de vendas agora: não fale de números de venda." };
 const linhas = linhasDoPlacar(leitura, meta, timezone)!;
 const faltam = meta !== null ? Math.max(0, meta - p.contratos.length) : null;
 const c = p.convidados;
 return {
  lido: true,
  de_quando: leitura.de_quando,
  mes: nomeDoMes(p.mes),
  contratos_no_mes: p.contratos.length,
  meta_de_contratos: meta,
  faltam_para_a_meta: faltam,
  contratos_mes_anterior: p.contratos_mes_anterior,
  contratos: p.contratos.map(x => ({ casal: nomeDoCasal(x.casal), dia: dia(x.data, timezone), valor: x.valor === null ? null : reais(x.valor) })),
  negociacoes_do_vitor: p.carteira.map(x => ({ casal: nomeDoCasal(x.casal), etapa: x.etapa, desde: x.desde ? dia(x.desde, timezone) : null })),
  convidados: c ? {
   mes: { hospedagens: c.mes.hospedagem.quantidade, valor_hospedagens: reais(c.mes.hospedagem.valor), passeios: c.mes.passeio.quantidade, valor_passeios: reais(c.mes.passeio.valor), presentes: c.mes.presente.quantidade, valor_presentes: reais(c.mes.presente.valor), passagens: c.mes.passagem.quantidade, valor_passagens: reais(c.mes.passagem.valor), total_de_vendas: somaVendas(c.mes) },
   mes_anterior: { hospedagens: c.mes_anterior.hospedagem.quantidade, passeios: c.mes_anterior.passeio.quantidade, presentes: c.mes_anterior.presente.quantidade, passagens: c.mes_anterior.passagem.quantidade, total_de_vendas: somaVendas(c.mes_anterior) },
  } : null,
  frases_prontas: linhas,
  limitacoes: p.limitacoes,
 };
}

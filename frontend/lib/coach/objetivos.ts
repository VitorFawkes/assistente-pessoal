import { withTenant } from "../db";

/**
 * Os objetivos de trabalho do Coach são os Objetivos do TTARS (tela Ações → Objetivos), só os da própria pessoa e
 * não arquivados: um lugar só, que ela enxerga e corrige. Objetivo com medidor tem placar automático; o Coach escreve
 * a linha "Agora: …" no "Como medir", que a tela já mostra.
 */
export type Medidor = "contratos_ww_mes" | "convidados_site_mes";
export type ObjetivoDoCoach = { id: string; nome: string; como_medir: string | null; prazo: string | null; medidor: Medidor | null; meta: number | null };
export const MAX_OBJETIVOS = 3;

type Linha = { id: string; nome: string; como_medir: string | null; prazo: string | Date | null; medidor: Medidor | null; meta: string | number | null };
const daLinha = (r: Linha): ObjetivoDoCoach => ({
 id: r.id, nome: r.nome, como_medir: r.como_medir,
 prazo: r.prazo ? (r.prazo instanceof Date ? r.prazo.toISOString().slice(0, 10) : String(r.prazo).slice(0, 10)) : null,
 medidor: r.medidor, meta: r.meta === null || r.meta === undefined ? null : Number(r.meta),
});

export async function objetivosDoCoach(userId: string): Promise<ObjetivoDoCoach[]> {
 return withTenant(userId, async db => (await db.query<Linha>(
  "SELECT id,nome,como_medir,prazo,medidor,meta FROM objetivos WHERE user_id=$1 AND archived_at IS NULL ORDER BY created_at,id", [userId])).rows.map(daLinha));
}

const mesmoNome = (a: string, b: string) => a.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim() === b.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Cria (ou devolve o que já existe com o mesmo nome). Passou de MAX_OBJETIVOS: devolve null e quem chama pergunta qual sai. */
export async function criarObjetivo(userId: string, novo: { nome: string; como_medir?: string | null; medidor?: Medidor | null; meta?: number | null }): Promise<{ objetivo: ObjetivoDoCoach; criado: boolean } | null> {
 const nome = novo.nome.replace(/\s+/g, " ").trim().slice(0, 200);
 if (!nome) throw new Error("objetivo_sem_nome");
 return withTenant(userId, async db => {
  const atuais = (await db.query<Linha>("SELECT id,nome,como_medir,prazo,medidor,meta FROM objetivos WHERE user_id=$1 AND archived_at IS NULL FOR UPDATE", [userId])).rows;
  const igual = atuais.find(o => mesmoNome(o.nome, nome));
  if (igual) return { objetivo: daLinha(igual), criado: false };
  if (atuais.length >= MAX_OBJETIVOS) return null;
  const r = (await db.query<Linha>(`INSERT INTO objetivos(user_id,nome,como_medir,visibilidade,medidor,meta) VALUES($1,$2,$3,'so_eu',$4,$5)
   RETURNING id,nome,como_medir,prazo,medidor,meta`, [userId, nome, novo.como_medir?.trim().slice(0, 2000) || null, novo.medidor ?? null, novo.meta ?? null])).rows[0];
  return { objetivo: daLinha(r), criado: true };
 });
}

/** Tira o objetivo da lista (fica arquivado, dá para voltar na tela). */
export async function arquivarObjetivo(userId: string, id: string) {
 return withTenant(userId, async db => (await db.query("UPDATE objetivos SET archived_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 AND archived_at IS NULL", [id, userId])).rowCount === 1);
}

const AGORA = /^Agora:/u;
/** Troca só a linha "Agora: …" do "Como medir"; o que a pessoa escreveu fica. */
export function comoMedirComAgora(atual: string | null, linha: string) {
 const resto = (atual ?? "").split("\n").filter(l => !AGORA.test(l.trim())).join("\n").trim();
 return `${resto ? `${resto}\n` : ""}Agora: ${linha}`.slice(0, 2000);
}
export async function atualizarAgora(userId: string, objetivo: ObjetivoDoCoach, linha: string) {
 const novo = comoMedirComAgora(objetivo.como_medir, linha);
 if (novo === objetivo.como_medir) return false;
 return withTenant(userId, async db => (await db.query("UPDATE objetivos SET como_medir=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND archived_at IS NULL", [objetivo.id, userId, novo])).rowCount === 1);
}

export const metaDeContratos = (objs: ObjetivoDoCoach[]) => objs.find(o => o.medidor === "contratos_ww_mes")?.meta ?? null;

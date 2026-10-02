// Bateria do Assistente do Ações (plano do Vitor, 02/10/2026: "toda mudança passa por 60 perguntas reais antes de
// subir, meta de 95% certas"). Conversa de verdade com o modelo, como uma pessoa real, com o banco SÓ LEITURA: toda
// transação vira BEGIN READ ONLY e toda consulta solta roda dentro de uma, então nada grava (as mudanças pedidas
// falham no banco, e o que se confere é a ferramenta que o modelo escolheu e com quais campos). Só leitura por
// transação, de propósito: o banco passa por um agregador de conexões, e um SET de sessão ficaria na conexão
// emprestada e deixaria o sistema de verdade sem gravar.
//
// Roda dentro do servidor, numa imagem montada do código que se quer medir: veja rodar.sh. Os cenários usam os dados
// reais de quem está em USUARIO (padrão: Vitor); quando uma ação citada for concluída, ajuste o cenário.
import pg, { type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

type Cenario = {
  id: string;
  contexto?: Record<string, string>;
  perguntas: string[];
  /** As conferências valem para a resposta da última pergunta. */
  deve_chamar?: string[];
  nao_pode_chamar?: string[];
  deve_args?: { ferramenta: string; contem: string }[];
  nao_pode_args?: { ferramenta: string; contem: string }[];
  min_citadas?: number;
  max_citadas?: number;
  deve_citar?: string[];
  nao_pode_citar?: string[];
  texto_tem?: string[];
  texto_nao_tem?: string[];
  max_segundos?: number;
  /** Quantas vezes roda (cada vez conta na nota): o modelo varia, e 1 acerto em 3 passava como certo (02/10/2026).
   *  O padrão é BATERIA_VEZES (o rodar.sh usa 3). */
  vezes?: number;
  /** O entendimento pode parar para perguntar (aí as outras conferências não valem). */
  pode_perguntar?: boolean;
  /** Tem de perguntar antes de mudar. */
  deve_perguntar?: boolean;
};

type Chamada = { nome: string; args: string };
type Resposta = { texto: string; citadas: { titulo: string }[]; segundos: number; chamadas: Chamada[]; usd: number; perguntou: boolean };

// ── Banco só leitura ────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const conectar = pool.connect.bind(pool) as () => Promise<PoolClient>;
const travados = new WeakSet<PoolClient>();
function travar(c: PoolClient): PoolClient {
  if (!travados.has(c)) {
    const query = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
    (c as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (texto: unknown, ...resto: unknown[]) => {
      const sql = typeof texto === "string" ? texto : (texto as { text?: string } | null)?.text;
      return typeof sql === "string" && /^\s*BEGIN\s*;?\s*$/i.test(sql) ? query("BEGIN READ ONLY", ...resto) : query(texto, ...resto);
    };
    travados.add(c);
  }
  return c;
}
(pool as unknown as { connect: () => Promise<PoolClient> }).connect = async () => travar(await conectar());
(pool as unknown as { query: (t: unknown, v?: unknown[]) => Promise<unknown> }).query = async (texto: unknown, valores?: unknown[]) => {
  const c = travar(await conectar());
  try {
    await c.query("BEGIN READ ONLY");
    const r = await c.query(texto as string, valores);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};
(globalThis as unknown as { __pgPool: unknown }).__pgPool = pool;

// ── Cada ida à OpenAI: as ferramentas que o modelo pediu (por pergunta: as perguntas rodam em paralelo) ──────
const daPergunta = new AsyncLocalStorage<Chamada[]>();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const r = await fetchOriginal(url, init);
  const chamadas = daPergunta.getStore();
  if (chamadas && String(url).includes("api.openai.com/v1/responses")) {
    const d = (await r.clone().json().catch(() => null)) as { output?: { type: string; name?: string; arguments?: string }[] } | null;
    for (const it of d?.output ?? []) if (it.type === "function_call") chamadas.push({ nome: it.name ?? "", args: it.arguments ?? "" });
  }
  return r;
}) as typeof fetch;

const { query, withTenant } = await import("../../lib/db");
const { conversar } = await import("../../lib/agente");
const { listarProjetos } = await import("../../lib/projetos");
const { pessoasDaEquipe } = await import("../../lib/equipe-compartilhado");
const { timesDasPessoas } = await import("../../lib/hub");

const USUARIO = process.env.USUARIO || "39003bac-d22e-42e6-9aae-c332bd4bdf36";
const so = (await query<{ ro: string }>("SELECT current_setting('transaction_read_only') AS ro"))[0]?.ro;
let recusou = false;
await withTenant(USUARIO, (c) => c.query("UPDATE tarefas SET titulo = titulo WHERE false")).catch((e: Error) => {
  recusou = /read-only/i.test(e.message);
});
if (so !== "on" || !recusou) throw new Error("o banco não está só leitura: a bateria não roda");

const [user] = await query<Record<string, unknown>>(
  "SELECT id::text AS id, nome, email, whatsapp, is_admin, consent_terms_at, deleted_at FROM users WHERE id = $1",
  [USUARIO],
);
const req = new Request("http://acoes.interno/api/ttars/agente", { method: "POST" });

/** Contexto da tela pelo nome (reunião, projeto, time, pessoa) → ids, com a mesma regra de quem vê. */
async function resolver(ctx: Record<string, string>): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = { ...ctx };
  if (ctx.reuniao) {
    const r = await withTenant(USUARIO, async (c) => {
      await c.query("SELECT set_config('app.leitura_equipe', '1', true)");
      return c.query<{ id: string }>(
        "SELECT id::text AS id FROM meetings WHERE status != 'archived_session' AND nome ILIKE $1 ORDER BY coalesce(recorded_at, created_at) DESC LIMIT 1",
        [ctx.reuniao],
      );
    });
    out.reuniao_id = r.rows[0]?.id ?? null;
    delete out.reuniao;
  }
  if (ctx.projeto) {
    out.projeto_id = (await listarProjetos(USUARIO)).find((p) => p.nome === ctx.projeto)?.id ?? null;
    delete out.projeto;
  }
  if (ctx.time || ctx.pessoa) {
    const pessoas = await pessoasDaEquipe();
    if (ctx.time) {
      out.time_id = [...timesDasPessoas(pessoas).entries()].find(([, t]) => t.nome === ctx.time)?.[0] ?? null;
      delete out.time;
    }
    if (ctx.pessoa) {
      out.pessoa_email = pessoas.find((p) => p.nome.startsWith(ctx.pessoa))?.email ?? null;
      delete out.pessoa;
    }
  }
  return out;
}

/** O que falhou na resposta, frente ao que o cenário espera ([] = passou). */
function conferir(c: Cenario, r: Resposta): string[] {
  const falhas: string[] = [];
  if (c.deve_perguntar) return r.perguntou ? [] : ["não perguntou antes de mudar"];
  if (r.perguntou) return c.pode_perguntar ? [] : ["perguntou sem precisar"];
  // Ferramenta pode vir como alternativa: "mudar_acao|mudar_varias".
  const e = (nome: string, padrao: string) => padrao.split("|").includes(nome);
  const titulos = r.citadas.map((x) => x.titulo.toLowerCase());
  for (const f of c.deve_chamar ?? []) if (!r.chamadas.some((x) => e(x.nome, f))) falhas.push(`não chamou ${f}`);
  for (const f of c.nao_pode_chamar ?? []) if (r.chamadas.some((x) => e(x.nome, f))) falhas.push(`chamou ${f}`);
  for (const a of c.deve_args ?? []) {
    if (!r.chamadas.some((x) => e(x.nome, a.ferramenta) && x.args.includes(a.contem))) falhas.push(`${a.ferramenta} sem ${a.contem}`);
  }
  for (const a of c.nao_pode_args ?? []) {
    if (r.chamadas.some((x) => e(x.nome, a.ferramenta) && x.args.includes(a.contem))) falhas.push(`${a.ferramenta} com ${a.contem}`);
  }
  if (c.min_citadas !== undefined && r.citadas.length < c.min_citadas) falhas.push(`${r.citadas.length} na tela (mín ${c.min_citadas})`);
  if (c.max_citadas !== undefined && r.citadas.length > c.max_citadas) falhas.push(`${r.citadas.length} na tela (máx ${c.max_citadas})`);
  for (const t of c.deve_citar ?? []) if (!titulos.some((x) => x.includes(t.toLowerCase()))) falhas.push(`faltou "${t}"`);
  for (const t of c.nao_pode_citar ?? []) if (titulos.some((x) => x.includes(t.toLowerCase()))) falhas.push(`citou "${t}"`);
  for (const t of c.texto_tem ?? []) if (!new RegExp(t, "i").test(r.texto)) falhas.push(`texto sem /${t}/`);
  for (const t of c.texto_nao_tem ?? []) if (new RegExp(t, "i").test(r.texto)) falhas.push(`texto com /${t}/`);
  if (c.max_segundos !== undefined && r.segundos > c.max_segundos) falhas.push(`${r.segundos} s (máx ${c.max_segundos})`);
  return falhas;
}

const cenarios = JSON.parse(readFileSync(process.argv[2], "utf8")) as Cenario[];
const escolhidos = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const VEZES = Math.max(1, Number(process.env.BATERIA_VEZES || 1));
const PARALELO = Math.max(1, Number(process.env.BATERIA_PARALELO || 1));
const fila = cenarios
  .filter((c) => !escolhidos || escolhidos.has(c.id))
  .flatMap((c) => Array.from({ length: Math.max(c.vezes ?? 1, VEZES) }, () => c));
let passaram = 0;
let usd = 0;

async function rodar(c: Cenario): Promise<void> {
  const contexto = await resolver(c.contexto ?? {});
  const falas: { quem: "pessoa" | "assistente"; texto: string; acoes?: string[] }[] = [];
  let ultima: Resposta | null = null;
  let erro: string | null = null;
  for (const p of c.perguntas) {
    falas.push({ quem: "pessoa", texto: p });
    const chamadas: Chamada[] = [];
    const t0 = Date.now();
    try {
      const r = await daPergunta.run(chamadas, () => conversar(user as never, req, { falas, contexto, workspace: "welcome-trips" }));
      const acoes = [...new Set([...r.citadas.map((x) => x.id), ...r.feitas.map((f) => f.tarefa_id), ...r.propostas.map((x) => x.tarefa_id)])];
      falas.push({ quem: "assistente", texto: r.texto, acoes: acoes.filter((x): x is string => !!x) });
      ultima = {
        texto: r.texto,
        citadas: r.citadas,
        segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
        chamadas,
        usd: r.custo_usd,
        perguntou: r.perguntou === true,
      };
      usd += r.custo_usd;
    } catch (e) {
      erro = (e as Error).message;
      break;
    }
  }
  const falhas = erro ? [`caiu: ${erro}`] : conferir(c, ultima!);
  if (!falhas.length) passaram++;
  console.log(
    JSON.stringify({
      cenario: c.id,
      passou: !falhas.length,
      falhas,
      segundos: ultima?.segundos ?? null,
      na_tela: ultima?.citadas.length ?? 0,
      perguntou: ultima?.perguntou ?? false,
      ferramentas: ultima?.chamadas.map((x) => x.nome) ?? [],
      texto: ultima?.texto.slice(0, 400) ?? null,
    }),
  );
}

let proximo = 0;
await Promise.all(
  Array.from({ length: PARALELO }, async () => {
    while (proximo < fila.length) await rodar(fila[proximo++]);
  }),
);
const total = fila.length;
const nota = total ? Math.round((passaram / total) * 100) : 0;
console.log(JSON.stringify({ resultado: `${passaram} de ${total} certos`, nota, usd: Number(usd.toFixed(4)) }));
process.exit(nota >= 95 ? 0 : 1);

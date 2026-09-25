// Sincronização Ações ↔ Notion do marketing (bloco 4, pedido do Vitor 25/09/2026).
//
// Roda a cada minuto (cron do servidor → /api/internal/notion/sincronizar):
//   1. puxa as páginas editadas no Notion desde a última rodada (com folga de 3 min, porque o
//      Notion marca a hora da edição só até o minuto) e compara campo a campo com o que valia
//      na última sincronização — o que mudou lá vem pra cá, o que mudou aqui vai pra lá;
//   2. empurra o que mudou nas ações ligadas e ainda não foi pro Notion;
//   3. cria no Notion as ações que alguém mandou pra lá de propósito (notion_envios).
// Cada página fica presa a UMA ação (notion_paginas.page_id e .tarefa_id são únicos): nada se
// duplica. As tarefas que nascem no Notion ficam com a "pessoa" Marketing (Notion) e aparecem
// no projeto Marketing; a de quem está no TTARS vai também pra lista dessa pessoa.
import type { PoolClient } from "pg";
import { query, withTenant } from "./db";
import { garantirColegaDoTtars, registrarEvento } from "./equipe-compartilhado";
import { quadrosFor, type Quadro } from "./quadros";
import { tarefasFor } from "./queries";
import { getOwnerSlug } from "./owner-slug";
import { ErroDoNotion, criarPagina, lerBase, lerPaginaDoNotion, mudarPagina, paginasEditadas, quemSouEu } from "./notion-api";
import { CHAVES, decidir, lerPagina, nomeLimpo, propriedadesPara, statusParaNotion, type Campos, type PaginaLida } from "./notion-mapa";
import { slugNome } from "./compartilhar";
import { diaBR, ehDataValida, fimDoDiaBR } from "./data-br";

/** A base "Tasks" do Notion do marketing (link visto no Notion do Vitor, 25/09/2026). */
export const BASE_DO_MARKETING = "3d6d6db4-1ae7-8062-b937-e865b2e9cf72";
const NOME_DO_DONO = "Marketing (Notion)";

export type Conexao = {
  id: string;
  token: string;
  database_id: string;
  data_source_id: string;
  bot_id: string | null;
  nome_base: string | null;
  quadro_id: string | null;
  dono_user_id: string;
  ligado_por: string | null;
  cursor_editado: string | null;
  ultima_rodada: string | null;
  ultimo_erro: string | null;
};

type Link = {
  page_id: string;
  tarefa_id: string;
  tarefa_dono_id: string;
  status_notion: string | null;
  ultimos: Partial<Campos>;
  sincronizado_em: string;
};

type PessoaNotion = { notion_user_id: string; nome: string; email: string | null; user_id: string | null };

type TarefaCrua = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | Date | null;
  status: Campos["status"];
  prioridade: Campos["prioridade"];
  owner: string;
  acao: string;
  responsavel_user_id: string | null;
  updated_at: string | Date;
};

/** Enquanto as tabelas do Notion não existem no banco, tudo aqui age como "Notion desligado". */
const semTabela = (e: unknown) => (e as { code?: string })?.code === "42P01";

export async function conexaoAtiva(): Promise<Conexao | null> {
  try {
    const r = await query<Conexao>(`SELECT * FROM notion_conexoes WHERE ativo ORDER BY ligado_em DESC LIMIT 1`);
    return r[0] ?? null;
  } catch (e) {
    if (semTabela(e)) return null;
    throw e;
  }
}

/** Dia de Brasília de um prazo (ou "" sem prazo). */
const diaDoPrazo = (v: string | Date | null): string => (v && ehDataValida(v) ? diaBR(v) : "");
/** Dia → instante que o Ações grava: 23:59 daquele dia em Brasília. */
const prazoDoDia = (dia: string): string | null => (dia ? fimDoDiaBR(dia) : null);
const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);

// ── ligar ──────────────────────────────────────────────────────────────────────────────

/** O admin cola o segredo da conexão: confere no Notion, cria o projeto Marketing e puxa tudo. */
export async function ligarNotion(adminId: string, token: string, databaseId = BASE_DO_MARKETING) {
  const pronto = await query<{ ok: boolean }>(`SELECT to_regclass('public.notion_conexoes') IS NOT NULL AS ok`);
  if (!pronto[0]?.ok) throw new Error("O banco do Ações ainda não foi preparado para o Notion.");
  const eu = await quemSouEu(token);
  const base = await lerBase(token, databaseId);
  const existente = await conexaoAtiva();
  if (existente) {
    await query(`UPDATE notion_conexoes SET token = $2, bot_id = $3, ultimo_erro = NULL WHERE id = $1`, [existente.id, token, eu.id]);
    await sincronizar();
    return { nome_base: base.nome, quadro_id: existente.quadro_id };
  }
  // A "pessoa" dona das tarefas que nascem no Notion (não entra no Ações; só guarda as tarefas).
  const dono = (
    await query<{ id: string }>(
      `INSERT INTO users (nome, email, is_admin, consent_terms_at) VALUES ($1, NULL, false, now()) RETURNING id`,
      [NOME_DO_DONO],
    )
  )[0].id;
  const quadro: Quadro = await quadrosFor(dono).criar(
    "Marketing (Notion)",
    "As tarefas do Notion do marketing, sempre iguais às de lá. O que você pedir a alguém do marketing aparece aqui também.",
  );
  await withTenant(dono, (c) =>
    c.query(`INSERT INTO quadro_membros (quadro_id, user_id, adicionado_por) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
      quadro.id,
      adminId,
    ]),
  );
  await query(
    `INSERT INTO notion_conexoes (token, database_id, data_source_id, bot_id, nome_base, quadro_id, dono_user_id, ligado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [token, databaseId, base.dataSourceId, eu.id, base.nome, quadro.id, dono, adminId],
  );
  await sincronizar();
  return { nome_base: base.nome, quadro_id: quadro.id };
}

// ── pessoas ────────────────────────────────────────────────────────────────────────────

async function pessoasDaConexao(c: Conexao): Promise<Map<string, PessoaNotion>> {
  const r = await query<PessoaNotion>(
    `SELECT notion_user_id, nome, email, user_id::text AS user_id FROM notion_pessoas WHERE conexao_id = $1`,
    [c.id],
  );
  return new Map(r.map((p) => [p.notion_user_id, p]));
}

/** Quem aparece nas tarefas do Notion: se é da Welcome no TTARS (e-mail ou nome inteiro), vira colega no Ações. */
async function registrarPessoas(c: Conexao, pessoas: { id: string; nome: string; email: string | null }[]) {
  const vistas = new Map(pessoas.map((p) => [p.id, p]));
  for (const p of vistas.values()) {
    let email = p.email;
    if (!email) {
      const r = await query<{ email: string; nome: string }>(`SELECT email, nome FROM ttars_pessoas WHERE organizacao <> ''`);
      const alvo = slugNome(nomeLimpo(p.nome));
      const achadas = r.filter((x) => slugNome(x.nome) === alvo);
      if (achadas.length === 1) email = achadas[0].email;
    }
    const colega = email ? await garantirColegaDoTtars(email) : null;
    await query(
      `INSERT INTO notion_pessoas (conexao_id, notion_user_id, nome, email, user_id, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (conexao_id, notion_user_id) DO UPDATE
         SET nome = EXCLUDED.nome, email = COALESCE(EXCLUDED.email, notion_pessoas.email),
             user_id = COALESCE(EXCLUDED.user_id, notion_pessoas.user_id), atualizado_em = now()`,
      [c.id, p.id, nomeLimpo(p.nome) || "Pessoa do Notion", email, colega?.id ?? null],
    );
    // Quem é do TTARS entra no projeto Marketing (vê tudo quando for liberado no Ações).
    if (colega && c.quadro_id) {
      await withTenant(c.dono_user_id, (db) =>
        db.query(
          `INSERT INTO quadro_membros (quadro_id, user_id, adicionado_por) VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
          [c.quadro_id, colega.id],
        ),
      );
    }
  }
}

/** A pessoa do Notion de uma ação: quem a recebeu no Ações, ou o nome de quem faz. */
function pessoaDaAcao(t: TarefaCrua, pessoas: Map<string, PessoaNotion>, antes: string | undefined): string {
  const lista = [...pessoas.values()];
  if (t.responsavel_user_id) {
    const p = lista.find((x) => x.user_id === t.responsavel_user_id);
    if (p) return p.notion_user_id;
  }
  const alvo = slugNome(t.owner);
  const porNome = lista.find((x) => slugNome(x.nome) === alvo || slugNome(x.nome).split("-")[0] === alvo);
  if (porNome) return porNome.notion_user_id;
  // Passada pra alguém fora do marketing: no Notion continua quem estava.
  return antes ?? "";
}

function camposDaAcao(t: TarefaCrua, pessoas: Map<string, PessoaNotion>, antes: Partial<Campos>): Campos {
  return {
    titulo: t.titulo,
    descricao: (t.descricao ?? "").trim(),
    prazo: diaDoPrazo(t.prazo),
    status: t.status,
    prioridade: t.prioridade,
    pessoa: pessoaDaAcao(t, pessoas, antes.pessoa),
  };
}

async function lerAcao(donoId: string, tarefaId: string): Promise<TarefaCrua | null> {
  const r = await withTenant(donoId, (c) =>
    c.query<TarefaCrua>(
      `SELECT id, titulo, descricao, prazo, status, prioridade, owner, acao, responsavel_user_id::text AS responsavel_user_id, updated_at
         FROM tarefas WHERE id = $1`,
      [tarefaId],
    ),
  );
  return r.rows[0] ?? null;
}

/** Aplica na ação o que mudou no Notion (no tenant de quem é a ação). */
async function aplicarNaAcao(
  c: Conexao,
  link: { tarefa_id: string; tarefa_dono_id: string },
  mudanca: Partial<Campos>,
  pessoas: Map<string, PessoaNotion>,
  editor: string | null,
) {
  const sets: string[] = [];
  const valores: unknown[] = [];
  const por = (col: string, v: unknown) => {
    valores.push(v);
    sets.push(`${col} = $${valores.length}`);
  };
  if (mudanca.titulo !== undefined) por("titulo", mudanca.titulo);
  if (mudanca.descricao !== undefined) por("descricao", mudanca.descricao || null);
  if (mudanca.prazo !== undefined) por("prazo", prazoDoDia(mudanca.prazo));
  if (mudanca.prioridade !== undefined) por("prioridade", mudanca.prioridade);
  if (mudanca.status !== undefined) {
    por("status", mudanca.status);
    sets.push("situacao_desde = now()");
    if (mudanca.status === "concluida") sets.push("concluida_em = now()");
    else if (mudanca.status === "cancelada") sets.push("cancelada_em = now()");
    else sets.push("concluida_em = NULL", "cancelada_em = NULL");
  }
  let nomeDono: string | null = null;
  if (mudanca.pessoa !== undefined) {
    const p = mudanca.pessoa ? pessoas.get(mudanca.pessoa) : undefined;
    if (!p) {
      por("owner", "?");
      por("acao", "cobrar");
      por("responsavel_user_id", null);
    } else if (p.user_id && p.user_id === link.tarefa_dono_id) {
      por("owner", getOwnerSlug());
      por("acao", "executar");
      por("responsavel_user_id", null);
    } else {
      por("owner", p.nome);
      por("acao", "cobrar");
      por("responsavel_user_id", p.user_id);
      nomeDono = p.nome;
    }
  }
  if (!sets.length) return;
  await withTenant(link.tarefa_dono_id, async (db: PoolClient) => {
    valores.push(link.tarefa_id);
    await db.query(`UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${valores.length}`, valores);
    if (mudanca.pessoa !== undefined) {
      await db.query(`UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1`, [link.tarefa_id]);
      if (nomeDono) {
        const pr = await db.query<{ id: string }>(
          `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
           ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
          [link.tarefa_dono_id, nomeDono],
        );
        await db.query(
          `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,true)
           ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
          [link.tarefa_id, pr.rows[0].id],
        );
      }
    }
    await registrarEvento(
      db,
      link.tarefa_id,
      mudanca.status === "concluida" ? "concluida" : mudanca.status === "cancelada" ? "cancelada" : "editada",
      { origem: "notion", por: editor, changed: Object.fromEntries(Object.keys(mudanca).map((k) => [k, true])) },
      null,
    );
  });
}

// ── puxar ──────────────────────────────────────────────────────────────────────────────

async function linkDaPagina(pageId: string): Promise<Link | null> {
  const r = await query<Link>(
    `SELECT page_id, tarefa_id::text AS tarefa_id, tarefa_dono_id::text AS tarefa_dono_id, status_notion, ultimos, sincronizado_em
       FROM notion_paginas WHERE page_id = $1`,
    [pageId],
  );
  return r[0] ?? null;
}

const soCampos = (x: Partial<Campos>): Partial<Campos> =>
  Object.fromEntries(CHAVES.filter((k) => k in x).map((k) => [k, x[k]])) as Partial<Campos>;

async function gravarLink(
  c: Conexao,
  p: PaginaLida,
  link: { tarefa_id: string; tarefa_dono_id: string },
  ultimos: Campos,
  statusNotion: string,
) {
  await query(
    `INSERT INTO notion_paginas (page_id, conexao_id, tarefa_id, tarefa_dono_id, url, status_notion, bu, ultimos, editado_notion, editado_por, sincronizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (page_id) DO UPDATE SET url = EXCLUDED.url, status_notion = EXCLUDED.status_notion, bu = EXCLUDED.bu,
       ultimos = EXCLUDED.ultimos, editado_notion = EXCLUDED.editado_notion, editado_por = EXCLUDED.editado_por, sincronizado_em = now()`,
    [p.pageId, c.id, link.tarefa_id, link.tarefa_dono_id, p.url, statusNotion, p.bu, JSON.stringify(soCampos(ultimos)), p.editadoEm, p.editadoPor],
  );
}

async function colocarNoProjeto(c: Conexao, tarefaId: string) {
  if (!c.quadro_id) return;
  await withTenant(c.dono_user_id, (db) =>
    db.query(`INSERT INTO quadro_tarefas (quadro_id, tarefa_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [c.quadro_id, tarefaId]),
  );
}

/** Página do Notion que ainda não é ação: vira uma, da pessoa Marketing (Notion). */
async function criarAcaoDaPagina(c: Conexao, p: PaginaLida, pessoas: Map<string, PessoaNotion>) {
  const quem = p.pessoa ? pessoas.get(p.pessoa) : undefined;
  const criada = await tarefasFor(c.dono_user_id).criar(
    {
      titulo: p.titulo,
      descricao: p.descricao || null,
      owner: quem?.nome ?? "?",
      acao: "cobrar",
      prazo: prazoDoDia(p.prazo),
      prioridade: p.prioridade,
      pessoas: quem ? [{ nome: quem.nome, principal: true }] : [],
    },
    { origem: "notion" },
  );
  await withTenant(c.dono_user_id, (db) =>
    db.query(
      `UPDATE tarefas SET status = $2, responsavel_user_id = $3,
              concluida_em = CASE WHEN $2 = 'concluida' THEN now() END
        WHERE id = $1`,
      [criada.id, p.status, quem?.user_id ?? null],
    ),
  );
  await colocarNoProjeto(c, criada.id);
  await gravarLink(c, p, { tarefa_id: criada.id, tarefa_dono_id: c.dono_user_id }, p, p.statusNotion);
}

async function tratarPagina(c: Conexao, p: PaginaLida, pessoas: Map<string, PessoaNotion>) {
  const link = await linkDaPagina(p.pageId);
  if (!link) {
    if (!p.noLixo) await criarAcaoDaPagina(c, p, pessoas);
    return;
  }
  const t = await lerAcao(link.tarefa_dono_id, link.tarefa_id);
  if (!t) {
    // A ação foi apagada no Ações: a página vai pra lixeira do Notion (dá pra recuperar lá).
    if (!p.noLixo) await mudarPagina(c.token, p.pageId, { in_trash: true });
    await query(`DELETE FROM notion_paginas WHERE page_id = $1`, [p.pageId]);
    return;
  }
  const noNotion: Campos = { ...p, status: p.noLixo ? "cancelada" : p.status };
  const noAcoes = camposDaAcao(t, pessoas, link.ultimos);
  const d = decidir(noNotion, noAcoes, link.ultimos, { notion: p.editadoEm, acoes: iso(t.updated_at) });
  const editor = p.editadoPor ? (pessoas.get(p.editadoPor)?.nome ?? null) : null;
  if (Object.keys(d.paraAcoes).length) await aplicarNaAcao(c, link, d.paraAcoes, pessoas, editor);
  let statusNotion = p.statusNotion;
  let editadoEm = p.editadoEm;
  if (Object.keys(d.paraNotion).length) {
    const r = await empurrarCampos(c, p.pageId, d.paraNotion, p.statusNotion);
    statusNotion = r.statusNotion;
    editadoEm = r.editadoEm ?? editadoEm;
  }
  const valendo: Campos = { ...noAcoes, ...d.paraAcoes, ...d.paraNotion } as Campos;
  await gravarLink(c, { ...p, editadoEm }, link, valendo, statusNotion);
}

/** Grava no Notion; cancelada vai pra lixeira, reaberta volta dela. */
async function empurrarCampos(c: Conexao, pageId: string, mudanca: Partial<Campos>, statusAnterior: string | null) {
  const { status, ...resto } = mudanca;
  const vaiProLixo = status === "cancelada";
  const props = propriedadesPara(status && !vaiProLixo ? { ...resto, status } : resto, { statusAnterior });
  const pg = await mudarPagina(c.token, pageId, {
    ...(Object.keys(props).length ? { properties: props } : {}),
    ...(vaiProLixo ? { in_trash: true } : status ? { in_trash: false } : {}),
  });
  return {
    statusNotion: status && !vaiProLixo ? (statusParaNotion(status, statusAnterior) ?? statusAnterior ?? "") : (statusAnterior ?? ""),
    editadoEm: pg?.last_edited_time ?? null,
  };
}

// Página que vai pra lixeira do Notion some da consulta. A cada 10 minutos a base é lida
// inteira e quem está ligado mas não veio é conferido um a um (lixeira → ação cancelada).
let ultimaVarreduraCompleta = 0;

async function conferirLixeira(c: Conexao, vivas: Set<string>, pessoas: Map<string, PessoaNotion>) {
  const links = await query<{ page_id: string }>(`SELECT page_id FROM notion_paginas WHERE conexao_id = $1`, [c.id]);
  for (const l of links) {
    if (vivas.has(l.page_id)) continue;
    const pg = await lerPaginaDoNotion(c.token, l.page_id).catch((e) => {
      // Sumiu de vez ou a conexão perdeu a página: não mexe na ação (evita cancelar em massa).
      if (e instanceof ErroDoNotion && e.status === 404) return null;
      throw e;
    });
    if (pg) await tratarPagina(c, lerPagina(pg), pessoas);
  }
}

async function puxar(c: Conexao, pessoas: Map<string, PessoaNotion>): Promise<Map<string, PessoaNotion>> {
  const completa = !c.cursor_editado || Date.now() - ultimaVarreduraCompleta > 10 * 60_000;
  const desde = completa ? null : new Date(Date.parse(c.cursor_editado!) - 3 * 60_000).toISOString();
  const paginas = (await paginasEditadas(c.token, c.data_source_id, desde)).map(lerPagina);
  const novasPessoas = paginas.flatMap((p) => p.pessoas).filter((x) => !pessoas.has(x.id));
  if (novasPessoas.length) {
    await registrarPessoas(c, novasPessoas);
    pessoas = await pessoasDaConexao(c);
  }
  let maior = c.cursor_editado;
  for (const p of paginas) {
    await tratarPagina(c, p, pessoas);
    if (!maior || p.editadoEm > maior) maior = p.editadoEm;
  }
  if (maior && maior !== c.cursor_editado) await query(`UPDATE notion_conexoes SET cursor_editado = $2 WHERE id = $1`, [c.id, maior]);
  if (completa && paginas.length > 0) {
    await conferirLixeira(c, new Set(paginas.map((p) => p.pageId)), pessoas);
    ultimaVarreduraCompleta = Date.now();
  }
  return pessoas;
}

// ── empurrar o que mudou no Ações ─────────────────────────────────────────────────────

async function empurrar(c: Conexao, pessoas: Map<string, PessoaNotion>) {
  const links = await query<Link>(
    `SELECT page_id, tarefa_id::text AS tarefa_id, tarefa_dono_id::text AS tarefa_dono_id, status_notion, ultimos, sincronizado_em
       FROM notion_paginas WHERE conexao_id = $1`,
    [c.id],
  );
  const porDono = new Map<string, Link[]>();
  for (const l of links) porDono.set(l.tarefa_dono_id, [...(porDono.get(l.tarefa_dono_id) ?? []), l]);
  for (const [dono, lista] of porDono) {
    const ids = lista.map((l) => l.tarefa_id);
    const r = await withTenant(dono, (db) =>
      db.query<TarefaCrua>(
        `SELECT id::text AS id, titulo, descricao, prazo, status, prioridade, owner, acao,
                responsavel_user_id::text AS responsavel_user_id, updated_at
           FROM tarefas WHERE id = ANY($1::uuid[])`,
        [ids],
      ),
    );
    const vivas = new Map(r.rows.map((t) => [t.id, t]));
    for (const l of lista) {
      const t = vivas.get(l.tarefa_id);
      if (!t) {
        // Apagada no Ações → lixeira do Notion.
        await mudarPagina(c.token, l.page_id, { in_trash: true }).catch(() => undefined);
        await query(`DELETE FROM notion_paginas WHERE page_id = $1`, [l.page_id]);
        continue;
      }
      if (Date.parse(iso(t.updated_at)) <= Date.parse(iso(l.sincronizado_em))) continue;
      const agora = camposDaAcao(t, pessoas, l.ultimos);
      const mudou: Partial<Campos> = {};
      for (const [k, v] of Object.entries(agora) as [keyof Campos, string][]) {
        if (String(l.ultimos[k] ?? "") !== String(v ?? "")) (mudou as Record<string, unknown>)[k] = v;
      }
      if (!Object.keys(mudou).length) {
        await query(`UPDATE notion_paginas SET sincronizado_em = now() WHERE page_id = $1`, [l.page_id]);
        continue;
      }
      const res = await empurrarCampos(c, l.page_id, mudou, l.status_notion);
      await query(
        `UPDATE notion_paginas SET ultimos = $2, status_notion = $3, editado_notion = COALESCE($4, editado_notion), sincronizado_em = now()
          WHERE page_id = $1`,
        [l.page_id, JSON.stringify({ ...l.ultimos, ...mudou }), res.statusNotion, res.editadoEm],
      );
    }
  }
}

// ── mandar pro Notion ─────────────────────────────────────────────────────────────────

async function enviar(c: Conexao, pessoas: Map<string, PessoaNotion>) {
  const pendentes = await query<{
    tarefa_id: string;
    tarefa_dono_id: string;
    notion_user_id: string | null;
    bu: string | null;
    pedido_por: string | null;
    tentativas: number;
  }>(
    `SELECT e.tarefa_id::text AS tarefa_id, e.tarefa_dono_id::text AS tarefa_dono_id, e.notion_user_id, e.bu,
            e.pedido_por::text AS pedido_por, e.tentativas
       FROM notion_envios e
      WHERE e.conexao_id = $1 AND e.tentativas < 5
        AND NOT EXISTS (SELECT 1 FROM notion_paginas p WHERE p.tarefa_id = e.tarefa_id)`,
    [c.id],
  );
  for (const e of pendentes) {
    try {
      const t = await lerAcao(e.tarefa_dono_id, e.tarefa_id);
      if (!t) {
        await query(`DELETE FROM notion_envios WHERE tarefa_id = $1`, [e.tarefa_id]);
        continue;
      }
      const campos = camposDaAcao(t, pessoas, { pessoa: e.notion_user_id ?? undefined });
      if (e.notion_user_id) campos.pessoa = e.notion_user_id;
      const quem = e.pedido_por
        ? (await query<{ nome: string }>(`SELECT nome FROM users WHERE id = $1`, [e.pedido_por]))[0]?.nome
        : null;
      const pg = await criarPagina(
        c.token,
        c.data_source_id,
        propriedadesPara(campos, { bu: e.bu ?? "Institucional" }),
        `Pedido por ${quem ?? "alguém"} no Ações.`,
      );
      const lida = lerPagina(pg);
      // Vínculo gravado logo depois de criar: a página nova nunca vira uma segunda ação.
      await gravarLink(c, lida, { tarefa_id: t.id, tarefa_dono_id: e.tarefa_dono_id }, campos, lida.statusNotion);
      await query(`DELETE FROM notion_envios WHERE tarefa_id = $1`, [e.tarefa_id]);
      await colocarNoProjeto(c, t.id).catch(() => undefined);
    } catch (err) {
      await query(`UPDATE notion_envios SET tentativas = tentativas + 1, erro = $2 WHERE tarefa_id = $1`, [
        e.tarefa_id,
        err instanceof Error ? err.message.slice(0, 500) : String(err),
      ]);
    }
  }
}

/** Pede pra mandar a ação pro Notion (alguém escolheu uma pessoa do marketing ou apertou o botão). */
export async function pedirEnvio(opts: {
  tarefaId: string;
  donoId: string;
  pedidoPor: string;
  notionUserId?: string | null;
  bu?: string | null;
}): Promise<boolean> {
  const c = await conexaoAtiva();
  if (!c) return false;
  await query(
    `INSERT INTO notion_envios (tarefa_id, tarefa_dono_id, conexao_id, notion_user_id, bu, pedido_por)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tarefa_id) DO UPDATE SET notion_user_id = COALESCE(EXCLUDED.notion_user_id, notion_envios.notion_user_id),
       bu = COALESCE(EXCLUDED.bu, notion_envios.bu), tentativas = 0, erro = NULL`,
    [opts.tarefaId, opts.donoId, c.id, opts.notionUserId ?? null, opts.bu ?? null, opts.pedidoPor],
  );
  return true;
}

/** Pessoas do Notion (pra escolher quem faz): as que não são da Welcome no TTARS vêm só daqui. */
export async function pessoasDoNotion(): Promise<PessoaNotion[]> {
  const c = await conexaoAtiva();
  if (!c) return [];
  return [...(await pessoasDaConexao(c)).values()];
}

/** O dono de uma escolha "notion:<id>" ou de um colega do TTARS que está no Notion. */
export async function pessoaNotionPorUsuario(userId: string): Promise<string | null> {
  const c = await conexaoAtiva();
  if (!c) return null;
  const r = await query<{ notion_user_id: string }>(
    `SELECT notion_user_id FROM notion_pessoas WHERE conexao_id = $1 AND user_id = $2 LIMIT 1`,
    [c.id, userId],
  );
  return r[0]?.notion_user_id ?? null;
}

// ── a rodada ──────────────────────────────────────────────────────────────────────────

let rodando = false;

export async function sincronizar(): Promise<{ ok: boolean; motivo?: string }> {
  if (rodando) return { ok: false, motivo: "já rodando" };
  const c = await conexaoAtiva();
  if (!c) return { ok: false, motivo: "sem conexão" };
  rodando = true;
  try {
    let pessoas = await pessoasDaConexao(c);
    pessoas = await puxar(c, pessoas);
    await empurrar(c, pessoas);
    await enviar(c, pessoas);
    await query(`UPDATE notion_conexoes SET ultima_rodada = now(), ultimo_erro = NULL WHERE id = $1`, [c.id]);
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof ErroDoNotion && (e.status === 401 || e.status === 403)
        ? "O Notion recusou a conexão (o segredo foi trocado ou a base saiu da conexão)."
        : e instanceof Error
          ? e.message
          : String(e);
    await query(`UPDATE notion_conexoes SET ultima_rodada = now(), ultimo_erro = $2 WHERE id = $1`, [c.id, msg.slice(0, 500)]);
    return { ok: false, motivo: msg };
  } finally {
    rodando = false;
  }
}

/** Como está a ligação (pra tela). */
export async function estadoDoNotion() {
  const c = await conexaoAtiva();
  if (!c) return { ligado: false as const };
  const n = await query<{ paginas: number; envios: number; falhas: number }>(
    `SELECT (SELECT count(*) FROM notion_paginas WHERE conexao_id = $1)::int AS paginas,
            (SELECT count(*) FROM notion_envios WHERE conexao_id = $1 AND tentativas < 5)::int AS envios,
            (SELECT count(*) FROM notion_envios WHERE conexao_id = $1 AND tentativas >= 5)::int AS falhas`,
    [c.id],
  );
  return {
    ligado: true as const,
    base: c.nome_base,
    quadro_id: c.quadro_id,
    ultima_rodada: c.ultima_rodada,
    erro: c.ultimo_erro,
    paginas: n[0]?.paginas ?? 0,
    esperando: n[0]?.envios ?? 0,
    falharam: n[0]?.falhas ?? 0,
  };
}

/** Informação do Notion de cada ação ligada (pra mostrar na ação). */
export async function notionDasAcoes(ids: string[]) {
  type Info = { url: string | null; status: string | null; bu: string | null; editado_em: string | null; editado_por: string | null; esperando: boolean };
  if (!ids.length || !(await conexaoAtiva())) return new Map<string, Info>();
  const r = await query<{
    tarefa_id: string;
    url: string | null;
    status_notion: string | null;
    bu: string | null;
    editado_notion: string | null;
    editado_por_nome: string | null;
    esperando: boolean;
  }>(
    `SELECT x.id::text AS tarefa_id, p.url, p.status_notion, p.bu, p.editado_notion,
            (SELECT np.nome FROM notion_pessoas np WHERE np.conexao_id = p.conexao_id AND np.notion_user_id = p.editado_por) AS editado_por_nome,
            (p.page_id IS NULL AND e.tarefa_id IS NOT NULL) AS esperando
       FROM unnest($1::uuid[]) AS x(id)
       LEFT JOIN notion_paginas p ON p.tarefa_id = x.id
       LEFT JOIN notion_envios e ON e.tarefa_id = x.id AND e.tentativas < 5
      WHERE p.page_id IS NOT NULL OR e.tarefa_id IS NOT NULL`,
    [ids],
  );
  return new Map(
    r.map((x) => [
      x.tarefa_id,
      { url: x.url, status: x.status_notion, bu: x.bu, editado_em: x.editado_notion, editado_por: x.editado_por_nome, esperando: x.esperando },
    ]),
  );
}

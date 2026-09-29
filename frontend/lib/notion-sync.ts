// Sincronização Ações ↔ Notion do marketing (bloco 4, pedido do Vitor 25/09/2026; "linkar 100%", 29/09).
//
// Roda a cada minuto (cron do servidor → /api/internal/notion/sincronizar):
//   1. lê a base Projects do Notion: cada projeto que tem tarefa vira um projeto do Ações (a tela
//      junta todos como Marketing; nenhum time novo no TTARS), com o nome andando nos dois sentidos;
//   2. puxa as páginas editadas no Notion desde a última rodada (com folga de 3 min, porque o
//      Notion marca a hora da edição só até o minuto) e compara campo a campo com o que valia
//      na última sincronização — o que mudou lá vem pra cá, o que mudou aqui vai pra lá (o
//      projeto de cada tarefa também: trocar de projeto num lado troca no outro);
//   3. empurra o que mudou nas ações ligadas e ainda não foi pro Notion;
//   4. cria no Notion as ações que alguém mandou pra lá de propósito (notion_envios) ou pôs
//      num projeto do marketing no Ações;
//   5. deixa cada ação no projeto certo do Ações (o do Notion, ou "Marketing · sem projeto");
//   6. arquivos e comentários, nos dois sentidos.
// Cada página fica presa a UMA ação (notion_paginas.page_id e .tarefa_id são únicos), cada
// projeto a UM projeto do Ações e cada comentário a UM comentário: nada se duplica. As tarefas
// que nascem no Notion ficam com a "pessoa" Marketing (Notion); a de quem está no TTARS vai
// também pra lista dessa pessoa.
import type { PoolClient } from "pg";
import { query, withTenant } from "./db";
import { garantirColegaDoTtars, registrarEvento } from "./equipe-compartilhado";
import { quadrosFor, type Quadro } from "./quadros";
import { tarefasFor } from "./queries";
import { getOwnerSlug } from "./owner-slug";
import {
  ErroDoNotion,
  comentarNaPagina,
  comentariosDaPagina,
  criarPagina,
  lerBase,
  lerFonte,
  lerPaginaDoNotion,
  lerPessoa,
  mudarPagina,
  paginasEditadas,
  quemSouEu,
  subirArquivo,
  type ComentarioDoNotion,
} from "./notion-api";
import {
  CHAVES,
  PROPS,
  decidir,
  etapaEmPortugues,
  lerPagina,
  lerProjeto,
  nomeLimpo,
  propriedadesPara,
  statusParaNotion,
  type ArquivoDoNotion,
  type CampoDaDescricao,
  type Campos,
  type PaginaLida,
  type ProjetoLido,
} from "./notion-mapa";
import { slugNome } from "./compartilhar";
import { MARCA_DO_TEAMS } from "./ttars-auth";
import { diaBR, ehDataValida, fimDoDiaBR } from "./data-br";
import { MAX_FILE_BYTES, isAllowedFile, resolveContentType, sanitizeFilename } from "./anexos";

/** A base "Tasks" do Notion do marketing (link visto no Notion do Vitor, 25/09/2026). */
export const BASE_DO_MARKETING = "3d6d6db4-1ae7-8062-b937-e865b2e9cf72";
const NOME_DO_DONO = "Marketing (Notion)";
/** O projeto principal guarda só as tarefas do Notion que não estão em nenhum projeto de lá. */
const NOME_DO_PRINCIPAL = "Marketing · sem projeto";
const DESCRICAO_DO_PRINCIPAL =
  "As tarefas do Notion do marketing que não estão em nenhum projeto de lá. O que você pedir a alguém do marketing aparece aqui também.";
/** Comentários: lidos a cada 5 minutos nas tarefas abertas (e na hora nas que mudaram). */
const A_CADA_COMENTARIOS = 5 * 60_000;
const TEXTO_MAX_DO_COMENTARIO = 4000;
/** O Notion aceita até 20 MB num envio único. */
const MAX_PRO_NOTION = 20 * 1024 * 1024;

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
  projetos_data_source_id?: string | null;
  comentarios_em?: string | null;
};

type ArquivoGuardado = { chave: string; anexo_id: string; nome: string };

type Link = {
  page_id: string;
  tarefa_id: string;
  tarefa_dono_id: string;
  url?: string | null;
  status_notion: string | null;
  ultimos: Partial<Campos>;
  sincronizado_em: string;
  editado_notion?: string | null;
  campo_descricao?: string | null;
  arquivos?: ArquivoGuardado[] | null;
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

type ProjetoGuardado = {
  page_id: string;
  quadro_id: string | null;
  nome: string;
  etapa: string | null;
  inicio: string | null;
  fim: string | null;
  lider: string | null;
  url: string | null;
  no_lixo: boolean;
  nome_sincronizado: string | null;
};

/** Onde cada ação ligada está nos projetos do Notion no Ações ("" = sem projeto). */
type Lugar = { projeto: string; quadros: string[] };

/** O que a rodada sabe dos projetos e do lugar de cada ação. */
type Rodada = {
  projetos: Map<string, ProjetoGuardado>;
  /** A base Projects foi lida nesta rodada (senão, projeto não muda de nenhum lado). */
  projetosOk: boolean;
  lugares: Map<string, Lugar>;
  /** Páginas lidas do Notion nesta rodada (pra arquivos e comentários). */
  lidas: Map<string, PaginaLida>;
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

// A 017 (projetos, comentários, arquivos) entra no banco antes do servidor novo; até lá, só o de
// sempre. Guardado depois de achar (a tabela não some).
let bancoNovo = false;
async function temBancoNovo(): Promise<boolean> {
  if (bancoNovo) return true;
  const r = await query<{ ok: boolean }>(`SELECT to_regclass('public.notion_projetos') IS NOT NULL AS ok`);
  bancoNovo = !!r[0]?.ok;
  return bancoNovo;
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
  const quadro: Quadro = await quadrosFor(dono).criar(NOME_DO_PRINCIPAL, DESCRICAO_DO_PRINCIPAL);
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

/** Os projetos do Ações que espelham o Notion: o principal e os de cada projeto de lá. */
function quadrosDaRodada(c: Conexao, projetos: Map<string, ProjetoGuardado>): string[] {
  const ids = [...projetos.values()].map((p) => p.quadro_id).filter((x): x is string => !!x);
  return c.quadro_id ? [c.quadro_id, ...ids] : ids;
}

/** Quem aparece nas tarefas do Notion: se é da Welcome no TTARS (e-mail ou nome inteiro), vira colega no Ações. */
async function registrarPessoas(c: Conexao, pessoas: { id: string; nome: string; email: string | null }[], quadros: string[]) {
  const vistas = new Map(pessoas.map((p) => [p.id, p]));
  for (const p of vistas.values()) {
    let email = p.email;
    if (!email) {
      // Quem só está no Teams não entra no casamento de nome (continua como pessoa só do Notion).
      const r = await query<{ email: string; nome: string }>(
        `SELECT email, nome FROM ttars_pessoas WHERE organizacao <> '' AND LEFT(organizacao, $1) <> $2`,
        [MARCA_DO_TEAMS.length, MARCA_DO_TEAMS],
      );
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
    // Quem é do TTARS entra nos projetos do marketing (vê tudo quando for liberado no Ações).
    if (colega && quadros.length) {
      await withTenant(c.dono_user_id, (db) =>
        db.query(
          `INSERT INTO quadro_membros (quadro_id, user_id, adicionado_por)
           SELECT q, $2, NULL FROM unnest($1::uuid[]) AS q ON CONFLICT DO NOTHING`,
          [quadros, colega.id],
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

function camposDaAcao(t: TarefaCrua, pessoas: Map<string, PessoaNotion>, antes: Partial<Campos>, projeto: string): Campos {
  return {
    titulo: t.titulo,
    descricao: (t.descricao ?? "").trim(),
    prazo: diaDoPrazo(t.prazo),
    status: t.status,
    prioridade: t.prioridade,
    pessoa: pessoaDaAcao(t, pessoas, antes.pessoa),
    projeto,
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

// ── projetos ───────────────────────────────────────────────────────────────────────────

async function projetosGuardados(c: Conexao): Promise<Map<string, ProjetoGuardado>> {
  const r = await query<ProjetoGuardado>(
    `SELECT page_id, quadro_id::text AS quadro_id, nome, etapa, to_char(inicio, 'YYYY-MM-DD') AS inicio,
            to_char(fim, 'YYYY-MM-DD') AS fim, lider, url, no_lixo, nome_sincronizado
       FROM notion_projetos WHERE conexao_id = $1`,
    [c.id],
  );
  return new Map(r.map((p) => [p.page_id, p]));
}

const arquivado = (p: { no_lixo: boolean; etapa: string | null }) => p.no_lixo || (p.etapa ?? "").trim().toLowerCase() === "archived";

/** Lê a base Projects: guarda cada projeto, acerta o nome dos dois lados e arquiva o que saiu. */
async function sincronizarProjetos(c: Conexao): Promise<Map<string, ProjetoGuardado>> {
  let fonte = c.projetos_data_source_id ?? null;
  if (!fonte) {
    const f = await lerFonte(c.token, c.data_source_id);
    const coluna = f.properties?.[PROPS.projeto];
    fonte = coluna?.type === "relation" ? (coluna.relation?.data_source_id ?? null) : null;
    if (!fonte) return projetosGuardados(c);
    await query(`UPDATE notion_conexoes SET projetos_data_source_id = $2 WHERE id = $1`, [c.id, fonte]);
    c.projetos_data_source_id = fonte;
  }
  const guardados = await projetosGuardados(c);
  const lidos: ProjetoLido[] = (await paginasEditadas(c.token, fonte, null)).map(lerProjeto);
  // Projeto que foi pra lixeira some da consulta: vira "no lixo" aqui também.
  const vistos = new Set(lidos.map((p) => p.pageId));
  for (const g of guardados.values()) {
    if (vistos.has(g.page_id) || g.no_lixo) continue;
    lidos.push({ pageId: g.page_id, url: g.url, nome: g.nome, etapa: g.etapa, inicio: g.inicio, fim: g.fim, lider: g.lider, noLixo: true, editadoEm: new Date().toISOString() });
  }
  for (const p of lidos) {
    const g = guardados.get(p.pageId);
    let nome = p.nome;
    if (g?.quadro_id) {
      const q = (
        await withTenant(c.dono_user_id, (db) =>
          db.query<{ nome: string; archived_at: string | null }>(`SELECT nome, archived_at FROM quadros WHERE id = $1`, [g.quadro_id]),
        )
      ).rows[0];
      if (q) {
        const antes = g.nome_sincronizado ?? g.nome;
        const mudouNotion = p.nome !== antes;
        const mudouAcoes = q.nome !== antes;
        if (mudouAcoes && !mudouNotion && !p.noLixo) {
          await mudarPagina(c.token, p.pageId, { properties: { Name: { title: [{ text: { content: q.nome.slice(0, 2000) } }] } } });
          nome = q.nome;
        } else if (q.nome !== p.nome) {
          await withTenant(c.dono_user_id, (db) => db.query(`UPDATE quadros SET nome = $2, updated_at = now() WHERE id = $1`, [g.quadro_id, p.nome]));
        }
        const deveArquivar = arquivado({ no_lixo: p.noLixo, etapa: p.etapa });
        if (deveArquivar && !q.archived_at) {
          await withTenant(c.dono_user_id, (db) => db.query(`UPDATE quadros SET archived_at = now() WHERE id = $1`, [g.quadro_id]));
        } else if (!deveArquivar && q.archived_at) {
          await withTenant(c.dono_user_id, (db) => db.query(`UPDATE quadros SET archived_at = NULL, updated_at = now() WHERE id = $1`, [g.quadro_id]));
        }
      }
    }
    const r = await query<ProjetoGuardado>(
      `INSERT INTO notion_projetos (page_id, conexao_id, nome, etapa, inicio, fim, lider, url, no_lixo, nome_sincronizado, editado_notion, sincronizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $3, $10, now())
       ON CONFLICT (page_id) DO UPDATE SET nome = EXCLUDED.nome, etapa = EXCLUDED.etapa, inicio = EXCLUDED.inicio, fim = EXCLUDED.fim,
         lider = EXCLUDED.lider, url = COALESCE(EXCLUDED.url, notion_projetos.url), no_lixo = EXCLUDED.no_lixo,
         nome_sincronizado = EXCLUDED.nome_sincronizado, editado_notion = EXCLUDED.editado_notion, sincronizado_em = now()
       RETURNING page_id, quadro_id::text AS quadro_id, nome, etapa, to_char(inicio, 'YYYY-MM-DD') AS inicio,
                 to_char(fim, 'YYYY-MM-DD') AS fim, lider, url, no_lixo, nome_sincronizado`,
      [p.pageId, c.id, nome, p.etapa, p.inicio, p.fim, p.lider, p.url, p.noLixo, p.editadoEm],
    );
    guardados.set(p.pageId, r[0]);
  }
  return guardados;
}

/** O projeto do Ações de um projeto do Notion; cria na primeira tarefa (vazio não entra). */
async function quadroDoProjeto(c: Conexao, r: Rodada, pageId: string): Promise<string | null> {
  const g = r.projetos.get(pageId);
  if (!g || arquivado(g)) return null;
  if (g.quadro_id) return g.quadro_id;
  // Sem descrição: a tela mostra como ele está no Notion (etapa, período, líder).
  const q = await quadrosFor(c.dono_user_id).criar(g.nome);
  if (c.quadro_id) {
    // As mesmas pessoas do projeto principal (quem ligou e quem é do marketing no TTARS).
    await withTenant(c.dono_user_id, (db) =>
      db.query(
        `INSERT INTO quadro_membros (quadro_id, user_id, adicionado_por)
         SELECT $1, m.user_id, m.adicionado_por FROM quadro_membros m WHERE m.quadro_id = $2
         ON CONFLICT DO NOTHING`,
        [q.id, c.quadro_id],
      ),
    );
  }
  await query(`UPDATE notion_projetos SET quadro_id = $2 WHERE page_id = $1`, [pageId, q.id]);
  g.quadro_id = q.id;
  return q.id;
}

/** O projeto de lá que vale: o que a tarefa aponta, se ele existe e não foi arquivado. */
function projetoVivo(r: Rodada, pageId: string): string {
  const g = pageId ? r.projetos.get(pageId) : undefined;
  return g && !arquivado(g) ? pageId : "";
}

/** Onde cada ação está nos projetos do marketing no Ações (o projeto posto por último vale). */
async function lugaresNoAcoes(c: Conexao, projetos: Map<string, ProjetoGuardado>): Promise<Map<string, Lugar>> {
  const doQuadro = new Map<string, string>();
  if (c.quadro_id) doQuadro.set(c.quadro_id, "");
  for (const p of projetos.values()) if (p.quadro_id && !arquivado(p)) doQuadro.set(p.quadro_id, p.page_id);
  const out = new Map<string, Lugar>();
  if (!doQuadro.size) return out;
  const r = await withTenant(c.dono_user_id, (db) =>
    db.query<{ quadro_id: string; tarefa_id: string }>(
      `SELECT quadro_id::text AS quadro_id, tarefa_id::text AS tarefa_id FROM quadro_tarefas
        WHERE quadro_id = ANY($1::uuid[]) ORDER BY added_at, quadro_id`,
      [[...doQuadro.keys()]],
    ),
  );
  for (const x of r.rows) {
    const lugar = out.get(x.tarefa_id) ?? { projeto: "", quadros: [] };
    lugar.quadros.push(x.quadro_id);
    const projeto = doQuadro.get(x.quadro_id) ?? "";
    if (projeto) lugar.projeto = projeto;
    out.set(x.tarefa_id, lugar);
  }
  return out;
}

/** Deixa a ação só no projeto certo (o do Notion, ou o principal quando não tem projeto). */
async function colocarNoLugar(c: Conexao, r: Rodada, tarefaId: string, projeto: string) {
  const doProjeto = projeto ? await quadroDoProjeto(c, r, projeto) : null;
  const destino = doProjeto ?? c.quadro_id;
  if (!destino) return;
  const onde = r.lugares.get(tarefaId)?.quadros ?? [];
  if (onde.length === 1 && onde[0] === destino) return;
  const todos = quadrosDaRodada(c, r.projetos);
  await withTenant(c.dono_user_id, async (db) => {
    await db.query(`DELETE FROM quadro_tarefas WHERE tarefa_id = $1 AND quadro_id = ANY($2::uuid[]) AND quadro_id <> $3`, [tarefaId, todos, destino]);
    await db.query(`INSERT INTO quadro_tarefas (quadro_id, tarefa_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [destino, tarefaId]);
  });
  r.lugares.set(tarefaId, { projeto: doProjeto ? projeto : "", quadros: [destino] });
}

// ── aplicar no Ações ───────────────────────────────────────────────────────────────────

/** Aplica na ação o que mudou no Notion (no tenant de quem é a ação). */
async function aplicarNaAcao(
  c: Conexao,
  r: Rodada,
  link: { tarefa_id: string; tarefa_dono_id: string },
  mudanca: Partial<Campos>,
  pessoas: Map<string, PessoaNotion>,
  editor: string | null,
) {
  if (mudanca.projeto !== undefined) await colocarNoLugar(c, r, link.tarefa_id, mudanca.projeto);
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
    `SELECT *, tarefa_id::text AS tarefa_id, tarefa_dono_id::text AS tarefa_dono_id FROM notion_paginas WHERE page_id = $1`,
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
  if (!(await temBancoNovo())) {
    await query(
      `INSERT INTO notion_paginas (page_id, conexao_id, tarefa_id, tarefa_dono_id, url, status_notion, bu, ultimos, editado_notion, editado_por, sincronizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (page_id) DO UPDATE SET url = EXCLUDED.url, status_notion = EXCLUDED.status_notion, bu = EXCLUDED.bu,
         ultimos = EXCLUDED.ultimos, editado_notion = EXCLUDED.editado_notion, editado_por = EXCLUDED.editado_por, sincronizado_em = now()`,
      [p.pageId, c.id, link.tarefa_id, link.tarefa_dono_id, p.url, statusNotion, p.bu, JSON.stringify(soCampos(ultimos)), p.editadoEm, p.editadoPor],
    );
    return;
  }
  await query(
    `INSERT INTO notion_paginas (page_id, conexao_id, tarefa_id, tarefa_dono_id, url, status_notion, bu, ultimos, editado_notion, editado_por,
                                 criado_por, campo_descricao, sincronizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (page_id) DO UPDATE SET url = EXCLUDED.url, status_notion = EXCLUDED.status_notion, bu = EXCLUDED.bu,
       ultimos = EXCLUDED.ultimos, editado_notion = EXCLUDED.editado_notion, editado_por = EXCLUDED.editado_por,
       criado_por = COALESCE(EXCLUDED.criado_por, notion_paginas.criado_por), campo_descricao = EXCLUDED.campo_descricao, sincronizado_em = now()`,
    [
      p.pageId,
      c.id,
      link.tarefa_id,
      link.tarefa_dono_id,
      p.url,
      statusNotion,
      p.bu,
      JSON.stringify(soCampos(ultimos)),
      p.editadoEm,
      p.editadoPor,
      p.criadoPor,
      p.campoDescricao,
    ],
  );
}

/** Página do Notion que ainda não é ação: vira uma, da pessoa Marketing (Notion). */
async function criarAcaoDaPagina(c: Conexao, r: Rodada, p: PaginaLida, pessoas: Map<string, PessoaNotion>) {
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
  const projeto = r.projetosOk ? projetoVivo(r, p.projeto) : "";
  await colocarNoLugar(c, r, criada.id, projeto);
  const valendo: Campos = { ...p, projeto };
  // Sem a base Projects nesta rodada, o projeto fica sem "última vez": a próxima rodada decide.
  if (!r.projetosOk) delete (valendo as Partial<Campos>).projeto;
  await gravarLink(c, p, { tarefa_id: criada.id, tarefa_dono_id: c.dono_user_id }, valendo, p.statusNotion);
}

async function tratarPagina(c: Conexao, r: Rodada, p: PaginaLida, pessoas: Map<string, PessoaNotion>) {
  r.lidas.set(p.pageId, p);
  const link = await linkDaPagina(p.pageId);
  if (!link) {
    if (!p.noLixo) await criarAcaoDaPagina(c, r, p, pessoas);
    return;
  }
  const t = await lerAcao(link.tarefa_dono_id, link.tarefa_id);
  if (!t) {
    // A ação foi apagada no Ações: a página vai pra lixeira do Notion (dá pra recuperar lá).
    if (!p.noLixo) await mudarPagina(c.token, p.pageId, { in_trash: true });
    await query(`DELETE FROM notion_paginas WHERE page_id = $1`, [p.pageId]);
    return;
  }
  const projetoAqui = r.lugares.get(t.id)?.projeto ?? "";
  const noAcoes = camposDaAcao(t, pessoas, link.ultimos, projetoAqui);
  // Sem a base Projects nesta rodada (ou banco antigo), o projeto não muda de nenhum lado.
  const projetoLa = r.projetosOk ? projetoVivo(r, p.projeto) : projetoAqui;
  const noNotion: Campos = { ...p, projeto: projetoLa, status: p.noLixo ? "cancelada" : p.status };
  const d = decidir(noNotion, noAcoes, link.ultimos, { notion: p.editadoEm, acoes: iso(t.updated_at) });
  const editor = p.editadoPor ? (pessoas.get(p.editadoPor)?.nome ?? null) : null;
  if (Object.keys(d.paraAcoes).length) await aplicarNaAcao(c, r, link, d.paraAcoes, pessoas, editor);
  let statusNotion = p.statusNotion;
  let editadoEm = p.editadoEm;
  if (Object.keys(d.paraNotion).length) {
    const res = await empurrarCampos(c, p.pageId, d.paraNotion, p.statusNotion, p.campoDescricao);
    statusNotion = res.statusNotion;
    editadoEm = res.editadoEm ?? editadoEm;
  }
  const valendo: Campos = { ...noAcoes, ...d.paraAcoes, ...d.paraNotion } as Campos;
  if (!r.projetosOk && !("projeto" in link.ultimos)) delete (valendo as Partial<Campos>).projeto;
  await gravarLink(c, { ...p, editadoEm }, link, valendo, statusNotion);
}

/** Grava no Notion; cancelada vai pra lixeira, reaberta volta dela. */
async function empurrarCampos(
  c: Conexao,
  pageId: string,
  mudanca: Partial<Campos>,
  statusAnterior: string | null,
  campoDescricao?: CampoDaDescricao | string | null,
) {
  const { status, ...resto } = mudanca;
  const vaiProLixo = status === "cancelada";
  const props = propriedadesPara(status && !vaiProLixo ? { ...resto, status } : resto, {
    statusAnterior,
    campoDescricao: campoDescricao === "Text" ? "Text" : "Description",
  });
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

async function conferirLixeira(c: Conexao, r: Rodada, vivas: Set<string>, pessoas: Map<string, PessoaNotion>) {
  const links = await query<{ page_id: string }>(`SELECT page_id FROM notion_paginas WHERE conexao_id = $1`, [c.id]);
  for (const l of links) {
    if (vivas.has(l.page_id)) continue;
    const pg = await lerPaginaDoNotion(c.token, l.page_id).catch((e) => {
      // Sumiu de vez ou a conexão perdeu a página: não mexe na ação (evita cancelar em massa).
      if (e instanceof ErroDoNotion && e.status === 404) return null;
      throw e;
    });
    if (pg) await tratarPagina(c, r, lerPagina(pg), pessoas);
  }
}

/** Quem criou páginas e ainda não é conhecido: o Notion diz nome e e-mail. */
async function pessoasQueCriaram(c: Conexao, paginas: PaginaLida[], pessoas: Map<string, PessoaNotion>) {
  const ids = [...new Set(paginas.map((p) => p.criadoPor).filter((x): x is string => !!x && !pessoas.has(x) && x !== c.bot_id))];
  const out: { id: string; nome: string; email: string | null }[] = [];
  for (const id of ids) {
    const u = await lerPessoa(c.token, id).catch(() => null);
    if (!u || u.type === "bot") continue;
    out.push({ id, nome: nomeLimpo(u.name) || "Pessoa do Notion", email: u.person?.email?.toLowerCase() ?? null });
  }
  return out;
}

async function puxar(c: Conexao, r: Rodada, pessoas: Map<string, PessoaNotion>): Promise<Map<string, PessoaNotion>> {
  const completa = !c.cursor_editado || Date.now() - ultimaVarreduraCompleta > 10 * 60_000;
  const desde = completa ? null : new Date(Date.parse(c.cursor_editado!) - 3 * 60_000).toISOString();
  const paginas = (await paginasEditadas(c.token, c.data_source_id, desde)).map(lerPagina);
  const novasPessoas = paginas.flatMap((p) => p.pessoas).filter((x) => !pessoas.has(x.id));
  if (bancoNovo) novasPessoas.push(...(await pessoasQueCriaram(c, paginas, pessoas)));
  if (novasPessoas.length) {
    await registrarPessoas(c, novasPessoas, quadrosDaRodada(c, r.projetos));
    pessoas = await pessoasDaConexao(c);
  }
  let maior = c.cursor_editado;
  for (const p of paginas) {
    await tratarPagina(c, r, p, pessoas);
    if (!maior || p.editadoEm > maior) maior = p.editadoEm;
  }
  if (maior && maior !== c.cursor_editado) await query(`UPDATE notion_conexoes SET cursor_editado = $2 WHERE id = $1`, [c.id, maior]);
  if (completa && paginas.length > 0) {
    await conferirLixeira(c, r, new Set(paginas.map((p) => p.pageId)), pessoas);
    ultimaVarreduraCompleta = Date.now();
  }
  return pessoas;
}

// ── empurrar o que mudou no Ações ─────────────────────────────────────────────────────

async function linksDaConexao(c: Conexao): Promise<Link[]> {
  return query<Link>(
    `SELECT *, tarefa_id::text AS tarefa_id, tarefa_dono_id::text AS tarefa_dono_id FROM notion_paginas WHERE conexao_id = $1`,
    [c.id],
  );
}

function porDono<T extends { tarefa_dono_id: string }>(links: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of links) m.set(l.tarefa_dono_id, [...(m.get(l.tarefa_dono_id) ?? []), l]);
  return m;
}

async function empurrar(c: Conexao, r: Rodada, pessoas: Map<string, PessoaNotion>) {
  const links = await linksDaConexao(c);
  for (const [dono, lista] of porDono(links)) {
    const ids = lista.map((l) => l.tarefa_id);
    const res = await withTenant(dono, (db) =>
      db.query<TarefaCrua>(
        `SELECT id::text AS id, titulo, descricao, prazo, status, prioridade, owner, acao,
                responsavel_user_id::text AS responsavel_user_id, updated_at
           FROM tarefas WHERE id = ANY($1::uuid[])`,
        [ids],
      ),
    );
    const vivas = new Map(res.rows.map((t) => [t.id, t]));
    for (const l of lista) {
      const t = vivas.get(l.tarefa_id);
      if (!t) {
        // Apagada no Ações → lixeira do Notion.
        await mudarPagina(c.token, l.page_id, { in_trash: true }).catch(() => undefined);
        await query(`DELETE FROM notion_paginas WHERE page_id = $1`, [l.page_id]);
        continue;
      }
      // Trocar de projeto no Ações não mexe na ação (só no projeto): conta aqui também.
      const projetoAqui = r.projetosOk ? (r.lugares.get(t.id)?.projeto ?? "") : (l.ultimos.projeto ?? "");
      const trocouDeProjeto = r.projetosOk && "projeto" in l.ultimos && projetoAqui !== (l.ultimos.projeto ?? "");
      if (!trocouDeProjeto && Date.parse(iso(t.updated_at)) <= Date.parse(iso(l.sincronizado_em))) continue;
      const agora = camposDaAcao(t, pessoas, l.ultimos, projetoAqui);
      const mudou: Partial<Campos> = {};
      for (const k of CHAVES) {
        if (k === "projeto" && !("projeto" in l.ultimos)) continue;
        if (String(l.ultimos[k] ?? "") !== String(agora[k] ?? "")) (mudou as Record<string, unknown>)[k] = agora[k];
      }
      if (!Object.keys(mudou).length) {
        await query(`UPDATE notion_paginas SET sincronizado_em = now() WHERE page_id = $1`, [l.page_id]);
        continue;
      }
      const feito = await empurrarCampos(c, l.page_id, mudou, l.status_notion, l.campo_descricao);
      await query(
        `UPDATE notion_paginas SET ultimos = $2, status_notion = $3, editado_notion = COALESCE($4, editado_notion), sincronizado_em = now()
          WHERE page_id = $1`,
        [l.page_id, JSON.stringify({ ...l.ultimos, ...mudou }), feito.statusNotion, feito.editadoEm],
      );
    }
  }
}

// ── mandar pro Notion ─────────────────────────────────────────────────────────────────

/** Ação posta num projeto do marketing no Ações (criada lá ou trazida) vai pro Notion. */
async function pedirEnviosDosProjetos(c: Conexao, r: Rodada) {
  const quadros = quadrosDaRodada(c, r.projetos);
  if (!quadros.length) return;
  const soltas = await withTenant(c.dono_user_id, (db) =>
    db.query<{ tarefa_id: string; dono_id: string }>(
      `SELECT DISTINCT qt.tarefa_id::text AS tarefa_id, a.dono_id::text AS dono_id
         FROM quadro_tarefas qt CROSS JOIN LATERAL equipe_acesso_tarefa(qt.tarefa_id) a
        WHERE qt.quadro_id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM notion_paginas p WHERE p.tarefa_id = qt.tarefa_id)
          AND NOT EXISTS (SELECT 1 FROM notion_envios e WHERE e.tarefa_id = qt.tarefa_id)`,
      [quadros],
    ),
  );
  for (const s of soltas.rows) {
    await pedirEnvio({ tarefaId: s.tarefa_id, donoId: s.dono_id, pedidoPor: s.dono_id });
  }
}

async function enviar(c: Conexao, r: Rodada, pessoas: Map<string, PessoaNotion>) {
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
      const projeto = r.projetosOk ? (r.lugares.get(t.id)?.projeto ?? "") : "";
      const campos = camposDaAcao(t, pessoas, { pessoa: e.notion_user_id ?? undefined }, projeto);
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
      const valendo: Campos = { ...campos };
      if (!r.projetosOk) delete (valendo as Partial<Campos>).projeto;
      await gravarLink(c, lida, { tarefa_id: t.id, tarefa_dono_id: e.tarefa_dono_id }, valendo, lida.statusNotion);
      await query(`DELETE FROM notion_envios WHERE tarefa_id = $1`, [e.tarefa_id]);
      if (r.projetosOk || !bancoNovo) await colocarNoLugar(c, r, t.id, projeto).catch(() => undefined);
    } catch (err) {
      await query(`UPDATE notion_envios SET tentativas = tentativas + 1, erro = $2 WHERE tarefa_id = $1`, [
        e.tarefa_id,
        err instanceof Error ? err.message.slice(0, 500) : String(err),
      ]);
    }
  }
}

/** Pede pra mandar a ação pro Notion (alguém escolheu uma pessoa do marketing, apertou o botão ou pôs num projeto de lá). */
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

// ── cada ação no seu projeto ──────────────────────────────────────────────────────────

/** Toda ação ligada fica em um projeto só do marketing: o do Notion ou o principal. */
async function arrumarLugares(c: Conexao, r: Rodada) {
  const links = await query<{ tarefa_id: string; projeto: string | null; tem: boolean }>(
    `SELECT tarefa_id::text AS tarefa_id, ultimos ->> 'projeto' AS projeto, ultimos ? 'projeto' AS tem
       FROM notion_paginas WHERE conexao_id = $1`,
    [c.id],
  );
  for (const l of links) {
    if (!l.tem) continue;
    const certo = projetoVivo(r, l.projeto ?? "");
    const lugar = r.lugares.get(l.tarefa_id);
    const destino = certo ? r.projetos.get(certo)?.quadro_id : c.quadro_id;
    if (lugar && lugar.quadros.length === 1 && destino && lugar.quadros[0] === destino) continue;
    await colocarNoLugar(c, r, l.tarefa_id, certo);
  }
}

// ── arquivos ──────────────────────────────────────────────────────────────────────────

type AnexoDoAcoes = { id: string; tipo: "link" | "arquivo"; url: string | null; titulo: string | null; filename: string | null; content_type: string | null; size_bytes: number | null };

/** Arquivo do Notion vira anexo da ação: link fica link; arquivo guardado lá é baixado (o link de lá vence em 1 hora). */
async function anexoDoNotion(l: Link, f: ArquivoDoNotion): Promise<string | null> {
  if (f.tipo === "file") {
    const nome = sanitizeFilename(f.nome.split("?")[0].split("/").pop() || f.nome) || "arquivo";
    const baixado = await fetch(f.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const bytes = baixado?.ok ? new Uint8Array(await baixado.arrayBuffer()) : null;
    if (bytes && bytes.length <= MAX_FILE_BYTES && isAllowedFile(nome)) {
      const tipo = resolveContentType(nome, baixado?.headers.get("content-type"));
      const r = await withTenant(l.tarefa_dono_id, (db) =>
        db.query<{ id: string }>(
          `INSERT INTO tarefa_anexos (tarefa_id, tipo, filename, content_type, size_bytes, conteudo, titulo, ordem)
           VALUES ($1, 'arquivo', $2, $3, $4, $5, NULL, COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
           RETURNING id::text AS id`,
          [l.tarefa_id, nome, tipo, bytes.length, Buffer.from(bytes)],
        ),
      );
      return r.rows[0]?.id ?? null;
    }
    // Grande demais ou de um tipo que o Ações não guarda: fica o caminho pra abrir no Notion.
    if (!l.url) return null;
    const r = await withTenant(l.tarefa_dono_id, (db) =>
      db.query<{ id: string }>(
        `INSERT INTO tarefa_anexos (tarefa_id, tipo, url, titulo, ordem)
         VALUES ($1, 'link', $2, $3, COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
         RETURNING id::text AS id`,
        [l.tarefa_id, l.url, `${nome} (abrir no Notion)`.slice(0, 200)],
      ),
    );
    return r.rows[0]?.id ?? null;
  }
  const r = await withTenant(l.tarefa_dono_id, (db) =>
    db.query<{ id: string }>(
      `INSERT INTO tarefa_anexos (tarefa_id, tipo, url, titulo, ordem)
       VALUES ($1, 'link', $2, $3, COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
       RETURNING id::text AS id`,
      [l.tarefa_id, f.url, f.nome && f.nome !== f.url ? f.nome.slice(0, 200) : null],
    ),
  );
  return r.rows[0]?.id ?? null;
}

/** Como um arquivo que já está no Notion volta na lista ao gravar (a lista vai inteira). */
function arquivoQueFica(f: ArquivoDoNotion): Record<string, unknown> {
  return f.tipo === "file"
    ? { name: f.nome.slice(0, 100), type: "file", file: { url: f.url } }
    : { name: f.nome.slice(0, 100), type: "external", external: { url: f.url } };
}

/** Anexo do Ações que vai pro Notion: link vira link; arquivo sobe pro Notion. null = não dá. */
async function arquivoParaNotion(c: Conexao, l: Link, a: AnexoDoAcoes): Promise<Record<string, unknown> | null> {
  if (a.tipo === "link" && a.url) {
    return { name: (a.titulo || a.url).slice(0, 100), type: "external", external: { url: a.url } };
  }
  if (a.tipo !== "arquivo" || !a.filename || (a.size_bytes ?? 0) > MAX_PRO_NOTION) return null;
  const r = await withTenant(l.tarefa_dono_id, (db) =>
    db.query<{ conteudo: Buffer }>(`SELECT conteudo FROM tarefa_anexos WHERE id = $1`, [a.id]),
  );
  const bytes = r.rows[0]?.conteudo;
  if (!bytes) return null;
  const id = await subirArquivo(c.token, a.filename, a.content_type || "application/octet-stream", new Uint8Array(bytes));
  return { name: a.filename.slice(0, 100), type: "file_upload", file_upload: { id } };
}

async function sincronizarArquivos(c: Conexao, r: Rodada) {
  const links = await linksDaConexao(c);
  for (const [dono, lista] of porDono(links)) {
    const res = await withTenant(dono, (db) =>
      db.query<AnexoDoAcoes & { tarefa_id: string }>(
        `SELECT id::text AS id, tarefa_id::text AS tarefa_id, tipo, url, titulo, filename, content_type, size_bytes
           FROM tarefa_anexos WHERE tarefa_id = ANY($1::uuid[]) ORDER BY ordem, created_at`,
        [lista.map((l) => l.tarefa_id)],
      ),
    );
    for (const l of lista) {
      try {
        let guardados: ArquivoGuardado[] = Array.isArray(l.arquivos) ? l.arquivos : [];
        const aqui = new Map(res.rows.filter((a) => a.tarefa_id === l.tarefa_id).map((a) => [a.id, a]));
        const lida = r.lidas.get(l.page_id);
        let mudou = false;
        // Notion → Ações: só com a página lida nesta rodada.
        if (lida && !lida.noLixo) {
          for (const f of lida.arquivos) {
            if (guardados.some((g) => g.chave === f.chave)) continue;
            const anexo = await anexoDoNotion(l, f);
            if (!anexo) continue;
            guardados.push({ chave: f.chave, anexo_id: anexo, nome: f.nome });
            aqui.set(anexo, { id: anexo, tarefa_id: l.tarefa_id, tipo: "link", url: null, titulo: null, filename: null, content_type: null, size_bytes: null });
            mudou = true;
          }
          const chaves = new Set(lida.arquivos.map((f) => f.chave));
          for (const g of guardados.filter((x) => !chaves.has(x.chave))) {
            await withTenant(l.tarefa_dono_id, (db) => db.query(`DELETE FROM tarefa_anexos WHERE id = $1 AND tarefa_id = $2`, [g.anexo_id, l.tarefa_id]));
            aqui.delete(g.anexo_id);
            guardados = guardados.filter((x) => x !== g);
            mudou = true;
          }
        }
        // Ações → Notion: anexo novo sobe; anexo apagado sai de lá.
        const novos = [...aqui.values()].filter((a) => !guardados.some((g) => g.anexo_id === a.id));
        const sumidos = guardados.filter((g) => !aqui.has(g.anexo_id));
        if (novos.length || sumidos.length) {
          const agora = lerPagina(await lerPaginaDoNotion(c.token, l.page_id));
          const ficam = agora.arquivos.filter((f) => !sumidos.some((s) => s.chave === f.chave));
          const vao: { anexo: AnexoDoAcoes; valor: Record<string, unknown> }[] = [];
          for (const a of novos) {
            const valor = await arquivoParaNotion(c, l, a);
            if (valor) vao.push({ anexo: a, valor });
          }
          const gravada = lerPagina(
            await mudarPagina(c.token, l.page_id, {
              properties: { [PROPS.arquivos]: { files: [...ficam.map(arquivoQueFica), ...vao.map((v) => v.valor)] } },
            }),
          );
          const chegaram = gravada.arquivos.filter((f) => !ficam.some((x) => x.chave === f.chave));
          vao.forEach((v, i) => {
            const f = chegaram[i];
            if (f) guardados.push({ chave: f.chave, anexo_id: v.anexo.id, nome: f.nome });
          });
          guardados = guardados.filter((g) => !sumidos.includes(g));
          mudou = true;
        }
        if (mudou) await query(`UPDATE notion_paginas SET arquivos = $2 WHERE page_id = $1`, [l.page_id, JSON.stringify(guardados)]);
      } catch (e) {
        console.error("[notion] arquivos", l.page_id, e instanceof Error ? e.message : e);
      }
    }
  }
}

// ── comentários ───────────────────────────────────────────────────────────────────────

const textoDoComentario = (cm: ComentarioDoNotion) =>
  (cm.rich_text ?? []).map((x) => x.plain_text ?? x.text?.content ?? "").join("").trim();

async function sincronizarComentarios(c: Conexao, r: Rodada, pessoas: Map<string, PessoaNotion>) {
  const links = await linksDaConexao(c);
  const todas = !c.comentarios_em || Date.now() - Date.parse(iso(c.comentarios_em)) > A_CADA_COMENTARIOS;
  const recente = (l: Link) => !!l.editado_notion && Date.now() - Date.parse(iso(l.editado_notion)) < 14 * 86_400_000;
  const fechada = (l: Link) => l.ultimos.status === "concluida" || l.ultimos.status === "cancelada";
  // Página mexida desde a última leitura de comentários: lê já (a varredura completa lê todas, não
  // conta). O Notion guarda a hora da edição só até o minuto: 2 minutos de folga.
  const desde = c.comentarios_em ? new Date(Date.parse(iso(c.comentarios_em)) - 2 * 60_000).toISOString() : null;
  const mexida = (l: Link) => {
    const p = r.lidas.get(l.page_id);
    return !!p && (!desde || p.editadoEm > desde);
  };
  // Notion → Ações
  for (const l of links) {
    if (!mexida(l) && !(todas && (!fechada(l) || recente(l)))) continue;
    try {
      const lista = await comentariosDaPagina(c.token, l.page_id);
      const ja = await query<{ comment_id: string; comentario_id: string | null; origem: string }>(
        `SELECT comment_id, comentario_id::text AS comentario_id, origem FROM notion_comentarios WHERE page_id = $1`,
        [l.page_id],
      );
      const conhecidos = new Map(ja.map((x) => [x.comment_id, x]));
      const vistos = new Set<string>();
      for (const cm of lista) {
        vistos.add(cm.id);
        if (conhecidos.has(cm.id)) continue;
        if (cm.created_by?.id && cm.created_by.id === c.bot_id) {
          // Escrito pelo Ações (a conexão é o autor lá): nunca volta como comentário novo.
          await query(
            `INSERT INTO notion_comentarios (comment_id, conexao_id, page_id, origem) VALUES ($1, $2, $3, 'acoes') ON CONFLICT DO NOTHING`,
            [cm.id, c.id, l.page_id],
          );
          continue;
        }
        const texto = textoDoComentario(cm);
        if (!texto) continue;
        const autor = pessoas.get(cm.created_by?.id ?? "");
        const corpo = (autor?.user_id ? texto : `${autor?.nome ?? "Alguém no Notion"}: ${texto}`).slice(0, TEXTO_MAX_DO_COMENTARIO);
        const novo = await withTenant(l.tarefa_dono_id, (db) =>
          db.query<{ id: string }>(
            `INSERT INTO tarefa_comentarios (tarefa_id, texto, autor_user_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
            [l.tarefa_id, corpo, autor?.user_id ?? c.dono_user_id, cm.created_time],
          ),
        );
        await query(
          `INSERT INTO notion_comentarios (comment_id, conexao_id, page_id, comentario_id, origem) VALUES ($1, $2, $3, $4, 'notion') ON CONFLICT DO NOTHING`,
          [cm.id, c.id, l.page_id, novo.rows[0]?.id ?? null],
        );
      }
      // Apagado no Notion: sai do Ações também.
      for (const x of ja) {
        if (x.origem !== "notion" || vistos.has(x.comment_id)) continue;
        if (x.comentario_id) {
          await withTenant(l.tarefa_dono_id, (db) => db.query(`DELETE FROM tarefa_comentarios WHERE id = $1`, [x.comentario_id]));
        }
        await query(`DELETE FROM notion_comentarios WHERE comment_id = $1`, [x.comment_id]);
      }
    } catch (e) {
      console.error("[notion] comentários", l.page_id, e instanceof Error ? e.message : e);
    }
  }
  if (todas) await query(`UPDATE notion_conexoes SET comentarios_em = now() WHERE id = $1`, [c.id]);
  // Ações → Notion: comentário novo numa ação ligada vai pra página (com o nome de quem escreveu).
  for (const [dono, lista] of porDono(links)) {
    const pagina = new Map(lista.map((l) => [l.tarefa_id, l.page_id]));
    const novos = await withTenant(dono, (db) =>
      db.query<{ id: string; tarefa_id: string; texto: string; autor: string | null }>(
        `SELECT cm.id::text AS id, cm.tarefa_id::text AS tarefa_id, cm.texto,
                (SELECT u.nome FROM users u WHERE u.id = cm.autor_user_id) AS autor
           FROM tarefa_comentarios cm
          WHERE cm.tarefa_id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM notion_comentarios n WHERE n.comentario_id = cm.id)
          ORDER BY cm.created_at`,
        [[...pagina.keys()]],
      ),
    );
    for (const cm of novos.rows) {
      const pageId = pagina.get(cm.tarefa_id);
      if (!pageId) continue;
      try {
        const criado = await comentarNaPagina(c.token, pageId, `${nomeLimpo(cm.autor) || "Alguém"} (pelo TTARS): ${cm.texto}`);
        await query(
          `INSERT INTO notion_comentarios (comment_id, conexao_id, page_id, comentario_id, origem) VALUES ($1, $2, $3, $4, 'acoes') ON CONFLICT DO NOTHING`,
          [criado.id, c.id, pageId, cm.id],
        );
      } catch (e) {
        console.error("[notion] comentar", pageId, e instanceof Error ? e.message : e);
      }
    }
  }
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

/** O principal ganhou o nome de "sem projeto" quando os projetos do Notion viraram projetos (29/09). */
async function renomearPrincipal(c: Conexao) {
  if (!c.quadro_id) return;
  await withTenant(c.dono_user_id, (db) =>
    db.query(`UPDATE quadros SET nome = $2, descricao = $3, updated_at = now() WHERE id = $1 AND nome = 'Marketing (Notion)'`, [
      c.quadro_id,
      NOME_DO_PRINCIPAL,
      DESCRICAO_DO_PRINCIPAL,
    ]),
  );
}

export async function sincronizar(): Promise<{ ok: boolean; motivo?: string }> {
  if (rodando) return { ok: false, motivo: "já rodando" };
  const c = await conexaoAtiva();
  if (!c) return { ok: false, motivo: "sem conexão" };
  rodando = true;
  try {
    let pessoas = await pessoasDaConexao(c);
    const r: Rodada = { projetos: new Map(), projetosOk: false, lugares: new Map(), lidas: new Map() };
    const novo = await temBancoNovo();
    if (novo) {
      await renomearPrincipal(c);
      try {
        r.projetos = await sincronizarProjetos(c);
        r.projetosOk = !!c.projetos_data_source_id;
      } catch (e) {
        // Sem a base Projects nesta rodada: as tarefas andam, os projetos esperam a próxima.
        console.error("[notion] projetos", e instanceof Error ? e.message : e);
        r.projetos = await projetosGuardados(c);
      }
      r.lugares = await lugaresNoAcoes(c, r.projetos);
    }
    pessoas = await puxar(c, r, pessoas);
    await empurrar(c, r, pessoas);
    if (novo && r.projetosOk) await pedirEnviosDosProjetos(c, r);
    await enviar(c, r, pessoas);
    if (novo) {
      if (r.projetosOk) await arrumarLugares(c, r);
      await sincronizarArquivos(c, r);
      await sincronizarComentarios(c, r, pessoas);
    }
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

export type ProjetoDoNotion = {
  /** "Marketing": o grupo em que a tela junta os projetos do Notion. */
  grupo: string;
  /** O principal (tarefas sem projeto no Notion) não tem página lá. */
  sem_projeto: boolean;
  url: string | null;
  etapa: string | null;
  inicio: string | null;
  fim: string | null;
  lider: string | null;
};

/** Os projetos do Ações que espelham o Notion (quadro → como mostrar). Vazio sem conexão. */
export async function projetosDoNotion(): Promise<Map<string, ProjetoDoNotion>> {
  const out = new Map<string, ProjetoDoNotion>();
  const c = await conexaoAtiva();
  if (!c) return out;
  if (c.quadro_id) out.set(c.quadro_id, { grupo: "Marketing", sem_projeto: true, url: null, etapa: null, inicio: null, fim: null, lider: null });
  if (!(await temBancoNovo())) return out;
  const r = await query<{ quadro_id: string; url: string | null; etapa: string | null; inicio: string | null; fim: string | null; lider: string | null }>(
    `SELECT np.quadro_id::text AS quadro_id, np.url, np.etapa, to_char(np.inicio, 'YYYY-MM-DD') AS inicio, to_char(np.fim, 'YYYY-MM-DD') AS fim,
            (SELECT p.nome FROM notion_pessoas p WHERE p.conexao_id = np.conexao_id AND p.notion_user_id = np.lider) AS lider
       FROM notion_projetos np WHERE np.conexao_id = $1 AND np.quadro_id IS NOT NULL`,
    [c.id],
  );
  for (const p of r) {
    out.set(p.quadro_id, { grupo: "Marketing", sem_projeto: false, url: p.url, etapa: etapaEmPortugues(p.etapa), inicio: p.inicio, fim: p.fim, lider: p.lider });
  }
  return out;
}

/** Muda a área (BU) da tarefa no Notion; a coluna só existe lá. */
export async function mudarAreaNoNotion(tarefaId: string, bu: string): Promise<"ok" | "sem_ligacao"> {
  const c = await conexaoAtiva();
  if (!c) return "sem_ligacao";
  const r = await query<{ page_id: string }>(`SELECT page_id FROM notion_paginas WHERE tarefa_id = $1 AND conexao_id = $2`, [tarefaId, c.id]);
  const pageId = r[0]?.page_id;
  if (!pageId) return "sem_ligacao";
  const pg = await mudarPagina(c.token, pageId, { properties: { [PROPS.bu]: { select: { name: bu } } } });
  await query(`UPDATE notion_paginas SET bu = $2, editado_notion = COALESCE($3, editado_notion) WHERE page_id = $1`, [
    pageId,
    bu,
    pg?.last_edited_time ?? null,
  ]);
  return "ok";
}

/** Informação do Notion de cada ação ligada (pra mostrar na ação). */
export async function notionDasAcoes(ids: string[]) {
  type Info = {
    url: string | null;
    status: string | null;
    bu: string | null;
    editado_em: string | null;
    editado_por: string | null;
    esperando: boolean;
    /** Quem criou a tarefa no Notion (vira "quem pediu" na tela). */
    criado_por: string | null;
  };
  if (!ids.length || !(await conexaoAtiva())) return new Map<string, Info>();
  const novo = await temBancoNovo();
  const r = await query<{
    tarefa_id: string;
    url: string | null;
    status_notion: string | null;
    bu: string | null;
    editado_notion: string | null;
    editado_por_nome: string | null;
    criado_por_nome: string | null;
    esperando: boolean;
  }>(
    `SELECT x.id::text AS tarefa_id, p.url, p.status_notion, p.bu, p.editado_notion,
            (SELECT np.nome FROM notion_pessoas np WHERE np.conexao_id = p.conexao_id AND np.notion_user_id = p.editado_por) AS editado_por_nome,
            ${novo ? "(SELECT np.nome FROM notion_pessoas np WHERE np.conexao_id = p.conexao_id AND np.notion_user_id = p.criado_por)" : "NULL::text"} AS criado_por_nome,
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
      {
        url: x.url,
        status: x.status_notion,
        bu: x.bu,
        editado_em: x.editado_notion,
        editado_por: x.editado_por_nome,
        esperando: x.esperando,
        criado_por: x.criado_por_nome,
      },
    ]),
  );
}

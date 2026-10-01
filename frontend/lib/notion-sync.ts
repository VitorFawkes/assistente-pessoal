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
  trocarPrimeiraPessoa,
  type ArquivoDoNotion,
  type CampoDaDescricao,
  type Campos,
  type PaginaLida,
  type ProjetoLido,
} from "./notion-mapa";
import { slugNome } from "./compartilhar";
import { MARCA_DO_TEAMS } from "./ttars-auth";
import { diaBR, diaMesBR, ehDataValida, fimDoDiaBR } from "./data-br";
import { MAX_FILE_BYTES, isAllowedFile, normalizeUrl, resolveContentType, sanitizeFilename } from "./anexos";

/** A base "Tasks" do Notion do marketing (link visto no Notion do Vitor, 25/09/2026). */
export const BASE_DO_MARKETING = "3d6d6db4-1ae7-8062-b937-e865b2e9cf72";
const NOME_DO_DONO = "Marketing (Notion)";
/** O projeto principal guarda só as tarefas do Notion que não estão em nenhum projeto de lá. */
const NOME_DO_PRINCIPAL = "Marketing · sem projeto";
const DESCRICAO_DO_PRINCIPAL =
  "As tarefas do Notion do marketing que não estão em nenhum projeto de lá. O que você pedir a alguém do marketing aparece aqui também.";
/** Comentários: lidos a cada 5 minutos nas tarefas abertas (e na hora nas que mudaram); em todas, a cada 30. */
const A_CADA_COMENTARIOS = 5 * 60_000;
const A_CADA_COMENTARIOS_TODAS = 30 * 60_000;
let ultimaLeituraDeTodosOsComentarios = 0;
const TEXTO_MAX_DO_COMENTARIO = 4000;

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

/** Um arquivo da ação: a chave dele no Notion e o anexo no Ações ("" = não há anexo aqui, ex.:
 *  link inválido). `so_aqui`: não pode ir pro Notion (grande, tipo, erro): fica só no Ações. */
type ArquivoGuardado = { chave: string; anexo_id: string; nome: string; so_aqui?: boolean };

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
  /** O que deu errado sem parar a rodada (vai pro aviso da tela). */
  avisos: string[];
  /** Ações que nasceram de um pedido ao marketing (Pedidos ao Marketing, 30/09/2026). */
  pedidos: Map<string, PedidoNaRodada>;
};

/** Pedido ao marketing: a página nasce no projeto do formulário, com Person e Assign juntos (a equipe usa o
 *  Assign; lido antes do Person) e "Pedido por X pelo TTARS, dd/mm" no corpo. `quem_emails` = quem recebe,
 *  na ordem (01/10: várias pessoas; a página nasce com todas as que estão no Notion). */
type PedidoNaRodada = { projeto: string; bu: string | null; quem: string | null; criado_em: string | Date; quem_emails: string[] | null };

async function pedidosDaRodada(): Promise<Map<string, PedidoNaRodada>> {
  const ler = (comQuem: boolean) =>
    query<PedidoNaRodada & { tarefa_id: string }>(
      `SELECT tp.tarefa_id::text AS tarefa_id, COALESCE(tp.projeto_notion_page_id, '') AS projeto, tp.bu, u.nome AS quem, tp.criado_em,
              ${comQuem ? "tp.quem_emails" : "NULL::text[]"} AS quem_emails
         FROM tarefa_pedidos tp LEFT JOIN users u ON u.id = tp.pedido_por`,
    );
  const r = await ler(true)
    // Banco antes da 021 (sem quem_emails): a rodada do Notion não para por isso.
    .catch((e: unknown) => ((e as { code?: string })?.code === "42703" ? ler(false) : Promise.reject(e)))
    .catch((e: unknown) => {
      // Banco antes da 020: nenhuma ação é pedido.
      if (semTabela(e)) return [] as (PedidoNaRodada & { tarefa_id: string })[];
      throw e;
    });
  return new Map(r.map(({ tarefa_id, ...x }) => [tarefa_id, x]));
}

/** Pedido: Person e Assign valem juntos e a 1ª do Assign manda (sem Assign, a do Person). */
const listaDoPedido = (p: PaginaLida) => (p.listaAssign.length ? p.listaAssign : p.listaPerson);

/** As pessoas do Notion destes e-mails (pela conta no Ações ou pelo e-mail de lá), na ordem; quem não está lá fica de fora. */
async function pessoasNotionNa(c: Conexao, emails: string[]): Promise<string[]> {
  const lista = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!lista.length) return [];
  const r = await query<{ notion_user_id: string | null }>(
    `SELECT (SELECT np.notion_user_id FROM notion_pessoas np
               LEFT JOIN users u ON u.id = np.user_id AND u.deleted_at IS NULL
              WHERE np.conexao_id = $2 AND (LOWER(u.email) = e.email OR LOWER(np.email) = e.email)
              ORDER BY (np.user_id IS NULL), np.atualizado_em DESC LIMIT 1) AS notion_user_id
       FROM unnest($1::text[]) WITH ORDINALITY AS e(email, ordem)
      ORDER BY e.ordem`,
    [lista, c.id],
  );
  return [...new Set(r.map((x) => x.notion_user_id).filter((x): x is string => !!x))];
}

/** Quem recebe um pedido e está no Notion do marketing (ids de lá, na ordem). Vazio sem a ligação. */
export async function pessoasNotionDosEmails(emails: string[]): Promise<string[]> {
  const c = emails.length ? await conexaoAtiva() : null;
  return c ? pessoasNotionNa(c, emails) : [];
}

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

/** Quem aparece nas tarefas do Notion: se é da Welcome no TTARS (e-mail ou nome inteiro), vira colega no
 *  Ações e entra nos projetos do marketing. `soNome`: quem só criou a tarefa (guarda nome e e-mail, sem
 *  conta nem acesso). */
async function registrarPessoas(c: Conexao, pessoas: { id: string; nome: string; email: string | null }[], quadros: string[], soNome = false) {
  const vistas = new Map(pessoas.map((p) => [p.id, p]));
  for (const p of vistas.values()) {
    if (soNome) {
      await query(
        `INSERT INTO notion_pessoas (conexao_id, notion_user_id, nome, email, user_id, atualizado_em)
         VALUES ($1, $2, $3, $4, NULL, now())
         ON CONFLICT (conexao_id, notion_user_id) DO UPDATE
           SET nome = EXCLUDED.nome, email = COALESCE(EXCLUDED.email, notion_pessoas.email), atualizado_em = now()`,
        [c.id, p.id, nomeLimpo(p.nome) || "Pessoa do Notion", p.email],
      );
      continue;
    }
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
export function pessoaDaAcao(t: TarefaCrua, pessoas: Map<string, PessoaNotion>, antes: string | undefined): string {
  const lista = [...pessoas.values()];
  if (t.responsavel_user_id) {
    const p = lista.find((x) => x.user_id === t.responsavel_user_id);
    if (p) return p.notion_user_id;
  }
  const alvo = slugNome(t.owner);
  // Sem ninguém do Ações (só o nome), só o nome inteiro vale: pelo primeiro nome, alguém de fora da
  // Welcome ("Paula", do fornecedor) virava a Paula do marketing no Notion (29/09/2026).
  const porNome = lista.find(
    (x) => slugNome(x.nome) === alvo || (!!t.responsavel_user_id && slugNome(x.nome).split("-")[0] === alvo),
  );
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
  // Projeto que foi pra lixeira some da consulta. Sumir numa leitura não basta: confere a página
  // (404 ou lixeira = saiu; senão, vale o que ela diz).
  const vistos = new Set(lidos.map((p) => p.pageId));
  for (const g of guardados.values()) {
    if (vistos.has(g.page_id) || g.no_lixo) continue;
    const pg = await lerPaginaDoNotion(c.token, g.page_id).catch((e) => {
      if (e instanceof ErroDoNotion && e.status === 404) return null;
      throw e;
    });
    lidos.push(
      pg
        ? lerProjeto(pg)
        : { pageId: g.page_id, url: g.url, nome: g.nome, etapa: g.etapa, inicio: g.inicio, fim: g.fim, lider: g.lider, noLixo: true, editadoEm: new Date().toISOString() },
    );
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
  // Preso ao projeto do Notion antes de qualquer outro passo: se cair no meio, não nasce outro.
  await query(`UPDATE notion_projetos SET quadro_id = $2 WHERE page_id = $1`, [pageId, q.id]);
  g.quadro_id = q.id;
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
  return q.id;
}

/** O projeto de lá que vale: o que a tarefa aponta, se ele existe e não foi arquivado. */
function projetoVivo(r: Rodada, pageId: string): string {
  const g = pageId ? r.projetos.get(pageId) : undefined;
  return g && !arquivado(g) ? pageId : "";
}

/** O 1º projeto vivo da coluna Project da página (quase sempre há um só). */
function primeiroVivo(r: Rodada, p: PaginaLida): string {
  return (p.projetos ?? [p.projeto]).map((x) => projetoVivo(r, x)).find(Boolean) ?? "";
}

/** A "última vez" com o projeto que vale hoje. Projeto arquivado (ou que a conexão não vê) conta
 *  como sem projeto dos TRÊS lados: arquivar lá nunca faz o Ações apagar o projeto da tarefa lá. */
function ultimosQueValem(r: Rodada, ultimos: Partial<Campos>): Partial<Campos> {
  if (!r.projetosOk || !("projeto" in ultimos)) return ultimos;
  return { ...ultimos, projeto: projetoVivo(r, ultimos.projeto ?? "") };
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
  const projeto = r.projetosOk ? primeiroVivo(r, p) : "";
  // O vínculo vem logo depois de criar (falha daqui pra frente não vira outra ação) e SEM o projeto:
  // ele só entra na "última vez" depois que a ação está nele. Se pôr no projeto falhar, a próxima
  // leitura decide pelo Notion, e nunca parece que o Ações tirou a ação do projeto.
  const valendo: Partial<Campos> = { ...p };
  delete valendo.projeto;
  await gravarLink(c, p, { tarefa_id: criada.id, tarefa_dono_id: c.dono_user_id }, valendo as Campos, p.statusNotion);
  // Sem a base Projects nesta rodada: entra no principal e a próxima rodada decide o projeto.
  await colocarNoLugar(c, r, criada.id, projeto);
  if (!r.projetosOk) return;
  await query(`UPDATE notion_paginas SET ultimos = jsonb_set(ultimos, '{projeto}', to_jsonb($2::text)) WHERE page_id = $1`, [p.pageId, projeto]);
}

async function tratarPagina(c: Conexao, r: Rodada, p: PaginaLida, pessoas: Map<string, PessoaNotion>) {
  r.lidas.set(p.pageId, p);
  const link = await linkDaPagina(p.pageId);
  if (!link) {
    if (!p.noLixo) await criarAcaoDaPagina(c, r, p, pessoas);
    return;
  }
  const pedido = r.pedidos.has(link.tarefa_id);
  if (pedido) p = { ...p, pessoa: p.assign || p.pessoa };
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
  const projetoLa = r.projetosOk ? primeiroVivo(r, p) : projetoAqui;
  const noNotion: Campos = { ...p, projeto: projetoLa, status: p.noLixo ? "cancelada" : p.status };
  const d = decidir(noNotion, noAcoes, ultimosQueValem(r, link.ultimos), { notion: p.editadoEm, acoes: iso(t.updated_at) });
  const editor = p.editadoPor ? (pessoas.get(p.editadoPor)?.nome ?? null) : null;
  if (Object.keys(d.paraAcoes).length) await aplicarNaAcao(c, r, link, d.paraAcoes, pessoas, editor);
  let statusNotion = p.statusNotion;
  let editadoEm = p.editadoEm;
  if (Object.keys(d.paraNotion).length) {
    const res = await empurrarCampos(c, p.pageId, d.paraNotion, p.statusNotion, p.campoDescricao, pedido && { pessoasLa: listaDoPedido(p) });
    statusNotion = res.statusNotion;
    editadoEm = res.editadoEm ?? editadoEm;
  }
  const valendo: Campos = { ...noAcoes, ...d.paraAcoes, ...d.paraNotion } as Campos;
  if (!r.projetosOk && !("projeto" in link.ultimos)) delete (valendo as Partial<Campos>).projeto;
  await gravarLink(c, { ...p, editadoEm }, link, valendo, statusNotion);
}

/**
 * Grava no Notion; cancelada vai pra lixeira, reaberta volta dela. `pedido` (página de pedido ao marketing):
 * a pessoa vai em Person e Assign e só a 1ª muda; as outras de lá ficam (`pessoasLa`, ou lidas na hora).
 */
async function empurrarCampos(
  c: Conexao,
  pageId: string,
  mudanca: Partial<Campos>,
  statusAnterior: string | null,
  campoDescricao?: CampoDaDescricao | string | null,
  pedido: false | { pessoasLa?: string[] } = false,
) {
  const { status, ...resto } = mudanca;
  const vaiProLixo = status === "cancelada";
  let pessoas: string[] | undefined;
  if (pedido && mudanca.pessoa !== undefined) {
    const la = pedido.pessoasLa ?? listaDoPedido(lerPagina(await lerPaginaDoNotion(c.token, pageId)));
    pessoas = trocarPrimeiraPessoa(la, mudanca.pessoa);
  }
  const props = propriedadesPara(status && !vaiProLixo ? { ...resto, status } : resto, {
    statusAnterior,
    campoDescricao: campoDescricao === "Text" || campoDescricao === "Ambos" ? campoDescricao : "Description",
    assign: !!pedido,
    pessoas,
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
    if (!pg) continue;
    try {
      await tratarPagina(c, r, lerPagina(pg), pessoas);
    } catch (e) {
      r.avisos.push(`uma tarefa do Notion não foi conferida (${e instanceof Error ? e.message.slice(0, 200) : String(e)})`);
    }
  }
}

// Quem criou uma página e o Notion não devolve (convidado que saiu, robô): não pergunta de novo.
const criadoresSemResposta = new Set<string>();

/** Quem criou páginas e ainda não é conhecido: o Notion diz nome e e-mail. */
async function pessoasQueCriaram(c: Conexao, paginas: PaginaLida[], pessoas: Map<string, PessoaNotion>) {
  const ids = [
    ...new Set(paginas.map((p) => p.criadoPor).filter((x): x is string => !!x && !pessoas.has(x) && x !== c.bot_id && !criadoresSemResposta.has(x))),
  ];
  const out: { id: string; nome: string; email: string | null }[] = [];
  for (const id of ids) {
    const u = await lerPessoa(c.token, id).catch(() => null);
    if (!u || u.type === "bot") {
      criadoresSemResposta.add(id);
      continue;
    }
    out.push({ id, nome: nomeLimpo(u.name) || "Pessoa do Notion", email: u.person?.email?.toLowerCase() ?? null });
  }
  return out;
}

async function puxar(c: Conexao, r: Rodada, pessoas: Map<string, PessoaNotion>): Promise<Map<string, PessoaNotion>> {
  const completa = !c.cursor_editado || Date.now() - ultimaVarreduraCompleta > 10 * 60_000;
  const desde = completa ? null : new Date(Date.parse(c.cursor_editado!) - 3 * 60_000).toISOString();
  const paginas = (await paginasEditadas(c.token, c.data_source_id, desde)).map(lerPagina);
  // Quem faz (Person/Assign) e é do TTARS entra nos projetos do marketing UMA vez, quando aparece
  // fazendo pela primeira vez (depois, "sair do projeto" vale). Quem só CRIOU a tarefa lá (outra
  // área pedindo algo) entra só com o nome, pra "quem pediu"; se um dia aparecer fazendo, é aí que
  // entra (por isso quem ainda não tem conta aqui é olhado de novo). 29/09: sem sujeira.
  const novasPessoas = paginas.flatMap((p) => p.pessoas).filter((x) => !pessoas.get(x.id)?.user_id);
  if (novasPessoas.length) {
    await registrarPessoas(c, novasPessoas, quadrosDaRodada(c, r.projetos));
    pessoas = await pessoasDaConexao(c);
  }
  if (bancoNovo) {
    const criadores = await pessoasQueCriaram(c, paginas, pessoas);
    if (criadores.length) {
      await registrarPessoas(c, criadores, [], true);
      pessoas = await pessoasDaConexao(c);
    }
  }
  // O banco devolve o cursor como data: compara sempre em texto ISO (antes ele nunca andava).
  const antes = c.cursor_editado ? iso(c.cursor_editado) : null;
  let maior = antes;
  const falhas: string[] = [];
  for (const p of paginas) {
    try {
      await tratarPagina(c, r, p, pessoas);
    } catch (e) {
      // Uma página com problema não trava as outras; o cursor não passa dela (tenta de novo).
      falhas.push(`${p.titulo}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!falhas.length && (!maior || p.editadoEm > maior)) maior = p.editadoEm;
  }
  if (falhas.length) r.avisos.push(`${falhas.length} ${falhas.length === 1 ? "tarefa do Notion não entrou" : "tarefas do Notion não entraram"} (${falhas[0].slice(0, 200)})`);
  if (maior && maior !== antes) await query(`UPDATE notion_conexoes SET cursor_editado = $2 WHERE id = $1`, [c.id, maior]);
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
      const antes = ultimosQueValem(r, l.ultimos);
      const projetoAqui = r.projetosOk ? (r.lugares.get(t.id)?.projeto ?? "") : (l.ultimos.projeto ?? "");
      const trocouDeProjeto = r.projetosOk && "projeto" in antes && projetoAqui !== (antes.projeto ?? "");
      if (!trocouDeProjeto && Date.parse(iso(t.updated_at)) <= Date.parse(iso(l.sincronizado_em))) continue;
      const agora = camposDaAcao(t, pessoas, l.ultimos, projetoAqui);
      const mudou: Partial<Campos> = {};
      for (const k of CHAVES) {
        if (k === "projeto" && (!r.projetosOk || !("projeto" in antes))) continue;
        if (String(antes[k] ?? "") !== String(agora[k] ?? "")) (mudou as Record<string, unknown>)[k] = agora[k];
      }
      if (!Object.keys(mudou).length) {
        await query(`UPDATE notion_paginas SET sincronizado_em = now() WHERE page_id = $1`, [l.page_id]);
        continue;
      }
      const feito = await empurrarCampos(c, l.page_id, mudou, l.status_notion, l.campo_descricao, r.pedidos.has(l.tarefa_id) && {});
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
    // Cancelada não vai: lá ela nasceria viva ("Not started") e voltaria aberta pra cá.
    const t = await lerAcao(s.dono_id, s.tarefa_id);
    if (!t || t.status === "cancelada") continue;
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
    do_hub: EscolhasDoHub | null;
  }>(
    `SELECT e.tarefa_id::text AS tarefa_id, e.tarefa_dono_id::text AS tarefa_dono_id, e.notion_user_id, e.bu,
            e.pedido_por::text AS pedido_por, e.tentativas, e.do_hub
       FROM notion_envios e
      WHERE e.conexao_id = $1 AND e.tentativas < 5
        AND NOT EXISTS (SELECT 1 FROM notion_paginas p WHERE p.tarefa_id = e.tarefa_id)`,
    [c.id],
  );
  // Pedido feito no meio desta rodada (depois da leitura do começo): lido de novo agora, depois da fila,
  // para a página nunca nascer como página comum (sem o projeto, o Assign e a área do formulário).
  if (pendentes.length) r.pedidos = await pedidosDaRodada();
  for (const e of pendentes) {
    try {
      const t = await lerAcao(e.tarefa_dono_id, e.tarefa_id);
      if (!t || t.status === "cancelada") {
        await query(`DELETE FROM notion_envios WHERE tarefa_id = $1`, [e.tarefa_id]);
        continue;
      }
      const pedido = r.pedidos.get(t.id);
      // Pedido ao marketing: nasce no projeto do formulário (se ele existe e não foi arquivado lá).
      const projeto =
        pedido && projetoVivo(r, pedido.projeto) ? pedido.projeto : r.projetosOk ? (r.lugares.get(t.id)?.projeto ?? "") : "";
      // Pedido: Person e Assign com todas as pessoas que recebem e estão no Notion, na ordem (a 1ª faz; quem o
      // marketing escolheu ao mandar vai na frente).
      const doPedido = pedido?.quem_emails?.length ? await pessoasNotionNa(c, pedido.quem_emails) : [];
      const lista = pedido && e.notion_user_id ? [e.notion_user_id, ...doPedido.filter((x) => x !== e.notion_user_id)] : doPedido;
      const primeira = lista[0] ?? e.notion_user_id ?? null;
      const campos = camposDaAcao(t, pessoas, { pessoa: primeira ?? undefined }, projeto);
      if (primeira) campos.pessoa = primeira;
      const quem = e.pedido_por
        ? (await query<{ nome: string }>(`SELECT nome FROM users WHERE id = $1`, [e.pedido_por]))[0]?.nome
        : null;
      const hub = e.do_hub;
      // Pedido: a área é a do pedido (nunca a da aba de quem mexeu antes de a página nascer). Nova pelo Hub: nasce
      // como foi escolhida, igual ao New de lá: a situação (se ainda quer dizer a mesma daqui), quem faz em Person
      // e Assign, e prioridade e área vazias quando ninguém escolheu.
      const props = propriedadesPara(campos, {
        bu: hub ? (hub.bu ?? null) : (pedido?.bu ?? e.bu ?? "Institucional"),
        assign: !!pedido || !!hub,
        pessoas: lista,
        statusAnterior: hub?.situacao ?? null,
      });
      if (hub && !hub.prioridade) delete props[PROPS.prioridade];
      const pg = await criarPagina(
        c.token,
        c.data_source_id,
        props,
        pedido ? `Pedido por ${pedido.quem ?? quem ?? "alguém"} pelo TTARS, ${diaMesBR(pedido.criado_em)}` : `Pedido por ${quem ?? "alguém"} no Ações.`,
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
  /** Nova pelo Hub do Marketing: a página nasce como foi escolhida lá (023_envio_com_situacao.sql). */
  doHub?: EscolhasDoHub | null;
}): Promise<boolean> {
  const c = await conexaoAtiva();
  if (!c) return false;
  await query(
    `INSERT INTO notion_envios (tarefa_id, tarefa_dono_id, conexao_id, notion_user_id, bu, pedido_por, do_hub)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tarefa_id) DO UPDATE SET notion_user_id = COALESCE(EXCLUDED.notion_user_id, notion_envios.notion_user_id),
       bu = COALESCE(EXCLUDED.bu, notion_envios.bu), do_hub = COALESCE(EXCLUDED.do_hub, notion_envios.do_hub),
       tentativas = 0, erro = NULL`,
    [opts.tarefaId, opts.donoId, c.id, opts.notionUserId ?? null, opts.bu ?? null, opts.pedidoPor, opts.doHub ? JSON.stringify(opts.doHub) : null],
  );
  return true;
}

/** O que foi escolhido na Nova tarefa do Hub: a situação de lá, se a prioridade foi escolhida e a área. */
export type EscolhasDoHub = { situacao: string | null; prioridade: boolean; bu: string | null };

// ── cada ação no seu projeto ──────────────────────────────────────────────────────────

/** Toda ação ligada fica em um projeto só do marketing: o do Notion ou o principal. Projeto
 *  arquivado lá = sem projeto: a "última vez" passa a dizer isso também, senão a arrumação daqui
 *  pareceria uma mudança feita no Ações e iria pro Notion quando o projeto voltasse. */
async function arrumarLugares(c: Conexao, r: Rodada) {
  const links = await query<{ page_id: string; tarefa_id: string; projeto: string | null; tem: boolean }>(
    `SELECT page_id, tarefa_id::text AS tarefa_id, ultimos ->> 'projeto' AS projeto, ultimos ? 'projeto' AS tem
       FROM notion_paginas WHERE conexao_id = $1`,
    [c.id],
  );
  for (const l of links) {
    if (!l.tem) continue;
    const certo = projetoVivo(r, l.projeto ?? "");
    if (certo !== (l.projeto ?? "")) {
      await query(`UPDATE notion_paginas SET ultimos = jsonb_set(ultimos, '{projeto}', to_jsonb($2::text)) WHERE page_id = $1`, [l.page_id, certo]);
    }
    const lugar = r.lugares.get(l.tarefa_id);
    const destino = certo ? r.projetos.get(certo)?.quadro_id : c.quadro_id;
    if (lugar && lugar.quadros.length === 1 && destino && lugar.quadros[0] === destino) continue;
    await colocarNoLugar(c, r, l.tarefa_id, certo);
  }
}

// ── arquivos ──────────────────────────────────────────────────────────────────────────

type AnexoDoAcoes = {
  id: string;
  tarefa_id: string;
  tipo: "link" | "arquivo";
  url: string | null;
  titulo: string | null;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
};

/** O Notion do marketing é do plano grátis: arquivo até 5 MB por envio. Maior fica só no Ações. */
const MAX_PRO_NOTION = 5 * 1024 * 1024;

/** Mesmo nome de arquivo (o Mac escreve acento decomposto; o Notion corta em 100 e apara). */
const mesmoNome = (a: string, b: string) => a.normalize("NFC").trim().slice(0, 100) === b.normalize("NFC").trim().slice(0, 100);

// Erro passageiro ao subir arquivo (rede, 429, 5xx): tenta de novo nas próximas rodadas; na 5ª, desiste.
const falhasDeEnvio = new Map<string, number>();

/** Mesmo endereço, escrito de jeitos diferentes (barra no fim, maiúscula no domínio). */
const mesmoLink = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normalizeUrl(a ?? "");
  return !!x && x === normalizeUrl(b ?? "");
};

/** Baixa o arquivo guardado no Notion sem passar do limite (nunca lê um vídeo enorme inteiro na memória). */
async function baixarComLimite(url: string, max: number): Promise<{ bytes: Uint8Array; tipo: string | null } | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!r?.ok || !r.body) return null;
  const tamanho = Number(r.headers.get("content-length") || "0");
  if (tamanho > max) {
    await r.body.cancel().catch(() => undefined);
    return null;
  }
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    bytes.set(p, pos);
    pos += p.length;
  }
  return { bytes, tipo: r.headers.get("content-type") };
}

/** Grava o anexo e, na MESMA transação, o registro dele (`registrar`): queda no meio nunca deixa
 *  anexo sem registro (que viraria outro anexo na rodada seguinte). */
type Registrar = (db: PoolClient, anexoId: string) => Promise<void>;

async function novoAnexoLink(l: Link, url: string, titulo: string | null, registrar: Registrar): Promise<string | null> {
  return withTenant(l.tarefa_dono_id, async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO tarefa_anexos (tarefa_id, tipo, url, titulo, ordem)
       VALUES ($1, 'link', $2, $3, COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
       RETURNING id::text AS id`,
      [l.tarefa_id, url, titulo ? titulo.slice(0, 200) : null],
    );
    const id = r.rows[0]?.id ?? null;
    if (id) await registrar(db, id);
    return id;
  });
}

/** Arquivo do Notion vira anexo da ação: link fica link; arquivo guardado lá é baixado (o link de
 *  lá vence em 1 hora). Grande demais, de tipo que o Ações não guarda ou que não baixou: fica o
 *  caminho pra abrir no Notion. Devolve "" quando não há o que guardar (link inválido). */
async function anexoDoNotion(l: Link, f: ArquivoDoNotion, registrar: Registrar): Promise<string | null> {
  if (f.tipo === "external") {
    const url = normalizeUrl(f.url);
    if (!url) return "";
    return novoAnexoLink(l, url, f.nome && f.nome !== f.url ? f.nome : null, registrar);
  }
  const nome = sanitizeFilename(f.nome.split("?")[0].split("/").pop() || f.nome) || "arquivo";
  const baixado = isAllowedFile(nome) ? await baixarComLimite(f.url, MAX_FILE_BYTES) : null;
  if (baixado) {
    const tipo = resolveContentType(nome, baixado.tipo);
    return withTenant(l.tarefa_dono_id, async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO tarefa_anexos (tarefa_id, tipo, filename, content_type, size_bytes, conteudo, titulo, ordem)
         VALUES ($1, 'arquivo', $2, $3, $4, $5, NULL, COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
         RETURNING id::text AS id`,
        [l.tarefa_id, nome, tipo, baixado.bytes.length, Buffer.from(baixado.bytes)],
      );
      const id = r.rows[0]?.id ?? null;
      if (id) await registrar(db, id);
      return id;
    });
  }
  return l.url ? novoAnexoLink(l, l.url, `${nome} (abrir no Notion)`, registrar) : "";
}

/** Como um arquivo que já está no Notion volta na lista ao gravar (a lista vai inteira; conferido
 *  no Notion de verdade: o arquivo guardado lá volta pelo link dele e mantém o caminho). */
function arquivoQueFica(f: ArquivoDoNotion): Record<string, unknown> {
  return f.tipo === "file"
    ? { name: f.nome.slice(0, 100), type: "file", file: { url: f.url } }
    : { name: f.nome.slice(0, 100), type: "external", external: { url: f.url } };
}

/** Anexo do Ações que vai pro Notion: link vira link; arquivo sobe pro Notion. null = não vai. */
async function arquivoParaNotion(c: Conexao, l: Link, a: AnexoDoAcoes): Promise<Record<string, unknown> | null> {
  if (a.tipo === "link") {
    const url = normalizeUrl(a.url ?? "");
    return url ? { name: (a.titulo || url).slice(0, 100), type: "external", external: { url } } : null;
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

/**
 * Arquivos nos dois sentidos. `notion_paginas.arquivos` guarda, por arquivo, a chave dele no
 * Notion e o anexo do Ações: é o que diz de que lado ele entrou ou saiu. Tudo casa pela chave
 * (nunca pela ordem). O que não pode ir pro Notion (grande, tipo, erro) fica marcado "só aqui"
 * e não tenta de novo a cada rodada.
 */
async function sincronizarArquivos(c: Conexao, r: Rodada) {
  const links = await linksDaConexao(c);
  for (const [dono, lista] of porDono(links)) {
    const res = await withTenant(dono, (db) =>
      db.query<AnexoDoAcoes>(
        `SELECT id::text AS id, tarefa_id::text AS tarefa_id, tipo, url, titulo, filename, content_type, size_bytes
           FROM tarefa_anexos WHERE tarefa_id = ANY($1::uuid[]) ORDER BY ordem, created_at`,
        [lista.map((l) => l.tarefa_id)],
      ),
    );
    for (const l of lista) {
      try {
        let guardados: ArquivoGuardado[] = Array.isArray(l.arquivos) ? [...l.arquivos] : [];
        const aqui = new Map(res.rows.filter((a) => a.tarefa_id === l.tarefa_id).map((a) => [a.id, a]));
        const lida = r.lidas.get(l.page_id);
        let mudou = false;
        // Notion → Ações: só com a página lida nesta rodada.
        if (lida && !lida.noLixo) {
          for (const f of lida.arquivos) {
            if (guardados.some((g) => g.chave === f.chave)) continue;
            const item: ArquivoGuardado = { chave: f.chave, anexo_id: "", nome: f.nome };
            const anexo = await anexoDoNotion(l, f, (db, id) =>
              db.query(`UPDATE notion_paginas SET arquivos = $2 WHERE page_id = $1`, [l.page_id, JSON.stringify([...guardados, { ...item, anexo_id: id }])]).then(() => undefined),
            );
            if (anexo === null) continue;
            guardados.push({ ...item, anexo_id: anexo });
            if (anexo) aqui.set(anexo, { id: anexo, tarefa_id: l.tarefa_id, tipo: "link", url: null, titulo: null, filename: null, content_type: null, size_bytes: null });
            mudou = true;
          }
          // Saiu do Notion: sai do Ações (o que é "só aqui" nunca esteve lá e fica).
          const chaves = new Set(lida.arquivos.map((f) => f.chave));
          for (const g of guardados.filter((x) => !x.so_aqui && !chaves.has(x.chave))) {
            const outro = guardados.some((x) => x !== g && x.anexo_id === g.anexo_id);
            const sobram = guardados.filter((x) => x !== g);
            // Apagar e tirar do registro juntos.
            await withTenant(l.tarefa_dono_id, async (db) => {
              if (g.anexo_id && !outro) await db.query(`DELETE FROM tarefa_anexos WHERE id = $1 AND tarefa_id = $2`, [g.anexo_id, l.tarefa_id]);
              await db.query(`UPDATE notion_paginas SET arquivos = $2 WHERE page_id = $1`, [l.page_id, JSON.stringify(sobram)]);
            });
            if (g.anexo_id && !outro) aqui.delete(g.anexo_id);
            guardados = sobram;
            mudou = true;
          }
        }
        // Ações → Notion.
        const novos = [...aqui.values()].filter((a) => !guardados.some((g) => g.anexo_id === a.id));
        let sumidos = guardados.filter((g) => g.anexo_id && !aqui.has(g.anexo_id));
        // Apagou o anexo que estava lá, mas sobra aqui uma cópia "só aqui" do mesmo link: a cópia
        // passa a ser aquele arquivo (o link fica lá).
        for (const s of [...sumidos]) {
          if (s.so_aqui) continue;
          const copia = guardados.find((g) => g.so_aqui && g.anexo_id && aqui.has(g.anexo_id) && aqui.get(g.anexo_id)!.tipo === "link" && mesmoLink(aqui.get(g.anexo_id)!.url, s.chave));
          if (!copia) continue;
          guardados = guardados.map((g) => (g === copia ? { chave: s.chave, anexo_id: copia.anexo_id, nome: s.nome } : g)).filter((g) => g !== s);
          sumidos = sumidos.filter((x) => x !== s);
          mudou = true;
        }
        if (novos.length || sumidos.length) {
          const antes = lerPagina(await lerPaginaDoNotion(c.token, l.page_id));
          // O mesmo link que já está lá (ou que já foi): casa com ele em vez de mandar outra cópia.
          const vao: { anexo: AnexoDoAcoes; valor: Record<string, unknown> }[] = [];
          for (const a of novos) {
            const jaLa = a.tipo === "link" ? antes.arquivos.find((f) => f.tipo === "external" && mesmoLink(f.url, a.url)) : undefined;
            if (jaLa) {
              const dono = guardados.find((g) => g.chave === jaLa.chave && g.anexo_id && aqui.has(g.anexo_id));
              guardados.push(dono ? { chave: `aqui:${a.id}`, anexo_id: a.id, nome: a.titulo || a.url || "link", so_aqui: true } : { chave: jaLa.chave, anexo_id: a.id, nome: jaLa.nome });
              mudou = true;
              continue;
            }
            let valor: Record<string, unknown> | null;
            try {
              valor = await arquivoParaNotion(c, l, a);
            } catch (e) {
              // Recusa do Notion (400) é definitiva; o resto (rede, 429, 5xx) tenta de novo depois.
              const vezes = (falhasDeEnvio.get(a.id) ?? 0) + 1;
              falhasDeEnvio.set(a.id, vezes);
              console.error("[notion] subir arquivo", l.page_id, e instanceof Error ? e.message : e);
              if (!(e instanceof ErroDoNotion && e.status === 400) && vezes < 5) continue;
              valor = null;
            }
            if (valor) vao.push({ anexo: a, valor });
            else {
              guardados.push({ chave: `aqui:${a.id}`, anexo_id: a.id, nome: a.filename || a.titulo || "anexo", so_aqui: true });
              mudou = true;
            }
          }
          // Apagado no Ações sai de lá, a não ser que outro anexo daqui ainda seja aquele arquivo.
          const tirar = new Set(
            sumidos.filter((s) => !s.so_aqui && !guardados.some((g) => g !== s && g.chave === s.chave && g.anexo_id && aqui.has(g.anexo_id))).map((s) => s.chave),
          );
          guardados = guardados.filter((g) => !sumidos.includes(g));
          if (sumidos.length) mudou = true;
          if (vao.length || antes.arquivos.some((f) => tirar.has(f.chave))) {
            // Relê logo antes de gravar: o envio leva segundos e alguém pode ter posto arquivo lá.
            const agora = vao.length ? lerPagina(await lerPaginaDoNotion(c.token, l.page_id)) : antes;
            const ficam = agora.arquivos.filter((f) => !tirar.has(f.chave));
            const gravada = lerPagina(
              await mudarPagina(c.token, l.page_id, {
                properties: { [PROPS.arquivos]: { files: [...ficam.map(arquivoQueFica), ...vao.map((v) => v.valor)] } },
              }),
            );
            const chegaram = gravada.arquivos.filter((f) => !ficam.some((x) => x.chave === f.chave));
            for (const v of vao) {
              const url = (v.valor.external as { url?: string } | undefined)?.url;
              const f = url
                ? chegaram.find((x) => x.tipo === "external" && mesmoLink(x.url, url))
                : chegaram.find((x) => x.tipo === "file" && mesmoNome(x.nome, String(v.valor.name)));
              if (!f) {
                guardados.push({ chave: `aqui:${v.anexo.id}`, anexo_id: v.anexo.id, nome: String(v.valor.name), so_aqui: true });
                continue;
              }
              chegaram.splice(chegaram.indexOf(f), 1);
              guardados.push({ chave: f.chave, anexo_id: v.anexo.id, nome: f.nome });
              falhasDeEnvio.delete(v.anexo.id);
            }
            // Registro logo depois de gravar lá (a janela de queda fica mínima).
            await query(`UPDATE notion_paginas SET arquivos = $2 WHERE page_id = $1`, [l.page_id, JSON.stringify(guardados)]);
            mudou = true;
          }
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
  const inclusiveFechadas = todas && Date.now() - ultimaLeituraDeTodosOsComentarios > A_CADA_COMENTARIOS_TODAS;
  const recente = (l: Link) => !!l.editado_notion && Date.now() - Date.parse(iso(l.editado_notion)) < 3 * 86_400_000;
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
    if (!mexida(l) && !(todas && (inclusiveFechadas || !fechada(l) || recente(l)))) continue;
    try {
      const lista = await comentariosDaPagina(c.token, l.page_id);
      const ja = await query<{ comment_id: string; comentario_id: string | null; origem: string }>(
        `SELECT comment_id, comentario_id::text AS comentario_id, origem FROM notion_comentarios WHERE page_id = $1`,
        [l.page_id],
      );
      const conhecidos = new Map(ja.map((x) => [x.comment_id, x]));
      for (const cm of lista) {
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
        // A cópia e o registro na mesma transação: nunca fica cópia sem registro (que viraria outra
        // cópia na rodada seguinte). Cópia sem registro de uma rodada que caiu é reconhecida.
        await withTenant(l.tarefa_dono_id, async (db) => {
          const ja = await db.query<{ id: string }>(
            `SELECT cm.id::text AS id FROM tarefa_comentarios cm
              WHERE cm.tarefa_id = $1 AND cm.texto = $2 AND cm.created_at = $3
                AND NOT EXISTS (SELECT 1 FROM notion_comentarios n WHERE n.comentario_id = cm.id)
              LIMIT 1`,
            [l.tarefa_id, corpo, cm.created_time],
          );
          const id =
            ja.rows[0]?.id ??
            (
              await db.query<{ id: string }>(
                `INSERT INTO tarefa_comentarios (tarefa_id, texto, autor_user_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
                [l.tarefa_id, corpo, autor?.user_id ?? c.dono_user_id, cm.created_time],
              )
            ).rows[0]?.id;
          await db.query(
            `INSERT INTO notion_comentarios (comment_id, conexao_id, page_id, comentario_id, origem) VALUES ($1, $2, $3, $4, 'notion') ON CONFLICT DO NOTHING`,
            [cm.id, c.id, l.page_id, id ?? null],
          );
        });
      }
      // Não apaga aqui o que sumiu da leitura: o Notion só devolve discussão NÃO resolvida, e
      // resolver uma discussão lá não é apagar a conversa.
    } catch (e) {
      console.error("[notion] comentários", l.page_id, e instanceof Error ? e.message : e);
    }
  }
  if (todas) await query(`UPDATE notion_conexoes SET comentarios_em = now() WHERE id = $1`, [c.id]);
  if (inclusiveFechadas) ultimaLeituraDeTodosOsComentarios = Date.now();
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
      // Registra ANTES de mandar: se o registro falhar, nada vai; se cair depois de mandar, o
      // registro "pendente" já impede mandar de novo (nunca sai duplicado no Notion).
      const pendente = `pendente:${cm.id}`;
      const marcado = await query<{ comment_id: string }>(
        `INSERT INTO notion_comentarios (comment_id, conexao_id, page_id, comentario_id, origem) VALUES ($1, $2, $3, $4, 'acoes')
         ON CONFLICT DO NOTHING RETURNING comment_id`,
        [pendente, c.id, pageId, cm.id],
      ).catch((e) => {
        console.error("[notion] registrar comentário", pageId, e instanceof Error ? e.message : e);
        return [];
      });
      if (!marcado.length) continue;
      try {
        const criado = await comentarNaPagina(c.token, pageId, `${nomeLimpo(cm.autor) || "Alguém"} (pelo TTARS): ${cm.texto}`);
        await query(`UPDATE notion_comentarios SET comment_id = $2 WHERE comment_id = $1`, [pendente, criado.id]);
      } catch (e) {
        // Não foi: tira o registro pra tentar de novo na próxima rodada.
        await query(`DELETE FROM notion_comentarios WHERE comment_id = $1`, [pendente]).catch(() => undefined);
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
    const r: Rodada = { projetos: new Map(), projetosOk: false, lugares: new Map(), lidas: new Map(), avisos: [], pedidos: await pedidosDaRodada() };
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
    const aviso = r.avisos.length ? r.avisos.join(" · ").slice(0, 500) : null;
    await query(`UPDATE notion_conexoes SET ultima_rodada = now(), ultimo_erro = $2 WHERE id = $1`, [c.id, aviso]);
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
    `SELECT x.id::text AS tarefa_id, p.url, COALESCE(p.status_notion, e.do_hub ->> 'situacao') AS status_notion, p.bu, p.editado_notion,
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

// Pedidos ao Marketing (aprovado pelo Vitor em 30/09/2026, "A e C"): quem é da Welcome pede ao marketing
// pelo TTARS num formulário; o pedido vira uma ação de quem pediu (quem faz = a pessoa do marketing do
// formulário, "eu cobro") e uma página no Notion do marketing (Person e Assign, projeto e área do formulário).
// Quem monta os formulários (pedido_montadores ou administrador) cria, publica, desliga e conta quem vê.
//
// Ordem de um pedido (a página do Notion nunca nasce pela metade): cria a ação SEM entrar na fila do Notion
// → grava o pedido (tarefa_pedidos, com o projeto) → quem também faz e quem vê → só então pede o envio ao Notion.
// 01/10/2026 (sem limites): várias pessoas recebem (a 1ª faz, as outras também fazem), vários times
// acompanham, quem pediu completa as respostas depois, prazo pela data de uma pergunta, área pela marca de
// quem pede, repetido só nos formulários de um pedido por casamento, e quem monta muda pela tela.
import type { User } from "./auth";
import { query, withTenant } from "./db";
import { diaMesBR } from "./data-br";
import { acessoTarefa, garantirColegaDoTtars, pessoasDaEquipe, registrarEvento } from "./equipe-compartilhado";
import { criarAcao } from "./nova-acao";
import { pedirEnvio, pessoasNotionDosEmails } from "./notion-sync";
import { mudarQuemVeDaTarefa, mudarTambemFazem } from "./quem-ve";
import { pessoaDoPublico, timesDoPublico } from "./pedidos-publico";
import { mexeNoPedido } from "./pedidos-trava";
import {
  EMPRESAS,
  areaDoPedido,
  casalDoTitulo,
  conferirRespostas,
  descricaoAtualizada,
  descricaoDoPedido,
  destinoVazio,
  ehDeFora,
  ehErro,
  ehRoboOuTeste,
  estaNoPublico,
  faltaParaPublicar,
  limparDestino,
  limparPublico,
  limparRascunho,
  marcasDaOrganizacao,
  pedidoEncerrado,
  prazoDoPedido,
  respostaQuePreenche,
  respostasQueMudaram,
  situacaoDoPedido,
  situacaoEmPortugues,
  slugDe,
  tituloDoPedido,
  type Destino,
  type Formulario,
  type Pergunta,
  type Publico,
  type Rascunho,
  type Resposta,
} from "./pedidos-tipos";
import { MARCA_DO_TEAMS } from "./ttars-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resposta de uma rota: status e corpo. Erros levam `error` (o que o TTARS mostra) e `erro` (o contrato). */
export type Saida = { status: number; json: Record<string, unknown> };
const falha = (status: number, mensagem: string, extra: Record<string, unknown> = {}): Saida => ({
  status,
  json: { error: mensagem, erro: mensagem, ...extra },
});
const certo = (json: Record<string, unknown>, status = 200): Saida => ({ status, json });

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

// ── formulários ─────────────────────────────────────────────────────────────────────────────

type Linha = Omit<Formulario, "publico" | "destino" | "rascunho"> & { publico: unknown; destino: unknown; rascunho: unknown };

const SELECT_FORMULARIO = `
  SELECT f.id::text AS id, f.slug, f.nome, f.explica, f.icone, f.estado, f.versao, f.perguntas, f.publico, f.destino, f.rascunho,
         (SELECT count(*)::int FROM tarefa_pedidos tp WHERE tp.formulario_id = f.id) AS pedidos,
         to_char(f.atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS atualizado_em,
         (SELECT u.nome FROM users u WHERE u.id = f.atualizado_por) AS atualizado_por_nome
    FROM pedido_formularios f`;

function publicoDe(x: unknown): Publico {
  const p = limparPublico(x);
  return ehErro(p) ? { tipo: "empresas", empresas: [], times: [] } : p;
}
function destinoDe(x: unknown): Destino {
  const d = limparDestino(x, false);
  return ehErro(d) ? destinoVazio() : d;
}
function rascunhoDe(x: unknown): Rascunho | null {
  if (!x) return null;
  const r = limparRascunho(x);
  return ehErro(r) ? null : r;
}

function paraFormulario(l: Linha, comRascunho: boolean): Formulario {
  return {
    id: l.id,
    slug: l.slug,
    nome: l.nome,
    explica: l.explica,
    icone: l.icone,
    estado: l.estado,
    versao: l.versao,
    perguntas: Array.isArray(l.perguntas) ? l.perguntas : [],
    publico: publicoDe(l.publico),
    destino: destinoDe(l.destino),
    rascunho: comRascunho ? rascunhoDe(l.rascunho) : null,
    pedidos: l.pedidos,
    atualizado_em: l.atualizado_em,
    atualizado_por_nome: l.atualizado_por_nome,
  };
}

async function umFormulario(id: string): Promise<Formulario | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await query<Linha>(`${SELECT_FORMULARIO} WHERE f.id = $1`, [id]);
  return r[0] ? paraFormulario(r[0], true) : null;
}

/** Monta formulários: a lista de quem monta (pedido_montadores) ou o administrador. */
export async function podeMontar(userId: string): Promise<boolean> {
  const r = await withTenant(userId, (c) => c.query<{ ok: boolean }>(`SELECT pedido_posso_montar() AS ok`));
  return r.rows[0]?.ok === true;
}

/** Os formulários que a pessoa pode pedir agora (no ar e com ela no público) e as marcas dela (para a área
 *  dos formulários "da marca de quem pede"). */
export async function formulariosParaPedir(user: User): Promise<Saida> {
  const [linhas, eu, monta] = await Promise.all([
    query<Linha>(`${SELECT_FORMULARIO} WHERE f.estado = 'no_ar' ORDER BY f.nome`),
    pessoaDoPublico(user.email),
    podeMontar(user.id),
  ]);
  const formularios = linhas.map((l) => paraFormulario(l, false)).filter((f) => estaNoPublico(eu, f.publico));
  return certo({ formularios, pode_montar: monta, minhas_marcas: marcasDaOrganizacao(eu?.organizacao) });
}

// ── pedir ───────────────────────────────────────────────────────────────────────────────────

/** eu_pedi / eu_vejo: quem tenta de novo já é dono ou já está no Quem vê (a tela não oferece acompanhar). */
type Repetido = { tarefa_id: string; pedido_por: string; criado_em: string; situacao: string; eu_pedi: boolean; eu_vejo: boolean };

/** A situação crua de ações de pedido (lidas no tenant de quem pediu); a tela do TTARS traduz. */
async function situacoes(pares: { tarefa_id: string; pedido_por_id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const porDono = new Map<string, string[]>();
  for (const p of pares) porDono.set(p.pedido_por_id, [...(porDono.get(p.pedido_por_id) ?? []), p.tarefa_id]);
  for (const [dono, ids] of porDono) {
    const r = await withTenant(dono, (c) =>
      c.query<{ id: string; status: string }>(`SELECT id::text AS id, status FROM tarefas WHERE id = ANY($1::uuid[])`, [ids]),
    );
    const notion = await query<{ tarefa_id: string; status_notion: string | null }>(
      `SELECT tarefa_id::text AS tarefa_id, status_notion FROM notion_paginas WHERE tarefa_id = ANY($1::uuid[])`,
      [ids],
    );
    const n = new Map(notion.map((x) => [x.tarefa_id, x.status_notion]));
    for (const t of r.rows) out.set(t.id, situacaoDoPedido(t.status, n.get(t.id) ?? null));
  }
  return out;
}

async function pedidoVivoDoCard(formularioId: string, cardId: string, quemTenta: string): Promise<Repetido | null> {
  const r = await query<{ tarefa_id: string; pedido_por_id: string; pedido_por: string | null; criado_em: string }>(
    `SELECT tp.tarefa_id::text AS tarefa_id, tp.pedido_por::text AS pedido_por_id, u.nome AS pedido_por,
            to_char(tp.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em
       FROM tarefa_pedidos tp LEFT JOIN users u ON u.id = tp.pedido_por
      WHERE tp.formulario_id = $1 AND tp.card_id = $2 AND NOT tp.cancelado
      LIMIT 1`,
    [formularioId, cardId],
  );
  const x = r[0];
  if (!x) return null;
  const sit = await situacoes([x]);
  const euPedi = x.pedido_por_id === quemTenta;
  return {
    tarefa_id: x.tarefa_id,
    pedido_por: x.pedido_por ?? "Alguém",
    criado_em: x.criado_em,
    situacao: sit.get(x.tarefa_id) ?? "Not started",
    eu_pedi: euPedi,
    eu_vejo: euPedi || !!(await acessoTarefa(quemTenta, x.tarefa_id)),
  };
}

const repetido = (r: Repetido) =>
  falha(409, `${r.eu_pedi ? "Você já pediu" : `Já pedido por ${r.pedido_por}`} em ${diaMesBR(r.criado_em)} · ${situacaoEmPortugues(r.situacao)}`, {
    repetido: r,
  });

/** Os times que acompanham, na ordem: `time_ids` (o 1º vira o time da ação) e ainda `time_id` (TTARS antigo). */
function timesDoCorpo(b: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const x of [...(Array.isArray(b.time_ids) ? b.time_ids : []), b.time_id]) {
    const id = typeof x === "string" ? x.trim() : "";
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 20);
}

/** A gente dos times (lista do TTARS), sem robôs nem contas de teste. */
async function genteDosTimes(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  return (await pessoasDaEquipe())
    .filter((p) => !ehRoboOuTeste(p.email) && (Array.isArray(p.times) ? p.times : []).some((t) => ids.includes(t?.id)))
    .map((p) => p.email.trim().toLowerCase());
}

/**
 * POST /api/ttars/pedidos. Corpo: { formulario_id, versao, card: {id, titulo} | null, respostas: {id: {valor, nao_temos?}},
 * pessoas: e-mails, time_ids?: string[] (e ainda time_id), bu?: a marca escolhida (formulário "da marca de quem pede") }.
 */
export async function criarPedido(user: User, corpo: unknown): Promise<Saida> {
  const b = obj(corpo);
  const formularioId = typeof b.formulario_id === "string" ? b.formulario_id : "";
  const f = formularioId ? await umFormulario(formularioId) : null;
  if (!f || f.estado !== "no_ar") return falha(404, "Este pedido não está mais no ar.");
  const eu = await pessoaDoPublico(user.email);
  if (!estaNoPublico(eu, f.publico)) return falha(403, "Este pedido não é para você.");
  if (Number(b.versao) !== f.versao) {
    return falha(409, "O formulário mudou: feche e abra de novo para ver as perguntas novas.", { versao_atual: f.versao });
  }
  let card: { id: string; titulo: string } | null = null;
  if (b.card !== null && b.card !== undefined) {
    const c = obj(b.card);
    const titulo = typeof c.titulo === "string" ? c.titulo.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (typeof c.id !== "string" || !UUID_RE.test(c.id) || !titulo) return falha(400, "Escolha o casamento de novo.");
    card = { id: c.id.toLowerCase(), titulo };
  }
  const respostas = conferirRespostas(f.perguntas, b.respostas, { quem: user.nome, casamento: card?.titulo ?? null });
  if (ehErro(respostas)) return falha(400, respostas.erro);
  const area = areaDoPedido(f.destino.bu, marcasDaOrganizacao(eu?.organizacao), b.bu);
  if (ehErro(area)) return falha(400, area.erro);
  const pessoas = Array.isArray(b.pessoas) ? b.pessoas.filter((e): e is string => typeof e === "string" && !!e.trim()).slice(0, 50) : [];
  const timeIds = timesDoCorpo(b);
  if (timeIds.length) {
    const doPublico = new Set((await timesDoPublico(f.publico)).map((t) => t.id));
    if (timeIds.some((id) => !doPublico.has(id))) return falha(400, "Esse time não pode acompanhar este pedido.");
  }
  const [quemFaz, ...tambemFazem] = f.destino.quem_emails;
  if (!quemFaz) return falha(409, "Este pedido está sem a pessoa do marketing que recebe. Avise quem monta os pedidos.");

  if (card && f.destino.um_por_casamento) {
    const ja = await pedidoVivoDoCard(f.id, card.id, user.id);
    if (ja) return repetido(ja);
  }

  const agora = new Date();
  const casal = respostaQuePreenche(f.perguntas, respostas, "casal") ?? (card ? casalDoTitulo(card.titulo) : null);
  const titulo = tituloDoPedido(f.destino.titulo_modelo, { casal, quem: user.nome, nomeDoFormulario: f.nome });
  const descricao = descricaoDoPedido(f.perguntas, respostas, user.nome, diaMesBR(agora), card?.titulo);

  // 1. A ação, sem entrar na fila do Notion (a página só nasce com o pedido gravado). Quem faz = a 1ª que recebe.
  const criada = await criarAcao(user, {
    titulo,
    descricao,
    quem_email: quemFaz,
    prazo: prazoDoPedido(f.destino, f.perguntas, respostas, agora),
    prioridade: f.destino.prioridade,
    origem: "pedido",
    raw: `pedido:${f.slug}`,
    semFila: true,
  });
  if (!criada.ok) return falha(criada.status, criada.erro);
  const tarefaId = criada.tarefa.id;

  // 2. O pedido (com as perguntas desta versão, quem recebe, o projeto e a área). Dois pedidos do mesmo
  //    casamento ao mesmo tempo (formulário de um por casamento): o índice único segura o segundo, que desfaz a
  //    ação e mostra o primeiro.
  try {
    await query(
      `INSERT INTO tarefa_pedidos (tarefa_id, formulario_id, versao, perguntas_snapshot, respostas, card_id, card_titulo, pedido_por,
                                   projeto_notion_page_id, bu, criado_em, unico, quem_emails)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tarefaId,
        f.id,
        f.versao,
        JSON.stringify(f.perguntas),
        JSON.stringify(respostas),
        card?.id ?? null,
        card?.titulo ?? null,
        user.id,
        f.destino.projeto_notion_page_id,
        area,
        agora.toISOString(),
        f.destino.um_por_casamento,
        f.destino.quem_emails,
      ],
    );
  } catch (e) {
    await withTenant(user.id, (c) => c.query(`DELETE FROM tarefas WHERE id = $1`, [tarefaId]));
    if ((e as { code?: string })?.code === "23505" && card) {
      const ja = await pedidoVivoDoCard(f.id, card.id, user.id);
      if (ja) return repetido(ja);
    }
    throw e;
  }

  // 3. Quem também faz: as outras que recebem (como quem criou a ação, sem a trava do pedido). Quem não está
  //    na lista do TTARS fica de fora sozinho, com aviso.
  const avisos: string[] = criada.aviso ? [criada.aviso] : [];
  if (tambemFazem.length) {
    const achados: string[] = [];
    const fora: string[] = [];
    for (const e of tambemFazem) ((await garantirColegaDoTtars(e)) ? achados : fora).push(e);
    if (achados.length && (await mudarTambemFazem(user.id, tarefaId, achados)) !== "ok") {
      avisos.push("O pedido foi enviado, mas não consegui marcar quem também faz: abra a ação e marque de novo.");
    }
    if (fora.length) {
      avisos.push(
        `O pedido foi enviado, mas ${fora.join(", ")} ${fora.length === 1 ? "não está na lista do TTARS e ficou" : "não estão na lista do TTARS e ficaram"} de fora de quem também faz.`,
      );
    }
  }

  // 4. Quem acompanha: as pessoas, o 1º time (vira o time da ação) e a gente dos outros times (no Quem vê).
  //    Quem não está na lista de pessoas do TTARS fica de fora sozinho, com aviso (antes, uma pessoa assim
  //    deixava TODAS de fora); o time vai à parte.
  const [timeDaAcao, ...outrosTimes] = timeIds;
  const achadas: string[] = [];
  const faltaram: string[] = [];
  for (const e of pessoas) ((await garantirColegaDoTtars(e)) ? achadas : faltaram).push(e.trim().toLowerCase());
  for (const e of await genteDosTimes(outrosTimes)) {
    if (e !== (user.email ?? "").toLowerCase() && !achadas.includes(e) && (await garantirColegaDoTtars(e))) achadas.push(e);
  }
  if (achadas.length && (await mudarQuemVeDaTarefa(user.id, tarefaId, { juntar: achadas })) !== "ok") {
    avisos.push("O pedido foi enviado, mas não consegui marcar quem acompanha: abra a ação e marque de novo.");
  }
  if (faltaram.length) {
    avisos.push(
      `O pedido foi enviado, mas ${faltaram.join(", ")} ${faltaram.length === 1 ? "não está no Ações e ficou" : "não estão no Ações e ficaram"} de fora de quem acompanha.`,
    );
  }
  if (timeDaAcao && (await mudarQuemVeDaTarefa(user.id, tarefaId, { time_id: timeDaAcao })) !== "ok") {
    avisos.push("O pedido foi enviado, mas não consegui marcar o time: abra a ação e marque de novo.");
  }
  const aviso = avisos.length ? avisos.join(" ") : null;

  // 5. O Notion do marketing: quem recebe e está lá, o projeto e a área do pedido (nunca a da aba).
  const noNotion = await pessoasNotionDosEmails(f.destino.quem_emails);
  if (noNotion.length || f.destino.projeto_notion_page_id) {
    await pedirEnvio({ tarefaId, donoId: user.id, pedidoPor: user.id, notionUserId: noNotion[0] ?? null, bu: area });
  }
  return certo({ tarefa_id: tarefaId, aviso }, 201);
}

type PedidoAchado = { tarefa_id: string; pedido_por_id: string; publico: Publico; formulario_nome: string; criado_em: string; pedido_por: string | null };

async function pedidosAchados(onde: string, valor: string): Promise<PedidoAchado[]> {
  return query<PedidoAchado>(
    `SELECT tp.tarefa_id::text AS tarefa_id, tp.pedido_por::text AS pedido_por_id, f.publico, f.nome AS formulario_nome,
            to_char(tp.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em, u.nome AS pedido_por
       FROM tarefa_pedidos tp
       JOIN pedido_formularios f ON f.id = tp.formulario_id
       LEFT JOIN users u ON u.id = tp.pedido_por
      WHERE ${onde} = $1
      ORDER BY tp.criado_em DESC`,
    [valor],
  );
}

/** POST /api/ttars/pedidos/:tarefaId/acompanhar — quem pode pedir o formulário entra no Quem vê do pedido. */
export async function acompanharPedido(user: User, tarefaId: string): Promise<Saida> {
  const [p] = UUID_RE.test(tarefaId) ? await pedidosAchados("tp.tarefa_id", tarefaId) : [];
  if (!p) return falha(404, "Esse pedido não existe mais.");
  if (!estaNoPublico(await pessoaDoPublico(user.email), publicoDe(p.publico))) return falha(403, "Este pedido não é para você.");
  if (p.pedido_por_id !== user.id) {
    // Como quem pediu (é ele quem muda o Quem vê da ação): entra só quem chamou.
    const achou = await withTenant(p.pedido_por_id, async (c) => {
      const t = await c.query(`SELECT 1 FROM tarefas WHERE id = $1`, [tarefaId]);
      if (!t.rowCount) return false;
      await c.query(`INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
        tarefaId,
        user.id,
        user.id,
      ]);
      return true;
    });
    if (!achou) return falha(404, "Esse pedido não existe mais.");
  }
  return certo({ ok: true, tarefa_id: tarefaId });
}

const TEXTO_MAX_DO_COMENTARIO = 4000;

/**
 * PATCH /api/ttars/pedidos/:tarefaId/respostas — quem pediu (ou o marketing) completa as respostas depois (ex.:
 * "ainda não temos" o contato da assessora), enquanto o pedido não foi encerrado. Corpo: { respostas } (as que
 * não vierem ficam como estavam). Mesmas regras da criação, contra as perguntas da versão do pedido. A descrição
 * da ação é refeita (a 1ª linha com o dia em que foi pedido) e vai ao Notion pela rodada, e um comentário diz
 * o que mudou.
 */
export async function completarRespostas(user: User, tarefaId: string, corpo: unknown): Promise<Saida> {
  const NAO_EXISTE = () => falha(404, "Esse pedido não existe mais.");
  if (!UUID_RE.test(tarefaId)) return NAO_EXISTE();
  const [dono] = await query<{ pedido_por: string; nome: string | null }>(
    `SELECT tp.pedido_por::text AS pedido_por, u.nome FROM tarefa_pedidos tp LEFT JOIN users u ON u.id = tp.pedido_por WHERE tp.tarefa_id = $1`,
    [tarefaId],
  );
  if (!dono) return NAO_EXISTE();
  if (dono.pedido_por !== user.id && !(await mexeNoPedido(user.id))) {
    return falha(403, "Só quem pediu ou o marketing completa as respostas deste pedido.");
  }
  const respostasNovas = obj(corpo).respostas;
  if (!respostasNovas || typeof respostasNovas !== "object" || Array.isArray(respostasNovas)) return falha(400, "As respostas vieram erradas.");

  // Tudo numa transação, no tenant de quem pediu (a ação é dela), com a ação e o pedido presos: quem completa
  // ao mesmo tempo (ou o marketing encerrando) nunca se atropela.
  return withTenant(dono.pedido_por, async (c): Promise<Saida> => {
    const t = (await c.query<{ status: string; descricao: string | null }>(`SELECT status, descricao FROM tarefas WHERE id = $1 FOR UPDATE`, [tarefaId])).rows[0];
    const p = (
      await c.query<{ perguntas_snapshot: Pergunta[]; respostas: Record<string, Resposta> | null; card_titulo: string | null; criado_em: string; status_notion: string | null }>(
        `SELECT tp.perguntas_snapshot, tp.respostas, tp.card_titulo,
                to_char(tp.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em, np.status_notion
           FROM tarefa_pedidos tp LEFT JOIN notion_paginas np ON np.tarefa_id = tp.tarefa_id
          WHERE tp.tarefa_id = $1 FOR UPDATE OF tp`,
        [tarefaId],
      )
    ).rows[0];
    if (!t || !p) return NAO_EXISTE();
    if (pedidoEncerrado(t.status, p.status_notion)) return falha(409, "Este pedido já foi encerrado: fale pelos comentários.");

    const perguntas = Array.isArray(p.perguntas_snapshot) ? p.perguntas_snapshot : [];
    const antes = p.respostas ?? {};
    // Quem pediu e o casamento continuam os do pedido (o servidor preenche, como na criação).
    const auto = perguntas.find((x) => x.tipo === "automatico_quem_pede");
    const quemPediu = (auto && typeof antes[auto.id]?.valor === "string" ? (antes[auto.id].valor as string) : null) ?? dono.nome ?? "alguém";
    const depois = conferirRespostas(perguntas, { ...antes, ...(respostasNovas as Record<string, unknown>) }, { quem: quemPediu, casamento: p.card_titulo });
    if (ehErro(depois)) return falha(400, depois.erro);
    const mudaram = respostasQueMudaram(perguntas, antes, depois, p.card_titulo);
    if (!mudaram.length) return certo({ ok: true, mudaram, aviso: "Nenhuma resposta mudou." });

    const descricao = descricaoAtualizada(t.descricao, perguntas, antes, depois, quemPediu, diaMesBR(p.criado_em), p.card_titulo);
    const comentario = `Respostas atualizadas por ${user.nome}: ${mudaram.join(", ")}`.slice(0, TEXTO_MAX_DO_COMENTARIO);
    await c.query(`UPDATE tarefa_pedidos SET respostas = $2 WHERE tarefa_id = $1`, [tarefaId, JSON.stringify(depois)]);
    await c.query(`UPDATE tarefas SET descricao = $2 WHERE id = $1`, [tarefaId, descricao]);
    await registrarEvento(c, tarefaId, "editada", { origem: "pedido_respostas", changed: { descricao: true } }, user.id);
    await c.query(`INSERT INTO tarefa_comentarios (tarefa_id, texto, autor_user_id) VALUES ($1, $2, $3)`, [tarefaId, comentario, user.id]);
    return certo({ ok: true, mudaram });
  });
}

/** GET /api/ttars/pedidos/por-card/:cardId — os pedidos vivos deste casamento (dos formulários que a pessoa pode pedir). */
export async function pedidosDoCard(user: User, cardId: string): Promise<Saida> {
  if (!UUID_RE.test(cardId)) return certo({ pedidos: [] });
  const eu = await pessoaDoPublico(user.email);
  const achados = (await pedidosAchados("tp.card_id", cardId.toLowerCase())).filter((p) => estaNoPublico(eu, publicoDe(p.publico)));
  const sit = await situacoes(achados);
  const pedidos = [];
  for (const p of achados) {
    const situacao = sit.get(p.tarefa_id);
    if (!situacao || situacao === "cancelada") continue;
    pedidos.push({
      formulario_nome: p.formulario_nome,
      tarefa_id: p.tarefa_id,
      pedido_por: p.pedido_por ?? "Alguém",
      criado_em: p.criado_em,
      situacao,
      eu_vejo: !!(await acessoTarefa(user.id, p.tarefa_id)),
    });
  }
  return certo({ pedidos });
}

// ── montar ──────────────────────────────────────────────────────────────────────────────────

const SO_QUEM_MONTA = () => falha(403, "Só quem monta os pedidos mexe nos formulários.");

/** GET /api/ttars/pedidos/montar — todos os formulários, com o rascunho. */
export async function formulariosParaMontar(user: User): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const linhas = await query<Linha>(`${SELECT_FORMULARIO} ORDER BY (f.estado = 'desligado'), f.nome`);
  return certo({ formularios: linhas.map((l) => paraFormulario(l, true)) });
}

/** GET /api/ttars/pedidos/montar/opcoes — quem do marketing recebe, projetos do Notion, empresas e times. */
export async function opcoesParaMontar(user: User): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const [pessoas, projetos, times] = await Promise.all([
    query<{ email: string; nome: string }>(
      `SELECT DISTINCT ON (email) email, nome FROM (
         SELECT LOWER(u.email) AS email, COALESCE(np.nome, u.nome) AS nome, 0 AS ordem
           FROM notion_pessoas np JOIN notion_conexoes c ON c.id = np.conexao_id AND c.ativo
           JOIN users u ON u.id = np.user_id AND u.deleted_at IS NULL
          WHERE u.email IS NOT NULL
         UNION ALL
         SELECT m.email, COALESCE(tp.nome, u.nome, m.email) AS nome, 1 AS ordem
           FROM pedido_montadores m
           LEFT JOIN ttars_pessoas tp ON tp.email = m.email
           LEFT JOIN users u ON LOWER(u.email) = m.email AND u.deleted_at IS NULL
       ) x ORDER BY email, ordem`,
    ),
    query<{ page_id: string; nome: string }>(
      `SELECT np.page_id, np.nome FROM notion_projetos np JOIN notion_conexoes c ON c.id = np.conexao_id AND c.ativo
        WHERE NOT np.no_lixo AND COALESCE(LOWER(np.etapa), '') <> 'archived' ORDER BY np.nome`,
    ),
    timesDoPublico({ tipo: "todos", empresas: [], times: [] }),
  ]);
  return certo({
    pessoas_marketing: pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    projetos_notion: projetos,
    empresas: EMPRESAS,
    times,
  });
}

function rascunhoPadrao(nome: string): Rascunho {
  return {
    nome,
    explica: "",
    icone: "📝",
    perguntas: [],
    publico: { tipo: "empresas", empresas: [], times: [] },
    destino: destinoVazio(),
  };
}

// ── quem monta ──────────────────────────────────────────────────────────────────────────────

type Montador = { email: string; nome: string };

async function listaDeMontadores(): Promise<Montador[]> {
  return query<Montador>(
    `SELECT m.email, COALESCE(tp.nome, u.nome, m.email) AS nome
       FROM pedido_montadores m
       LEFT JOIN ttars_pessoas tp ON tp.email = m.email
       LEFT JOIN LATERAL (SELECT x.nome FROM users x WHERE LOWER(x.email) = m.email AND x.deleted_at IS NULL LIMIT 1) u ON true
      ORDER BY 2, 1`,
  );
}

const montadoresSaida = async (podeMudar: boolean) => certo({ montadores: await listaDeMontadores(), pode_mudar: podeMudar });
const SO_QUEM_MONTA_MUDA = () => falha(403, "Só quem monta os pedidos muda quem monta.");
const emailDe = (x: unknown) => (typeof x === "string" ? x.trim().toLowerCase() : "");

/** GET /api/ttars/pedidos/montar/montadores — quem monta os formulários; muda quem já monta ou o administrador. */
export async function montadores(user: User): Promise<Saida> {
  return montadoresSaida(await podeMontar(user.id));
}

/** POST …/montadores { email } — põe alguém da lista do TTARS (da Welcome) para montar os formulários. */
export async function porMontador(user: User, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA_MUDA();
  const email = emailDe(obj(corpo).email);
  if (!EMAIL_RE.test(email)) return falha(400, "Escolha a pessoa.");
  if (ehRoboOuTeste(email) || ehDeFora(email)) return falha(400, "Só gente da Welcome monta os pedidos.");
  const daLista = await query(`SELECT 1 FROM ttars_pessoas WHERE email = $1 AND COALESCE(organizacao, '') <> ''`, [email]);
  if (!daLista.length) return falha(400, "Essa pessoa não está na lista do TTARS.");
  const posto = await query(`INSERT INTO pedido_montadores (email, por) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING email`, [email, user.id]);
  if (posto.length) {
    await query(`INSERT INTO audit_log (user_id, action, target_id) VALUES ($1, 'pedidos.montador_posto', $2)`, [user.id, email]);
  }
  return montadoresSaida(true);
}

/** DELETE …/montadores { email } — tira alguém de quem monta (nunca o último). */
export async function tirarMontador(user: User, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA_MUDA();
  const email = emailDe(obj(corpo).email);
  if (!email) return falha(400, "Escolha a pessoa.");
  // A lista presa na mesma transação: duas retiradas ao mesmo tempo nunca esvaziam a lista.
  const r = await withTenant(user.id, async (c) => {
    const lista = (await c.query<{ email: string }>(`SELECT email FROM pedido_montadores FOR UPDATE`)).rows.map((x) => x.email);
    if (!lista.includes(email)) return "nao_monta" as const;
    if (lista.length <= 1) return "ultimo" as const;
    await c.query(`DELETE FROM pedido_montadores WHERE email = $1`, [email]);
    await c.query(`INSERT INTO audit_log (user_id, action, target_id) VALUES ($1, 'pedidos.montador_tirado', $2)`, [user.id, email]);
    return "ok" as const;
  });
  if (r === "nao_monta") return falha(404, "Essa pessoa não monta os pedidos.");
  if (r === "ultimo") return falha(409, "Precisa ficar pelo menos uma pessoa montando os pedidos.");
  return montadoresSaida(true);
}

/** POST /api/ttars/pedidos/montar — formulário novo (rascunho). O corpo pode já trazer o rascunho (ex.: lido de arquivo). */
export async function novoFormulario(user: User, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const b = obj(corpo);
  const nome = typeof b.nome === "string" && b.nome.trim() ? b.nome.trim().slice(0, 120) : "Formulário novo";
  const rascunho = b.perguntas !== undefined || b.publico !== undefined || b.destino !== undefined ? limparRascunho({ ...b, nome }) : rascunhoPadrao(nome);
  if (ehErro(rascunho)) return falha(400, rascunho.erro);
  const base = slugDe(nome);
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 55)}-${n}`;
    const r = await query<{ id: string }>(
      `INSERT INTO pedido_formularios (slug, nome, explica, icone, estado, versao, rascunho, criado_por, atualizado_por)
       VALUES ($1, $2, $3, $4, 'rascunho', 0, $5, $6, $6)
       ON CONFLICT (slug) DO NOTHING RETURNING id::text AS id`,
      [slug, rascunho.nome, rascunho.explica, rascunho.icone, JSON.stringify(rascunho), user.id],
    );
    if (r[0]) return certo({ formulario: await umFormulario(r[0].id) }, 201);
  }
  return falha(409, "Já existem muitos formulários com esse nome. Escolha outro.");
}

/** PUT /api/ttars/pedidos/montar/:id — salva o rascunho (o que está no ar não muda até publicar). */
export async function salvarRascunho(user: User, id: string, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const f = await umFormulario(id);
  if (!f) return falha(404, "Esse formulário não existe mais.");
  const r = limparRascunho(corpo);
  if (ehErro(r)) return falha(400, r.erro);
  // Nunca publicado: o nome e o ícone do cartão acompanham o rascunho.
  await query(
    `UPDATE pedido_formularios
        SET rascunho = $2, atualizado_por = $3, atualizado_em = now(),
            nome = CASE WHEN versao = 0 THEN $4 ELSE nome END,
            explica = CASE WHEN versao = 0 THEN $5 ELSE explica END,
            icone = CASE WHEN versao = 0 THEN $6 ELSE icone END
      WHERE id = $1`,
    [f.id, JSON.stringify(r), user.id, r.nome, r.explica, r.icone],
  );
  return certo({ formulario: await umFormulario(f.id) });
}

/** POST …/:id/publicar — o rascunho vira a versão no ar (versão + 1). Pedido antigo guarda as perguntas dele. */
export async function publicarFormulario(user: User, id: string): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const f = await umFormulario(id);
  if (!f) return falha(404, "Esse formulário não existe mais.");
  if (!f.rascunho) return falha(400, "Não há alteração para publicar.");
  const falta = faltaParaPublicar(f.rascunho);
  if (falta) return falha(400, falta);
  const r = f.rascunho;
  const feito = await query<{ id: string }>(
    `UPDATE pedido_formularios
        SET nome = $2, explica = $3, icone = $4, perguntas = $5, publico = $6, destino = $7,
            versao = versao + 1, estado = 'no_ar', rascunho = NULL, atualizado_por = $8, atualizado_em = now()
      WHERE id = $1 AND versao = $9 RETURNING id::text AS id`,
    [f.id, r.nome, r.explica, r.icone, JSON.stringify(r.perguntas), JSON.stringify(r.publico), JSON.stringify(r.destino), user.id, f.versao],
  );
  if (!feito[0]) return falha(409, "Alguém publicou este formulário agora há pouco. Abra de novo.");
  return certo({ formulario: await umFormulario(f.id) });
}

/** POST …/:id/desligar e …/:id/religar. */
export async function ligarFormulario(user: User, id: string, ligar: boolean): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const f = await umFormulario(id);
  if (!f) return falha(404, "Esse formulário não existe mais.");
  if (f.versao < 1) return falha(400, "Este formulário ainda não foi publicado.");
  await query(`UPDATE pedido_formularios SET estado = $2, atualizado_por = $3, atualizado_em = now() WHERE id = $1`, [
    f.id,
    ligar ? "no_ar" : "desligado",
    user.id,
  ]);
  return certo({ formulario: await umFormulario(f.id) });
}

/** DELETE …/:id — só formulário sem nenhum pedido (com pedido: desligar). */
export async function apagarFormulario(user: User, id: string): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const f = await umFormulario(id);
  if (!f) return falha(404, "Esse formulário não existe mais.");
  if (f.pedidos > 0) return falha(409, "Este formulário já tem pedidos: desligue em vez de apagar.");
  await query(`DELETE FROM pedido_formularios WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM tarefa_pedidos WHERE formulario_id = $1)`, [f.id]);
  return certo({ ok: true });
}

// ── quem vê o formulário ────────────────────────────────────────────────────────────────────

type PessoaContada = { email: string; nome: string; organizacao: string; times: { id: string }[] | null; entra: boolean };

/**
 * POST …/montar/contar — quantas pessoas veem o formulário com este público e quantas já entram no Ações.
 * Robôs, contas de teste e gente de fora da Welcome não contam. Quem só está no Teams (sem TTARS) conta em
 * "Toda a Welcome", mas fica à parte (`so_teams`): não abre o formulário sem TTARS e não se libera por aqui,
 * então não entra em `nao_entram` (o "Liberar essas Y" libera exatamente as Y).
 */
export async function contarPublico(user: User, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return SO_QUEM_MONTA();
  const publico = limparPublico(obj(corpo).publico);
  if (ehErro(publico)) return falha(400, publico.erro);
  const gente = await query<PessoaContada>(
    `SELECT p.email, p.nome, COALESCE(p.organizacao, '') AS organizacao, p.times,
            (EXISTS (SELECT 1 FROM acessos_equipe a WHERE a.email = p.email AND a.liberado)
             OR EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = p.email AND u.is_admin AND u.deleted_at IS NULL)) AS entra
       FROM ttars_pessoas p
      WHERE COALESCE(p.organizacao, '') <> ''
      ORDER BY p.nome`,
  );
  const pessoas = gente
    // Quem só está no Teams entra só em "Toda a Welcome" (estaNoPublico).
    .filter((p) => !ehRoboOuTeste(p.email) && !ehDeFora(p.email) && estaNoPublico(p, publico))
    .map((p) => ({ nome: p.nome, email: p.email, entra: p.entra, so_teams: p.organizacao.startsWith(MARCA_DO_TEAMS) }));
  const jaEntram = pessoas.filter((p) => p.entra).length;
  const soTeams = pessoas.filter((p) => !p.entra && p.so_teams).length;
  return certo({ total: pessoas.length, ja_entram: jaEntram, nao_entram: pessoas.length - jaEntram - soTeams, so_teams: soTeams, pessoas });
}

/** POST …/montar/liberar — só o administrador: libera o Ações para estas pessoas (da lista do TTARS). */
export async function liberarPessoas(user: User, corpo: unknown): Promise<Saida> {
  if (!user.is_admin) return falha(403, "Só o administrador libera gente no Ações.");
  const pedidos = obj(corpo).emails;
  if (!Array.isArray(pedidos) || !pedidos.length) return falha(400, "Quem liberar?");
  const emails = [...new Set(pedidos.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))].slice(0, 300);
  const daLista = await query<{ email: string }>(
    `SELECT email FROM ttars_pessoas WHERE email = ANY($1::text[]) AND COALESCE(organizacao, '') <> '' AND LEFT(organizacao, $2) <> $3`,
    [emails, MARCA_DO_TEAMS.length, MARCA_DO_TEAMS],
  );
  const liberar = daLista.map((x) => x.email).filter((e) => !ehRoboOuTeste(e) && !ehDeFora(e));
  if (liberar.length) {
    await query(
      `INSERT INTO acessos_equipe (email, liberado, alterado_por, alterado_em, criado_em)
       SELECT e, true, $2, now(), now() FROM unnest($1::text[]) AS e
       ON CONFLICT (email) DO UPDATE SET liberado = true, alterado_por = $2, alterado_em = now()`,
      [liberar, user.id],
    );
    await query(`INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'access.granted', $2)`, [
      user.id,
      JSON.stringify({ origem: "pedidos_ao_marketing", emails: liberar }),
    ]);
  }
  return certo({ liberados: liberar.length, ignorados: emails.filter((e) => !liberar.includes(e)) });
}

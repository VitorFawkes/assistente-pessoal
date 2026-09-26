// Assistente do Ações dentro do TTARS: conversa que vê, cria e ajusta ações.
//
// Pedido do Vitor (26/09/2026): "ter o agente que você conversa pra ajudar a ver tarefas,
// ajustar, editar". Modelo barato (GPT-6 Luna, lib/ia.ts). Toda mudança passa pelas MESMAS
// rotas das telas (chamadas aqui dentro com o acesso de quem pede), então quem pode o quê
// é exatamente o das telas. Regras de confirmar/desfazer em lib/agente-regras.ts.
import type { User } from "./auth";
import { dataCurtaBR, hojeBR, diaDaSemanaBR, maisDiasBR } from "./data-br";
import { tarefasFor, meetingsFor, type Tarefa } from "./queries";
import { tarefasParaMim, pessoasDaEquipe, type PessoaDaEquipe } from "./equipe-compartilhado";
import { ordenarPendencias } from "./compartilhar";
import { listarProjetos, projetoParaQuemVe, adicionarAoProjeto, tirarDoProjeto, type ProjetoResumo } from "./projetos";
import { meetingSubject } from "./meeting-label";
import { trocarFalantes } from "./falantes";
import { paraTela, tarefaNaTela } from "./ttars-tela";
import { criarAcao } from "./nova-acao";
import { acharPessoaPorNome, ehEu } from "./pessoa-por-nome";
import { chamarModelo, IaIndisponivel, type Ferramenta, type Item } from "./ia";
import {
  desfazerQuem,
  diaDoPrazo,
  ehMinha,
  linhaDoRetrato,
  montarMudanca,
  precisaConfirmar,
  tituloCurto,
  type Mudanca,
  type Pedido,
  type TarefaVista,
} from "./agente-regras";
import { PATCH as patchTarefa } from "@/app/api/tarefas/[id]/route";
import { POST as postQuadro } from "@/app/api/quadros/route";

const MAX_RODADAS = 4;
const MAX_CHAMADAS = 10;
const MAX_ABERTAS = 150;
const MAX_FECHADAS = 25;

export type Fala = { quem: "pessoa" | "assistente"; texto: string };
export type Contexto = {
  tela?: string | null;
  projeto_id?: string | null;
  reuniao_id?: string | null;
  pessoa_email?: string | null;
  tarefa_id?: string | null;
};
export type Feita = { descricao: string; tarefa_id: string | null; desfazer: Pedido[] };
export type Proposta = { id: string; descricao: string; executar: Pedido[]; tarefa_id: string | null };
export type RespostaDoAgente = {
  texto: string;
  citadas: { id: string; titulo: string; quem_faz: string; prazo: string | null; situacao: string }[];
  feitas: Feita[];
  propostas: Proposta[];
  custo_usd: number;
};

// ── Retrato: o que o modelo pode ver ─────────────────────────────────────────────────

type Retrato = {
  tarefas: Map<string, TarefaVista>; // ref → tarefa
  refDe: Map<string, string>; // id → ref
  projetos: Map<string, ProjetoResumo>; // ref → projeto
  reunioes: Map<string, string>; // ref → id
  pessoas: PessoaDaEquipe[];
  texto: string;
};

async function montarRetrato(user: User, ctx: Contexto): Promise<Retrato> {
  const [minhas, paraMim, projetos, reunioes, pessoas] = await Promise.all([
    tarefasFor(user.id).recentes(),
    tarefasParaMim(user.id),
    listarProjetos(user.id),
    meetingsFor(user.id).listParaTtars(),
    pessoasDaEquipe(),
  ]);
  let juntas = [...(minhas as unknown as Tarefa[]), ...paraMim];
  let projetoAberto: { ref: string; nome: string } | null = null;
  const tarefas = new Map<string, TarefaVista>();
  const refDe = new Map<string, string>();
  const refsProjeto = new Map<string, ProjetoResumo>();
  projetos.forEach((p, i) => refsProjeto.set(`p${i + 1}`, p));
  if (ctx.projeto_id) {
    const p = await projetoParaQuemVe(user.id, ctx.projeto_id);
    if (p) {
      const vistos = new Set(juntas.map((t) => t.id));
      juntas = [...juntas, ...p.tarefas.filter((t) => !vistos.has(t.id))];
      const ref = [...refsProjeto.entries()].find(([, x]) => x.id === ctx.projeto_id)?.[0];
      if (ref) projetoAberto = { ref, nome: p.quadro.nome };
    }
  }
  const naTela = (await paraTela(user.id, juntas.sort(ordenarPendencias))) as TarefaVista[];
  const abertas = naTela.filter((t) => t.status === "aberta" || t.status === "em_andamento" || t.status === "aguardando_aprovacao");
  const fechadas = naTela.filter((t) => !abertas.includes(t)).slice(0, MAX_FECHADAS);
  const escolhidas = [...abertas.slice(0, MAX_ABERTAS), ...fechadas];
  escolhidas.forEach((t, i) => {
    tarefas.set(`t${i + 1}`, t);
    refDe.set(t.id, `t${i + 1}`);
  });

  const refsReuniao = new Map<string, string>();
  const listaReunioes = [...reunioes.minhas, ...reunioes.daEquipe]
    .sort((a, b) => ((a.recorded_at ?? "") < (b.recorded_at ?? "") ? 1 : -1))
    .slice(0, 20)
    .map((m, i) => {
      refsReuniao.set(`r${i + 1}`, m.id);
      return {
        ref: `r${i + 1}`,
        nome: tituloCurto(meetingSubject(m.summary, m.nome) || "Reunião", 90),
        dia: diaDoPrazo(m.recorded_at),
        ...(m.user_id !== user.id ? { gravada_por: m.dono_nome } : {}),
        acoes: m.n_tarefas,
      };
    });

  const hoje = hojeBR();
  const dow = diaDaSemanaBR();
  const domingo = maisDiasBR(dow === 0 ? 0 : 7 - dow);
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const tela: string[] = [];
  if (projetoAberto) tela.push(`A pessoa está com o projeto ${projetoAberto.ref} ("${projetoAberto.nome}") aberto na tela.`);
  if (ctx.reuniao_id) {
    const ref = [...refsReuniao.entries()].find(([, id]) => id === ctx.reuniao_id)?.[0];
    if (ref) tela.push(`A pessoa está com a reunião ${ref} aberta na tela.`);
  }
  if (ctx.pessoa_email) {
    const p = pessoas.find((x) => x.email === ctx.pessoa_email!.toLowerCase());
    if (p) tela.push(`A pessoa está na página de ${p.nome}.`);
  }
  if (ctx.tarefa_id && refDe.has(ctx.tarefa_id)) tela.push(`A ação ${refDe.get(ctx.tarefa_id)} está aberta no painel.`);

  const retrato = {
    eu: user.nome,
    hoje: `${DIAS[dow]}, ${hoje}`,
    fim_desta_semana: domingo,
    tela: tela.join(" ") || null,
    acoes_abertas: abertas.length > MAX_ABERTAS ? `${abertas.length} (mostrando as ${MAX_ABERTAS} com prazo mais perto)` : abertas.length,
    acoes: escolhidas.map((t) => linhaDoRetrato(refDe.get(t.id)!, t, hoje)),
    projetos: [...refsProjeto.entries()].map(([ref, p]) => ({
      ref,
      nome: p.nome,
      pessoas: p.pessoas.map((x) => x.nome),
      ...(p.sou_dono ? {} : { criado_por: p.pessoas.find((x) => x.e_dono)?.nome }),
    })),
    reunioes: listaReunioes,
    pessoas_da_welcome: pessoas.map((p) => p.nome),
  };
  return {
    tarefas,
    refDe,
    projetos: refsProjeto,
    reunioes: refsReuniao,
    pessoas,
    texto: JSON.stringify(retrato),
  };
}

// ── Ferramentas ─────────────────────────────────────────────────────────────────────

const nulo = (tipo: string, descricao: string) => ({ type: [tipo, "null"], description: descricao });

const FERRAMENTAS: Ferramenta[] = [
  {
    name: "criar_acao",
    description: "Cria uma ação nova. Use quando a pessoa pedir pra anotar, criar, lembrar ou pedir algo a alguém.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        titulo: { type: "string", description: "O que precisa ser feito, curto, com as palavras da pessoa." },
        quem: nulo("string", "Nome de quem vai fazer, como está em pessoas_da_welcome, ou nome de alguém de fora. null = a própria pessoa."),
        prazo: nulo("string", "AAAA-MM-DD ou null."),
        prioridade: { type: ["string", "null"], enum: ["baixa", "media", "alta", "urgente", null] },
        projeto: nulo("string", "ref do projeto (p1, p2…) ou null."),
        descricao: nulo("string", "Detalhe, se a pessoa deu. Senão null."),
      },
      required: ["titulo", "quem", "prazo", "prioridade", "projeto", "descricao"],
    },
  },
  {
    name: "mudar_acao",
    description: "Muda uma ação que já existe. Só os campos que a pessoa pediu; o resto null. Desistir = situacao 'cancelada' (nunca apaga).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        acao: { type: "string", description: "ref da ação (t1, t2…)." },
        titulo: nulo("string", "Título novo ou null."),
        descricao: nulo("string", "Descrição nova, '' para apagar a descrição, ou null."),
        prazo: nulo("string", "AAAA-MM-DD, 'remover' para tirar o prazo, ou null."),
        prioridade: { type: ["string", "null"], enum: ["baixa", "media", "alta", "urgente", null] },
        situacao: {
          type: ["string", "null"],
          enum: ["aberta", "em_andamento", "aguardando_aprovacao", "concluida", "cancelada", null],
        },
        quem: nulo("string", "Nome de quem passa a fazer, 'eu' para a própria pessoa, ou null para não mexer."),
      },
      required: ["acao", "titulo", "descricao", "prazo", "prioridade", "situacao", "quem"],
    },
  },
  {
    name: "por_no_projeto",
    description: "Põe uma ou mais ações num projeto.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        acoes: { type: "array", items: { type: "string" }, description: "refs das ações (t1, t2…)." },
        projeto: { type: "string", description: "ref do projeto (p1, p2…)." },
      },
      required: ["acoes", "projeto"],
    },
  },
  {
    name: "tirar_do_projeto",
    description: "Tira uma ação de um projeto (a ação continua existindo).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { acao: { type: "string" }, projeto: { type: "string" } },
      required: ["acao", "projeto"],
    },
  },
  {
    name: "criar_projeto",
    description: "Cria um projeto novo (para juntar ações de um assunto). Devolve a ref do projeto.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { nome: { type: "string" }, descricao: nulo("string", "ou null") },
      required: ["nome", "descricao"],
    },
  },
  {
    name: "ver_reuniao",
    description: "Lê o resumo e as ações de uma reunião da lista (quando a pessoa pergunta o que foi falado ou decidido).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { reuniao: { type: "string", description: "ref da reunião (r1, r2…)." } },
      required: ["reuniao"],
    },
  },
];

const RESPOSTA = {
  type: "object",
  additionalProperties: false,
  properties: {
    texto: { type: "string", description: "A resposta pra pessoa, curta, em português do Brasil." },
    acoes_citadas: { type: "array", items: { type: "string" }, description: "refs (t…) das ações citadas na resposta, na ordem." },
  },
  required: ["texto", "acoes_citadas"],
};

function instrucoes(nome: string): string {
  return [
    `Você é o Assistente do Ações, dentro do TTARS da Welcome. Ajuda ${nome} a ver e organizar as ações dele(a): combinados internos que a pessoa faz, cobra de alguém ou só aguarda. Não são as Tarefas de cliente do TTARS.`,
    "O RETRATO (primeira mensagem) tem as ações, projetos, reuniões e pessoas. Use só isso e o que as ferramentas devolverem. Nunca invente ação, pessoa, data ou reunião; se não achar, diga que não achou.",
    "Responda curto e simples, em português do Brasil, sem jargão. Liste no máximo 8 ações; se houver mais, diga quantas são.",
    "Datas: use o 'hoje' do retrato. 'esta semana' vai até fim_desta_semana. Converta 'sexta', 'amanhã', 'semana que vem' para AAAA-MM-DD. Mostre datas como 'sex 03/10'.",
    "Cada ação tem 'vence' já calculado (atrasada N dias, hoje, amanhã, esta semana, semana que vem, depois). Use esse campo, não faça conta de data. Quando perguntarem o que vence (hoje, esta semana), conte também as atrasadas, dizendo que estão atrasadas.",
    "A tela mostra a lista das ações que você puser em acoes_citadas: no texto, resuma em uma ou duas frases (quantas, quais as mais urgentes) em vez de repetir a lista inteira.",
    "Para criar ou mudar, use as ferramentas. Só diga que fez depois da ferramenta responder ok. Se ela devolver 'aguardando_confirmacao', diga que é só apertar Confirmar. Se devolver erro, explique em uma frase.",
    "Se o pedido puder ser mais de uma ação, ou o nome da pessoa for de mais de uma pessoa, pergunte antes citando as opções. Não mude nada que a pessoa não pediu.",
    "Só crie ação quando a pessoa pedir pra criar, anotar, lembrar ou pedir algo a alguém. Se ela pediu pra mudar, concluir ou passar uma ação que não está no retrato, diga que não achou essa ação entre as dela e NÃO crie outra no lugar.",
    "Nunca escreva as refs (t1, p2, r3) no texto: fale pelo nome da ação, do projeto ou da reunião.",
    "Nunca apaga ação: desistir é situacao 'cancelada'. 'Passar para Fulano' = mudar_acao com quem.",
    "Em acoes_citadas, ponha as refs das ações que você mencionou, na ordem em que aparecem no texto.",
  ].join("\n");
}

// ── Execução ─────────────────────────────────────────────────────────────────────────

type Pendente = { feitas: Feita[]; propostas: Proposta[] };

function requisicaoInterna(req: Request, caminho: string, metodo: string, corpo?: unknown): Request {
  const h = new Headers({ "content-type": "application/json" });
  const auth = req.headers.get("authorization");
  const cookie = req.headers.get("cookie");
  if (auth) h.set("authorization", auth);
  if (cookie) h.set("cookie", cookie);
  return new Request(new URL(caminho, "http://acoes.interno"), {
    method: metodo,
    headers: h,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function lerErro(r: Response): Promise<string> {
  const d = (await r.json().catch(() => null)) as { error?: string } | null;
  return d?.error || `não deu (${r.status})`;
}

/** Nome dito → corpo do PATCH para "quem faz". */
function corpoDeQuem(
  quem: string,
  t: TarefaVista,
  user: User,
  pessoas: PessoaDaEquipe[],
): { corpo: Record<string, unknown>; texto: string } | { erro: string } | null {
  if (ehEu(quem) || quem.trim().toLowerCase() === user.nome.trim().toLowerCase()) {
    if (ehMinha(t)) return t.acao === "executar" ? null : { corpo: { acao: "executar" }, texto: "agora é sua" };
    if (t.is_mine) return null;
    if (!user.email) return { erro: "não sei o seu e-mail para passar a ação pra você" };
    return { corpo: { responsavel_email: user.email }, texto: "agora é sua" };
  }
  const achado = acharPessoaPorNome(quem, pessoas);
  if (achado && "ambiguas" in achado) {
    return { erro: `mais de uma pessoa com esse nome: ${achado.ambiguas.map((p) => p.nome).join(", ")}. Pergunte qual.` };
  }
  if (achado && "pessoa" in achado) {
    if (achado.pessoa.email === (user.email ?? "").toLowerCase()) return corpoDeQuem("eu", t, user, pessoas);
    return { corpo: { responsavel_email: achado.pessoa.email }, texto: `passa para ${achado.pessoa.nome}` };
  }
  if (!ehMinha(t)) return { erro: `${quem} não está na lista da Welcome; só quem criou a ação pode pôr alguém de fora.` };
  return { corpo: { owner: quem.trim().slice(0, 80), acao: "cobrar", responsavel_user_id: null }, texto: `com ${quem.trim()} (de fora da Welcome)` };
}

async function executar(
  chamada: { name: string; args: Record<string, unknown> },
  ctx: { user: User; req: Request; retrato: Retrato; pendente: Pendente; fechandoNoLote: number; workspace: string | null },
): Promise<unknown> {
  const { user, req, retrato, pendente } = ctx;
  const a = chamada.args;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  if (chamada.name === "criar_acao") {
    const titulo = str(a.titulo);
    if (!titulo) return { erro: "faltou o título" };
    const projeto = str(a.projeto) ? retrato.projetos.get(str(a.projeto)!) : undefined;
    if (str(a.projeto) && !projeto) return { erro: `projeto ${a.projeto} não existe no retrato` };
    let quem_email: string | null = null;
    let quem_nome_fora: string | null = null;
    const quem = str(a.quem);
    if (quem && !ehEu(quem)) {
      const achado = acharPessoaPorNome(quem, retrato.pessoas);
      if (achado && "ambiguas" in achado) {
        return { erro: `mais de uma pessoa com esse nome: ${achado.ambiguas.map((p) => p.nome).join(", ")}. Pergunte qual.` };
      }
      if (achado && "pessoa" in achado) quem_email = achado.pessoa.email;
      else quem_nome_fora = quem;
    }
    const r = await criarAcao(user, {
      titulo,
      descricao: str(a.descricao),
      quem_email,
      quem_nome_fora,
      prazo: str(a.prazo),
      prioridade: (str(a.prioridade) as never) ?? null,
      projeto_id: projeto?.id ?? null,
      workspace: ctx.workspace,
      origem: "agente",
    });
    if (!r.ok) return { erro: r.erro };
    const t = r.tarefa as TarefaVista;
    const ref = `t${retrato.tarefas.size + 1}`;
    retrato.tarefas.set(ref, t);
    retrato.refDe.set(t.id, ref);
    const partes = [
      quem_email || quem_nome_fora ? `com ${t.acao === "executar" ? "você" : (t.pessoas?.find((p) => (p as { principal?: boolean }).principal)?.nome ?? t.owner)}` : null,
      t.prazo ? `prazo ${dataCurtaBR(t.prazo)}` : null,
      projeto ? `no projeto ${projeto.nome}` : null,
    ].filter(Boolean);
    const descricao = `Criei "${tituloCurto(t.titulo)}"${partes.length ? `, ${partes.join(", ")}` : ""}.`;
    pendente.feitas.push({ descricao, tarefa_id: t.id, desfazer: [{ metodo: "DELETE", caminho: `/api/tarefas/${t.id}` }] });
    return { ok: true, ref, ...(r.aviso ? { aviso: r.aviso } : {}) };
  }

  if (chamada.name === "mudar_acao") {
    const ref = str(a.acao) ?? "";
    const t = retrato.tarefas.get(ref);
    if (!t) return { erro: `ação ${ref} não existe no retrato` };
    const mudanca: Mudanca = {
      titulo: str(a.titulo),
      descricao: typeof a.descricao === "string" ? a.descricao : null,
      prazo: str(a.prazo),
      prioridade: str(a.prioridade),
      situacao: str(a.situacao),
    };
    const m = montarMudanca(t, mudanca);
    if ("erro" in m) return { erro: m.erro };
    const corpo = { ...m.corpo };
    const desfazer = { ...m.desfazer };
    const partes = [...m.partes];
    const quem = str(a.quem);
    if (quem) {
      const q = corpoDeQuem(quem, t, user, retrato.pessoas);
      if (q && "erro" in q) return { erro: q.erro };
      if (q) {
        Object.assign(corpo, q.corpo, ctx.workspace ? { workspace: ctx.workspace } : {});
        if (ehMinha(t)) Object.assign(desfazer, desfazerQuem(t));
        partes.push(q.texto);
      }
    }
    if (!Object.keys(corpo).length) return { ok: true, nada_mudou: true };
    const descricao = `"${tituloCurto(t.titulo)}": ${partes.join(", ")}.`;
    const pedido: Pedido = { metodo: "PATCH", caminho: `/api/tarefas/${t.id}`, corpo };
    const desfazerPedidos: Pedido[] = Object.keys(desfazer).length ? [{ metodo: "PATCH", caminho: `/api/tarefas/${t.id}`, corpo: desfazer }] : [];
    if (precisaConfirmar(t, corpo, ctx.fechandoNoLote)) {
      pendente.propostas.push({ id: `${t.id}:${pendente.propostas.length}`, descricao, executar: [pedido], tarefa_id: t.id });
      return {
        aguardando_confirmacao: true,
        motivo: ehMinha(t) ? "muitas mudanças de uma vez" : `a ação foi criada por ${t.criador_nome ?? "outra pessoa"}`,
      };
    }
    const r = await patchTarefa(requisicaoInterna(req, pedido.caminho, "PATCH", corpo), { params: Promise.resolve({ id: t.id }) });
    if (!r.ok) return { erro: await lerErro(r) };
    pendente.feitas.push({ descricao, tarefa_id: t.id, desfazer: desfazerPedidos });
    // O retrato passa a ter a ação como ficou (a lista que a tela mostra no fim já sai certa).
    const atual = await tarefaNaTela(user.id, t.id).catch(() => null);
    if (atual) retrato.tarefas.set(ref, atual.tarefa as TarefaVista);
    return { ok: true };
  }

  if (chamada.name === "por_no_projeto") {
    const projeto = retrato.projetos.get(str(a.projeto) ?? "");
    if (!projeto) return { erro: `projeto ${a.projeto} não existe no retrato` };
    const refs = Array.isArray(a.acoes) ? a.acoes.filter((x): x is string => typeof x === "string") : [];
    const ts = refs.map((r) => retrato.tarefas.get(r)).filter((x): x is TarefaVista => !!x);
    if (!ts.length) return { erro: "nenhuma ação válida" };
    const r = await adicionarAoProjeto(user.id, projeto.id, ts.map((t) => t.id));
    if (!r) return { erro: "você não está nesse projeto" };
    const nomes = ts.length === 1 ? `"${tituloCurto(ts[0].titulo)}"` : `${ts.length} ações`;
    pendente.feitas.push({
      descricao: `Pus ${nomes} no projeto ${projeto.nome}.`,
      tarefa_id: ts.length === 1 ? ts[0].id : null,
      desfazer: ts
        .filter((t) => !(t.projetos ?? []).some((p) => p.id === projeto.id))
        .map((t) => ({ metodo: "DELETE" as const, caminho: `/api/quadros/${projeto.id}/tarefas/${t.id}` })),
    });
    return { ok: true, ...r };
  }

  if (chamada.name === "tirar_do_projeto") {
    const projeto = retrato.projetos.get(str(a.projeto) ?? "");
    const t = retrato.tarefas.get(str(a.acao) ?? "");
    if (!projeto || !t) return { erro: "ação ou projeto não existe no retrato" };
    if (!(await tirarDoProjeto(user.id, projeto.id, t.id))) return { erro: "você não está nesse projeto" };
    pendente.feitas.push({
      descricao: `Tirei "${tituloCurto(t.titulo)}" do projeto ${projeto.nome}.`,
      tarefa_id: t.id,
      desfazer: [{ metodo: "POST", caminho: `/api/quadros/${projeto.id}/tarefas`, corpo: { tarefaIds: [t.id] } }],
    });
    return { ok: true };
  }

  if (chamada.name === "criar_projeto") {
    const nome = str(a.nome);
    if (!nome) return { erro: "faltou o nome" };
    const r = await postQuadro(requisicaoInterna(req, "/api/quadros", "POST", { nome: nome.slice(0, 120), descricao: str(a.descricao) ?? undefined }), undefined);
    if (!r.ok) return { erro: await lerErro(r) };
    const q = (await r.json()) as { id: string; nome: string };
    const ref = `p${retrato.projetos.size + 1}`;
    retrato.projetos.set(ref, { ...(q as unknown as ProjetoResumo), nome: q.nome ?? nome, pessoas: [], sou_dono: true, n_tarefas: 0 });
    pendente.feitas.push({
      descricao: `Criei o projeto ${nome}.`,
      tarefa_id: null,
      desfazer: [{ metodo: "DELETE", caminho: `/api/quadros/${q.id}` }],
    });
    return { ok: true, ref };
  }

  if (chamada.name === "ver_reuniao") {
    const id = retrato.reunioes.get(str(a.reuniao) ?? "");
    if (!id) return { erro: `reunião ${a.reuniao} não existe no retrato` };
    const m = await meetingsFor(user.id).byIdDetailed(id);
    if (!m) return { erro: "essa reunião não está aberta pra você" };
    const det = m as unknown as { user_id: string; executive_summary: string | null; summary: string | null; speaker_labels: Record<string, string> | null };
    const tarefas = await paraTela(user.id, (await tarefasFor(user.id).byMeeting(id)) as Tarefa[]);
    const refs = tarefas.map((t) => {
      let ref = retrato.refDe.get(t.id);
      if (!ref) {
        ref = `t${retrato.tarefas.size + 1}`;
        retrato.tarefas.set(ref, t as TarefaVista);
        retrato.refDe.set(t.id, ref);
      }
      return linhaDoRetrato(ref, t as TarefaVista);
    });
    const resumo = trocarFalantes(det.executive_summary || det.summary || "", det.speaker_labels) ?? "";
    return { resumo: resumo.slice(0, 3500), acoes: refs };
  }

  return { erro: `ferramenta desconhecida: ${chamada.name}` };
}

// ── A conversa ───────────────────────────────────────────────────────────────────────

export async function conversar(
  user: User,
  req: Request,
  entrada: { falas: Fala[]; contexto: Contexto; workspace: string | null },
): Promise<RespostaDoAgente> {
  const falas = entrada.falas
    .filter((f) => (f.quem === "pessoa" || f.quem === "assistente") && typeof f.texto === "string" && f.texto.trim())
    .slice(-20)
    .map((f) => ({ ...f, texto: f.texto.slice(0, 2000) }));
  if (!falas.length || falas[falas.length - 1].quem !== "pessoa") throw new IaIndisponivel("Escreva uma pergunta.");

  const retrato = await montarRetrato(user, entrada.contexto);
  const entradaModelo: Item[] = [
    { role: "user", content: `RETRATO:\n${retrato.texto}` },
    ...falas.map((f) => ({ role: f.quem === "pessoa" ? "user" : "assistant", content: f.texto })),
  ];
  const pendente: Pendente = { feitas: [], propostas: [] };
  let custo = 0;
  let chamadasFeitas = 0;

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const ultima = rodada === MAX_RODADAS - 1 || chamadasFeitas >= MAX_CHAMADAS;
    const r = await chamarModelo({
      userId: user.id,
      instrucoes: instrucoes(user.nome),
      entrada: entradaModelo,
      // Na última volta as ferramentas continuam declaradas (a conversa já tem chamadas delas),
      // mas o modelo só pode responder.
      ferramentas: FERRAMENTAS,
      usarFerramentas: ultima ? "none" : "auto",
      formato: { nome: "resposta", schema: RESPOSTA },
      maxSaida: 3000,
    });
    custo += r.custoUsd;
    if (!r.chamadas.length) {
      let texto = r.texto;
      let citadas: string[] = [];
      try {
        const d = JSON.parse(r.texto) as { texto: string; acoes_citadas: string[] };
        texto = d.texto;
        citadas = Array.isArray(d.acoes_citadas) ? d.acoes_citadas : [];
      } catch {
        // resposta fora do formato: mostra o texto cru
      }
      // Rede de segurança: ref interna (t3, p1) não aparece pra pessoa.
      texto = texto.replace(/\s*[[(](?:[tpr]\d+(?:\s*,\s*)?)+[\])]/g, "").replace(/[ \t]+\n/g, "\n");
      return {
        texto: texto.trim() || "Pronto.",
        citadas: [...new Set(citadas)]
          .map((ref) => retrato.tarefas.get(ref))
          .filter((t): t is TarefaVista => !!t && !pendente.feitas.some((f) => f.tarefa_id === t.id) && !pendente.propostas.some((p) => p.tarefa_id === t.id))
          .slice(0, 12)
          .map((t) => ({ id: t.id, titulo: t.titulo, quem_faz: linhaDoRetrato("", t).quem_faz, prazo: diaDoPrazo(t.prazo), situacao: t.status })),
        feitas: pendente.feitas,
        propostas: pendente.propostas,
        custo_usd: Number(custo.toFixed(5)),
      };
    }
    entradaModelo.push(...r.itens);
    // Conclusões e cancelamentos pedidos nesta rodada contam juntos (lote grande pede Confirmar).
    const fechandoNoLote =
      pendente.feitas.length +
      r.chamadas.filter((c) => c.name === "mudar_acao" && (c.args.situacao === "concluida" || c.args.situacao === "cancelada")).length;
    for (const c of r.chamadas) {
      chamadasFeitas++;
      let saida: unknown;
      try {
        saida =
          chamadasFeitas > MAX_CHAMADAS
            ? { erro: "muitas mudanças de uma vez; peça em partes" }
            : await executar(c, { user, req, retrato, pendente, fechandoNoLote, workspace: entrada.workspace });
      } catch (e) {
        console.error(`[agente] ${c.name}:`, e);
        saida = { erro: "não consegui fazer isso agora" };
      }
      entradaModelo.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(saida) });
    }
  }
  throw new IaIndisponivel("Não consegui terminar. Tente pedir em partes.");
}

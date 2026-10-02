// Assistente do Ações dentro do TTARS: conversa que vê, cria e ajusta ações.
//
// Pedido do Vitor (26/09/2026): "ter o agente que você conversa pra ajudar a ver tarefas,
// ajustar, editar". Modelo barato (GPT-6 Luna, lib/ia.ts). Toda mudança passa pelas MESMAS
// rotas das telas (chamadas aqui dentro com o acesso de quem pede), então quem pode o quê
// é exatamente o das telas. Regras de confirmar/desfazer em lib/agente-regras.ts.
import type { User } from "./auth";
import { dataCurtaBR, hojeBR, diaDaSemanaBR, maisDiasBR } from "./data-br";
import { withTenant, withTenantLeituraEquipe } from "./db";
import { isTeamMode } from "./team-mode";
import { tarefasFor, meetingsFor, type Tarefa } from "./queries";
import { carregarTarefas, tarefasMarcadasParaMim, tarefasParaMim, pessoasDaEquipe, type PessoaDaEquipe } from "./equipe-compartilhado";
import { ordenarPendencias } from "./compartilhar";
import { listarProjetos, projetoParaQuemVe, adicionarAoProjeto, tirarDoProjeto, type ProjetoResumo } from "./projetos";
import { meetingSubject } from "./meeting-label";
import { trocarFalantes } from "./falantes";
import { comentarNaTarefa, comentariosDaTarefa, historicoDaTarefa, paraTela, tarefaNaTela } from "./ttars-tela";
import { pessoasQueVeemATarefa } from "./quem-ve";
import { acervo, escolherPeloSentido } from "./agente-acervo";
import { criarAcao } from "./nova-acao";
import { acharPessoaPorNome, ehEu } from "./pessoa-por-nome";
import { chamarModelo, IaIndisponivel, type Ferramenta, type Item } from "./ia";
import {
  anotarNaTela,
  desfazerQuem,
  diaDoPrazo,
  ehMinha,
  idsDasFalas,
  limparRefs,
  linhaCorrida,
  linhaDoRetrato,
  montarMudanca,
  precisaConfirmar,
  quemFazNaTela,
  tituloCurto,
  type Mudanca,
  type Pedido,
  type TarefaVista,
} from "./agente-regras";
import { PATCH as patchTarefa } from "@/app/api/tarefas/[id]/route";
import { POST as postQuadro } from "@/app/api/quadros/route";
import { objetivosVisiveis, podeTime, tarefasDoObjetivo, tarefasDoTime, timesDasPessoas } from "./hub";

const MAX_RODADAS = 4;
const MAX_CHAMADAS = 10;
const MAX_ABERTAS = 150;
const MAX_FECHADAS = 25;
// Pedido "todas" vem inteiro (antes eram no máximo 8 no texto e 12 na tela); cabe o retrato inteiro.
const MAX_CITADAS = 200;
/** Com mais linhas que isto o acervo vai à escolha sem o detalhe (a chamada ficaria lenta). */
const ACERVO_COM_DETALHE = 400;

/** `acoes` (só nas do assistente): ids do que apareceu na tela com aquela resposta. */
export type Fala = { quem: "pessoa" | "assistente"; texto: string; acoes?: string[] };
export type Contexto = {
  tela?: string | null;
  projeto_id?: string | null;
  reuniao_id?: string | null;
  pessoa_email?: string | null;
  tarefa_id?: string | null;
  /** Hub (28/09/2026): time ou objetivo aberto na tela. */
  time_id?: string | null;
  objetivo_id?: string | null;
};
export type Feita = { descricao: string; tarefa_id: string | null; desfazer: Pedido[] };
export type Proposta = { id: string; descricao: string; executar: Pedido[]; tarefa_id: string | null };
export type RespostaDoAgente = {
  texto: string;
  /** `abre` = quem pergunta abre o painel da ação; senão, `reuniao_id` leva à reunião de onde ela saiu. */
  citadas: { id: string; titulo: string; quem_faz: string; prazo: string | null; situacao: string; abre: boolean; reuniao_id: string | null }[];
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

/** Quem faz tem o nome de quem pergunta numa ação da lista de um colega ("Vitor" na reunião do Tiago = você). */
function quemFazSouEu(t: TarefaVista, user: User, pessoas: PessoaDaEquipe[]): boolean {
  if (!t.compartilhada || t.is_mine || !user.email) return false;
  const achado = acharPessoaPorNome(quemFazNaTela(t), pessoas);
  return !!achado && "pessoa" in achado && achado.pessoa.email === user.email.toLowerCase();
}

/**
 * Ações que quem pergunta enxerga entre as que `onde` escolhe: as dele e as das reuniões que ele abre (a mesma regra
 * de quem vê das telas). Cada uma vem do ponto de vista dele: o "eu" de quem gravou vira o nome de quem gravou.
 */
async function carregarVisiveis(userId: string, onde: string, valores: unknown[], limite: number): Promise<TarefaVista[]> {
  const r = await (isTeamMode() ? withTenantLeituraEquipe : withTenant)(userId, (c) =>
    c.query<{ tarefa_id: string; dono_id: string }>(
      `SELECT t.id::text AS tarefa_id, t.user_id::text AS dono_id FROM tarefas t
        WHERE ${onde}
        ORDER BY (t.status NOT IN ('aberta','em_andamento','aguardando_aprovacao')), (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
        LIMIT ${limite}`,
      valores,
    ),
  );
  if (!r.rows.length) return [];
  const tarefas = await carregarTarefas(userId, r.rows);
  return (await paraTela(userId, tarefas.sort(ordenarPendencias))) as TarefaVista[];
}

/** As ações que apareceram com as respostas anteriores e não estão na lista (de reunião de colega, de outra página).
 *  Falhou: a pergunta segue sem elas (lembrar é ajuda, não pode derrubar a resposta). */
async function lembradas(userId: string, ids: string[]): Promise<TarefaVista[]> {
  try {
    const achadas = await carregarVisiveis(userId, "t.id = ANY($1::uuid[])", [ids], ids.length);
    const vistas = new Set(achadas.map((t) => t.id));
    let resto = ids.filter((id) => !vistas.has(id));
    if (resto.length && isTeamMode()) {
      // Passadas, marcadas, de projeto ou de time ficam no dono: o mesmo acesso do painel da ação, de uma vez só.
      const pares = await withTenant(userId, (c) =>
        c.query<{ tarefa_id: string; dono_id: string }>(
          `SELECT x::text AS tarefa_id, a.dono_id::text AS dono_id FROM unnest($1::uuid[]) AS x CROSS JOIN LATERAL equipe_acesso_tarefa(x) AS a`,
          [resto],
        ),
      );
      if (pares.rows.length) {
        const doDono = (await paraTela(userId, await carregarTarefas(userId, pares.rows))) as TarefaVista[];
        achadas.push(...doDono);
        doDono.forEach((t) => vistas.add(t.id));
        resto = resto.filter((id) => !vistas.has(id));
      }
    }
    // Sobra só o que o painel abre por outra regra (pedido ao marketing): uma a uma, poucas.
    const outras = await Promise.all(resto.slice(0, 10).map((id) => tarefaNaTela(userId, id).catch(() => null)));
    return [...achadas, ...outras.flatMap((x) => (x ? [x.tarefa as TarefaVista] : []))];
  } catch (e) {
    console.error("[agente] lembrar as ações mostradas:", e);
    return [];
  }
}

/** Das ações de outras pessoas, as que quem pergunta abre no painel (a mesma régua de acessoTarefa e dos projetos). */
async function abreNoPainel(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  if (!isTeamMode()) return new Set(ids);
  const r = await withTenant(userId, (c) =>
    c.query<{ id: string }>(
      `SELECT x::text AS id FROM unnest($1::uuid[]) AS x
        WHERE EXISTS (SELECT 1 FROM equipe_acesso_tarefa(x))
           OR ((EXISTS (SELECT 1 FROM tarefa_pedidos tp WHERE tp.tarefa_id = x)
                OR EXISTS (SELECT 1 FROM notion_paginas np WHERE np.tarefa_id = x)
                OR EXISTS (SELECT 1 FROM notion_envios ne WHERE ne.tarefa_id = x))
               AND pedido_posso_mexer())`,
      [ids],
    ),
  );
  return new Set(r.rows.map((x) => x.id));
}

async function montarRetrato(user: User, ctx: Contexto, lembrar: string[] = []): Promise<Retrato> {
  // A lista é a da tela Minhas ações: as dela, as passadas a ela e as que marcaram para ela ver.
  const [minhas, paraMim, marcadas, projetos, reunioes, pessoas] = await Promise.all([
    tarefasFor(user.id).recentes(),
    tarefasParaMim(user.id),
    tarefasMarcadasParaMim(user.id),
    listarProjetos(user.id),
    meetingsFor(user.id).listParaTtars(),
    pessoasDaEquipe(),
  ]);
  let juntas = [...(minhas as unknown as Tarefa[]), ...paraMim, ...marcadas];
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
  // Na página de um time ou de um objetivo, as ações dele entram no retrato (não são só as minhas).
  let lugarAberto: string | null = null;
  const juntar = (mais: Tarefa[]) => {
    const vistos = new Set(juntas.map((t) => t.id));
    juntas = [...juntas, ...mais.filter((t) => !vistos.has(t.id))];
  };
  if (ctx.time_id && (await podeTime(user.id, ctx.time_id))) {
    juntar(await tarefasDoTime(user.id, ctx.time_id));
    const nome = timesDasPessoas(pessoas).get(ctx.time_id)?.nome;
    if (nome) lugarAberto = `A pessoa está na página do time "${nome}" (as ações com time "${nome}" são do time: todo mundo dele vê e mexe).`;
  }
  if (ctx.objetivo_id) {
    const [obj] = await objetivosVisiveis(user.id, ctx.objetivo_id);
    if (obj) {
      juntar(await tarefasDoObjetivo(user.id, ctx.objetivo_id));
      lugarAberto = `A pessoa está na página do objetivo "${obj.nome}" (${obj.feitas} de ${obj.total} ações feitas${obj.prazo ? `, até ${obj.prazo}` : ""}).`;
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
  const faltam = lembrar.filter((id) => !refDe.has(id));
  const jaMostradas = faltam.length ? (await lembradas(user.id, faltam)).filter((t) => !refDe.has(t.id)) : [];
  for (const t of jaMostradas) {
    const ref = `t${tarefas.size + 1}`;
    tarefas.set(ref, t);
    refDe.set(t.id, ref);
  }

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
  if (lugarAberto) tela.push(lugarAberto);
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
    acoes: escolhidas.map((t) => linhaDoRetrato(refDe.get(t.id)!, t, hoje, quemFazSouEu(t, user, pessoas))),
    ...(jaMostradas.length
      ? { ja_mostradas: jaMostradas.map((t) => linhaDoRetrato(refDe.get(t.id)!, t, hoje, quemFazSouEu(t, user, pessoas))) }
      : {}),
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
        descricao: nulo("string", "Só quando a pessoa pedir para mudar a DESCRIÇÃO: o texto novo inteiro, '' para apagar. Comentário vai em comentar_acao. null = não mexe."),
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
  {
    name: "procurar",
    description:
      "Procura pelo SENTIDO em tudo o que a pessoa vê: a lista dela, as ações das reuniões dela e dos colegas que ela abre, as passadas e marcadas para ela, as dos projetos (inclusive a área Marketing) e dos times. Use para pedido por assunto ('tudo de TTARS', 'o que falamos de WhatsApp'), por pessoa ('o que a Paula me deve', 'o que eu devo ao Tiago', 'com o meu nome') e de repetidas.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        pedido: {
          type: "string",
          description:
            "O que procurar, em frase completa e com o sentido amplo (ex.: 'ações sobre o TTARS ou CRM: telas, cards, funil, relatórios, acessos; só as que Vitor ficou de fazer').",
        },
        incluir_concluidas: { type: "boolean", description: "true = também as concluídas. Canceladas nunca vêm." },
        repetidas: { type: "boolean", description: "true = agrupar as que são o mesmo combinado (pedido de repetidas ou 'sem repetir')." },
      },
      required: ["pedido", "incluir_concluidas", "repetidas"],
    },
  },
  {
    name: "ver_acao",
    description:
      "Lê tudo de uma ação: descrição, trecho falado na reunião, comentários, histórico, quem vê, quem também faz, anexos, projeto, time, reunião e pedido ao marketing. Use antes de responder sobre detalhes, andamento ou o que já foi feito.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { acao: { type: "string", description: "ref da ação (t1, t2…)." } },
      required: ["acao"],
    },
  },
  {
    name: "comentar_acao",
    description:
      "Escreve um comentário numa ação ('comenta', 'anota na ação', 'registra que…'). Comentar nunca é mudar a descrição.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        acao: { type: "string", description: "ref da ação (t1, t2…)." },
        texto: { type: "string", description: "O comentário, com as palavras da pessoa." },
      },
      required: ["acao", "texto"],
    },
  },
];

const RESPOSTA = {
  type: "object",
  additionalProperties: false,
  properties: {
    texto: { type: "string", description: "A resposta pra pessoa, curta, em português do Brasil." },
    acoes_citadas: {
      type: "array",
      items: { type: "string" },
      description: "refs (t…) de todas as ações que respondem ao pedido (a tela mostra todas), primeiro as que o texto nomeia, na ordem do texto.",
    },
  },
  required: ["texto", "acoes_citadas"],
};

function instrucoes(nome: string): string {
  return [
    `Você é o Assistente do Ações, dentro do TTARS da Welcome. Ajuda ${nome} a ver e organizar as ações dele(a): combinados internos que a pessoa faz, cobra de alguém ou só aguarda. Não são as Tarefas de cliente do TTARS.`,
    "O RETRATO (primeira mensagem) tem a lista da pessoa ('acoes': as dela, as passadas e as marcadas para ela), os projetos, as reuniões recentes e as pessoas. O resto do que ela vê (ações das reuniões de colegas, dos projetos, da área Marketing e dos times) só vem por procurar.",
    "Pedido por assunto, por pessoa ou de repetidas ('tudo de TTARS', 'o que falei de X nas reuniões', 'o que a Paula me deve', 'o que eu devo ao Tiago', 'com o meu nome', 'quais estão repetidas'): chame procurar com um pedido completo e de sentido amplo; ele escolhe pelo SENTIDO em tudo o que a pessoa vê. 'Coisas no TTARS/CRM' = telas, cards, funil, etapas, régua, relatórios, painéis, acessos, módulos, busca, assistente, atendimento e WhatsApp do sistema, mesmo sem a palavra. 'Só as minhas' = diga no pedido 'só as que " + nome + " faz'. 'O que ele tem comigo' = os dois sentidos.",
    "Detalhe de uma ação (descrição, o que foi falado na reunião, comentários, andamento, quem vê): chame ver_acao. Nunca diga que algo não existe sem ler.",
    "Use só o retrato e o que as ferramentas devolverem. Nunca invente ação, pessoa, data ou reunião; se não achar, diga que não achou.",
    "Responda curto e simples, em português do Brasil, sem jargão.",
    "Datas: use o 'hoje' do retrato. 'esta semana' vai até fim_desta_semana. Converta 'sexta', 'amanhã', 'semana que vem' para AAAA-MM-DD. Mostre datas como 'sex 03/10'.",
    "Cada ação tem 'vence' já calculado (atrasada N dias, hoje, amanhã, esta semana, semana que vem, depois). Use esse campo, não faça conta de data. Quando perguntarem o que vence (hoje, esta semana), conte também as atrasadas, dizendo que estão atrasadas.",
    "A tela mostra, embaixo da resposta, todas as ações que você puser em acoes_citadas, sem limite. Ponha ali todas as que respondem ao pedido: se pedirem todas, nunca corte nem escolha só algumas. Em resumo de reuniões, cite só as ações que a pessoa pediu ou as dela, nunca todas as das reuniões. No texto, diga quantas são (o mesmo número de acoes_citadas) e resuma em uma ou duas frases; só escreva a lista no texto se a pessoa pedir em texto, e aí a lista inteira, uma por linha. Pediram sem repetir: o mesmo combinado em mais de um lugar entra uma vez só, e diga quantas juntou.",
    "Cada resposta sua anterior termina com [na tela: …]: as ações que apareceram com ela. 'Manda todas', 'você só mandou 8', 'repete', 'essas' falam delas, que estão no retrato com essas refs (as que não são da lista vêm em ja_mostradas). Nunca escreva [na tela: …] na resposta.",
    "A lista dela é 'acoes' do retrato. Pergunta sobre o que ela tem (o que vence, atrasadas, o que faz, o que cobra) olha só 'acoes'; ja_mostradas e o que as ferramentas trouxeram só entram quando ela falar dessas ações ou do assunto delas.",
    "quem_faz 'você' = a própria pessoa (também numa ação da lista de outra pessoa). tipo é o papel dela: 'eu faço', 'eu cobro', 'só aguardo', 'faço junto' ou 'da lista de quem criou' (nem faz nem cobra: a ação é de criada_por).",
    "Comentar ('comenta', 'anota na ação', 'registra que…') = comentar_acao. Mudar a descrição só quando a pessoa pedir para mudar a descrição.",
    "O pedido da pessoa já é a autorização: crie ou mude na hora com as ferramentas, sem perguntar se pode; a tela mostra Desfazer. Só descreva antes, sem mudar, se a pessoa pedir para ver antes. Só diga que fez depois da ferramenta responder ok. Se ela devolver 'aguardando_confirmacao' (trocar quem faz numa ação que outra pessoa criou), diga que é só apertar Confirmar. Se devolver erro, explique em uma frase.",
    "Se o pedido puder ser mais de uma ação, ou o nome da pessoa for de mais de uma pessoa, pergunte antes citando as opções. Não mude nada que a pessoa não pediu.",
    "Só crie ação quando a pessoa pedir pra criar, anotar, lembrar ou pedir algo a alguém. Se ela pediu pra mudar, concluir ou passar uma ação que não está no retrato nem veio de uma ferramenta, diga que não achou essa ação entre as dela e NÃO crie outra no lugar.",
    "Fora do Ações (mandar e-mail, WhatsApp ou mensagem, ligar, marcar reunião): diga que você não manda nada e ofereça um lembrete para a própria pessoa (ex.: 'Cobrar a Paula pelas peças', quem faz = ela mesma). Nunca crie ação para outra pessoa fazer o envio.",
    "Nunca escreva as refs (t1, p2, r3) no texto: fale pelo nome da ação, do projeto ou da reunião.",
    "Nunca apaga ação: desistir é situacao 'cancelada'. 'Passar para Fulano' = mudar_acao com quem.",
  ].join("\n");
}

// ── Execução ─────────────────────────────────────────────────────────────────────────

/** `custo`: o que as ferramentas gastaram de IA (a escolha pelo sentido) e entra na conta da pergunta. */
type Pendente = { feitas: Feita[]; propostas: Proposta[]; custo: number };

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
  ctx: { user: User; req: Request; retrato: Retrato; pendente: Pendente; workspace: string | null },
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
    if (precisaConfirmar(t, corpo)) {
      pendente.propostas.push({ id: `${t.id}:${pendente.propostas.length}`, descricao, executar: [pedido], tarefa_id: t.id });
      return {
        aguardando_confirmacao: true,
        motivo: `a ação foi criada por ${t.criador_nome ?? "outra pessoa"}: trocando quem faz, você pode perder o acesso a ela e o Desfazer não alcança`,
      };
    }
    const r = await patchTarefa(requisicaoInterna(req, pedido.caminho, "PATCH", corpo), { params: Promise.resolve({ id: t.id }) });
    // Ação vista só pela reunião de um colega: a rota não acha (404); dizer de quem é em vez de "não encontrada".
    if (r.status === 404 && t.compartilhada) return { erro: `essa ação é da lista de ${t.criador_nome ?? "outra pessoa"}: só ela muda` };
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
    if ("erro" in r) return { erro: r.erro };
    // O projeto recusa a ação da lista de outra pessoa que quem pede só vê pela reunião: conta o que entrou.
    const abre = await abreNoPainel(user.id, ts.filter((t) => t.compartilhada).map((t) => t.id));
    const entraram = ts.filter((t) => (!t.compartilhada || abre.has(t.id)) && !(t.projetos ?? []).some((p) => p.id === projeto.id));
    if (!entraram.length) return { ...r, erro: r.recusadas ? "essas ações são da lista de outras pessoas; o projeto não aceita" : "já estavam no projeto" };
    const nomes = entraram.length === 1 ? `"${tituloCurto(entraram[0].titulo)}"` : `${entraram.length} ações`;
    pendente.feitas.push({
      descricao: `Pus ${nomes} no projeto ${projeto.nome}.${r.recusadas ? ` ${r.recusadas} ficaram de fora: são da lista de outras pessoas.` : ""}`,
      tarefa_id: entraram.length === 1 ? entraram[0].id : null,
      desfazer: entraram.map((t) => ({ metodo: "DELETE" as const, caminho: `/api/quadros/${projeto.id}/tarefas/${t.id}` })),
    });
    return { ok: true, ...r };
  }

  if (chamada.name === "tirar_do_projeto") {
    const projeto = retrato.projetos.get(str(a.projeto) ?? "");
    const t = retrato.tarefas.get(str(a.acao) ?? "");
    if (!projeto || !t) return { erro: "ação ou projeto não existe no retrato" };
    const tirou = await tirarDoProjeto(user.id, projeto.id, t.id);
    if (typeof tirou === "object") return { erro: tirou.erro };
    if (!tirou) return { erro: "você não está nesse projeto" };
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
    // Do ponto de vista de quem pergunta, como a página da reunião: na reunião de um colega, o "eu" é de quem
    // gravou (antes virava "você": 4 das 8 ações que o Vitor viu em 02/10 eram da Ana e da Mariana).
    const tarefas = await carregarVisiveis(user.id, "t.meeting_id = $1::uuid", [id], 200);
    const hoje = hojeBR();
    const refs = tarefas.map((t) => linhaDoRetrato(refNoRetrato(retrato, t), t, hoje, quemFazSouEu(t, user, retrato.pessoas)));
    const resumo = trocarFalantes(det.executive_summary || det.summary || "", det.speaker_labels) ?? "";
    return { resumo: resumo.slice(0, 3500), acoes: refs };
  }

  if (chamada.name === "procurar") {
    const pedido = str(a.pedido);
    if (!pedido) return { erro: "faltou dizer o que procurar" };
    const concluidas = a.incluir_concluidas === true;
    const repetidas = a.repetidas === true;
    const vale = (t: TarefaVista) =>
      t.status === "aberta" || t.status === "em_andamento" || t.status === "aguardando_aprovacao" || (concluidas && t.status === "concluida");
    const { tarefas, cortado } = await acervo(user.id, { concluidas });
    // O que já está no retrato (lista, página aberta, o que veio de ferramenta) fica com a ref e a versão de lá.
    const vistas = new Set<string>();
    const todas = [...[...retrato.tarefas.values()].filter(vale), ...tarefas].filter((t) => !vistas.has(t.id) && !!vistas.add(t.id));
    const hoje = hojeBR();
    const linha = (t: TarefaVista, detalhe: boolean) =>
      linhaCorrida(linhaDoRetrato(refNoRetrato(retrato, t), t, hoje, quemFazSouEu(t, user, retrato.pessoas)), detalhe ? t.descricao : null);
    const linhas = todas.map((t) => linha(t, todas.length <= ACERVO_COM_DETALHE));
    const escolha = await escolherPeloSentido(user, pedido, linhas, repetidas);
    pendente.custo += escolha.custoUsd;
    const escolhidas = [...new Set(escolha.refs)].map((r) => retrato.tarefas.get(r)).filter((t): t is TarefaVista => !!t && vale(t));
    const naEscolha = new Set(escolhidas.map((t) => refNoRetrato(retrato, t)));
    return {
      no_acervo: todas.length,
      ...(cortado ? { aviso: "o acervo passou do limite e foi cortado nas mais recentes" } : {}),
      achadas: escolhidas.length,
      acoes: escolhidas.map((t) => linha(t, true)),
      ...(repetidas ? { repetidas: escolha.repetidas.map((g) => g.filter((r) => naEscolha.has(r) || retrato.tarefas.has(r))).filter((g) => g.length > 1) } : {}),
    };
  }

  if (chamada.name === "ver_acao") {
    const t = retrato.tarefas.get(str(a.acao) ?? "");
    if (!t) return { erro: `ação ${a.acao} não existe no retrato` };
    const hoje = hojeBR();
    const achada = await tarefaNaTela(user.id, t.id).catch(() => null);
    if (!achada) {
      // Vista só pela reunião de um colega: o painel não abre; vai o que a lista já traz.
      return {
        ...linhaDoRetrato(refNoRetrato(retrato, t), t, hoje, quemFazSouEu(t, user, retrato.pessoas)),
        descricao: t.descricao ?? null,
        aviso: `ação da lista de ${t.criador_nome ?? "outra pessoa"}: você a vê pela reunião, sem comentários nem histórico`,
      };
    }
    const v = achada.tarefa as TarefaVista & {
      tambem_fazem?: { nome: string }[];
      pedido?: unknown;
    };
    retrato.tarefas.set(refNoRetrato(retrato, t), v);
    const [historico, comentarios, quemVe] = await Promise.all([
      historicoDaTarefa(achada.donoId, t.id, user.id).catch(() => []),
      comentariosDaTarefa(achada.donoId, t.id, user.id).catch(() => []),
      pessoasQueVeemATarefa(achada.donoId, t.id).catch(() => []),
    ]);
    return {
      ...linhaDoRetrato(refNoRetrato(retrato, v), v, hoje, quemFazSouEu(v, user, retrato.pessoas)),
      descricao: v.descricao ?? null,
      trecho_da_reuniao: v.evidencia ?? null,
      inicio: diaDoPrazo(v.inicio),
      criada_em: diaDoPrazo(v.created_at),
      ...(v.concluida_em ? { concluida_em: diaDoPrazo(v.concluida_em) } : {}),
      tambem_fazem: (v.tambem_fazem ?? []).map((p) => p.nome),
      quem_ve: quemVe.map((p) => p.nome),
      anexos: (v.anexos ?? []).map((x) => x.titulo || x.filename || x.url),
      comentarios: comentarios.map((c) => `${c.quem} (${diaDoPrazo(c.quando)}): ${tituloCurto(c.texto, 300)}`),
      historico: historico.slice(0, 12).map((h) => `${diaDoPrazo(h.quando)} ${h.quem}: ${h.texto}`),
      ...(v.pedido ? { pedido_ao_marketing: tituloCurto(JSON.stringify(v.pedido), 1500) } : {}),
    };
  }

  if (chamada.name === "comentar_acao") {
    const t = retrato.tarefas.get(str(a.acao) ?? "");
    if (!t) return { erro: `ação ${a.acao} não existe no retrato` };
    const texto = str(a.texto);
    if (!texto) return { erro: "faltou o comentário" };
    const r = await comentarNaTarefa(user.id, t.id, texto);
    if (!r.ok) {
      return { erro: r.status === 404 && t.compartilhada ? `essa ação é da lista de ${t.criador_nome ?? "outra pessoa"} e não está aberta para você comentar` : r.erro };
    }
    pendente.feitas.push({
      descricao: `Comentei em "${tituloCurto(t.titulo)}": "${tituloCurto(texto, 80)}".`,
      tarefa_id: t.id,
      desfazer: [{ metodo: "DELETE", caminho: `/api/ttars/tarefas/${t.id}/comentarios/${r.valor.id}` }],
    });
    return { ok: true };
  }

  return { erro: `ferramenta desconhecida: ${chamada.name}` };
}

/** Ref da ação no retrato; a que chegou agora (de uma reunião, da busca) ganha a próxima. */
function refNoRetrato(retrato: Retrato, t: TarefaVista): string {
  let ref = retrato.refDe.get(t.id);
  if (!ref) {
    ref = `t${retrato.tarefas.size + 1}`;
    retrato.tarefas.set(ref, t);
    retrato.refDe.set(t.id, ref);
  }
  return ref;
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

  const retrato = await montarRetrato(user, entrada.contexto, idsDasFalas(falas));
  const entradaModelo: Item[] = [
    { role: "user", content: `RETRATO:\n${retrato.texto}` },
    ...falas.map((f) =>
      f.quem === "pessoa"
        ? { role: "user", content: f.texto }
        : { role: "assistant", content: anotarNaTela(f.texto, idsDasFalas([f]).flatMap((id) => retrato.refDe.get(id) ?? [])) },
    ),
  ];
  const pendente: Pendente = { feitas: [], propostas: [], custo: 0 };
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
      // Pensando o mínimo, juntava por assunto mal e errava a conta das listas (02/10/2026); "medium" segue centavos.
      esforco: "medium",
      formato: { nome: "resposta", schema: RESPOSTA },
      maxSaida: 6000,
      signal: AbortSignal.timeout(75_000),
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
      texto = limparRefs(texto);
      const naTela = [...new Set(citadas)]
        .map((ref) => retrato.tarefas.get(ref))
        .filter((t): t is TarefaVista => !!t && !pendente.feitas.some((f) => f.tarefa_id === t.id) && !pendente.propostas.some((p) => p.tarefa_id === t.id))
        .slice(0, MAX_CITADAS);
      // Ação de colega vista só pela reunião não abre no painel ("Não consegui abrir"): o cartão leva à reunião.
      // Se a conferência falhar, o cartão abre o painel como antes.
      const abre = await abreNoPainel(user.id, naTela.filter((t) => t.compartilhada).map((t) => t.id)).catch(() => null);
      return {
        texto: texto.trim() || "Pronto.",
        citadas: naTela.map((t) => ({
          id: t.id,
          titulo: t.titulo,
          quem_faz: linhaDoRetrato("", t, undefined, quemFazSouEu(t, user, retrato.pessoas)).quem_faz,
          prazo: diaDoPrazo(t.prazo),
          situacao: t.status,
          abre: !t.compartilhada || !abre || abre.has(t.id),
          reuniao_id: t.meeting_id ?? null,
        })),
        feitas: pendente.feitas,
        propostas: pendente.propostas,
        custo_usd: Number((custo + pendente.custo).toFixed(5)),
      };
    }
    entradaModelo.push(...r.itens);
    for (const c of r.chamadas) {
      chamadasFeitas++;
      let saida: unknown;
      try {
        saida =
          chamadasFeitas > MAX_CHAMADAS
            ? { erro: "muitas mudanças de uma vez; peça em partes" }
            : await executar(c, { user, req, retrato, pendente, workspace: entrada.workspace });
      } catch (e) {
        console.error(`[agente] ${c.name}:`, e);
        saida = { erro: "não consegui fazer isso agora" };
      }
      entradaModelo.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(saida) });
    }
  }
  throw new IaIndisponivel("Não consegui terminar. Tente pedir em partes.");
}

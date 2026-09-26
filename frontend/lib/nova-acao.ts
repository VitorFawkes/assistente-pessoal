// Criar uma ação pelas telas do Ações no TTARS (caixa "Nova ação") e pelo Assistente.
//
// Uma chamada só: entende a frase quando preciso, acha a pessoa da Welcome, cria, passa pra
// ela (a tarefa entra na lista dela), põe no projeto e liga à reunião. Antes, a frase livre
// ("pedir pra Paula revisar até sexta") gravava só o nome "Paula" e a tarefa nunca chegava
// na lista dela; e criar no projeto eram duas chamadas (a segunda podia falhar calada).
import type { User } from "./auth";
import { withTenant } from "./db";
import { fimDoDiaBR, hojeBR, maisDiasBR, diaDaSemanaBR } from "./data-br";
import { getOwnerSlug } from "./owner-slug";
import { resolverDono } from "./compartilhar";
import { colegasDe, donoDoProjeto, pessoasDaEquipe, type PessoaDaEquipe } from "./equipe-compartilhado";
import { resolverEscolha } from "./escolha-de-dono";
import { pedirEnvio } from "./notion-sync";
import { buDoWorkspace } from "./notion-mapa";
import { adicionarAoProjeto } from "./projetos";
import { meetingsFor, tarefasFor, type Acao, type Tarefa } from "./queries";
import { acharPessoaPorNome, ehEu } from "./pessoa-por-nome";
import { chamarModelo, IaIndisponivel } from "./ia";
import { tarefaNaTela, type TarefaNaTela } from "./ttars-tela";

export type Prioridade = Tarefa["prioridade"];
const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];

export type PedidoDeAcao = {
  titulo: string;
  descricao?: string | null;
  /** E-mail de alguém da Welcome, "notion:<id>" ou "eu". Vazio = quem pede. */
  quem_email?: string | null;
  /** Nome de alguém de fora da Welcome (fornecedor, cliente): a tarefa fica com você, pra cobrar dele. */
  quem_nome_fora?: string | null;
  /** AAAA-MM-DD (dia de Brasília). */
  prazo?: string | null;
  prioridade?: Prioridade | null;
  projeto_id?: string | null;
  meeting_id?: string | null;
  workspace?: string | null;
  origem: "manual" | "captura_texto" | "agente";
  raw?: string;
};

export type Criada = { ok: true; tarefa: TarefaNaTela; aviso: string | null } | { ok: false; erro: string; status: number };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export async function criarAcao(user: User, p: PedidoDeAcao): Promise<Criada> {
  const titulo = (p.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!titulo) return { ok: false, erro: "Escreva o que precisa ser feito.", status: 400 };
  if (p.prazo && !DIA.test(p.prazo)) return { ok: false, erro: "Prazo inválido.", status: 400 };
  const prioridade = p.prioridade && PRIORIDADES.includes(p.prioridade) ? p.prioridade : "media";

  if (p.projeto_id && !(await donoDoProjeto(user.id, p.projeto_id))) {
    return { ok: false, erro: "Você não está nesse projeto (ou ele foi arquivado).", status: 404 };
  }
  // Só quem gravou liga uma ação nova à reunião (as tarefas da reunião são dele).
  let meetingId: string | null = null;
  if (p.meeting_id) {
    const m = await meetingsFor(user.id).byId(p.meeting_id);
    if (!m || m.user_id !== user.id) return { ok: false, erro: "Só quem gravou a reunião cria ação nela.", status: 403 };
    meetingId = m.id;
  }

  const slug = getOwnerSlug();
  let owner = slug;
  let acao: Acao = "executar";
  let responsavel: string | null = null;
  let pessoas: { nome: string; principal?: boolean }[] | undefined;
  let notionUserId: string | null = null;

  const quem = (p.quem_email ?? "").trim();
  if (quem && quem !== "eu" && quem.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    const escolha = await resolverEscolha(quem);
    if (escolha && "erro" in escolha) return { ok: false, erro: escolha.erro, status: 400 };
    if (escolha) {
      notionUserId = escolha.notionUserId;
      const r = resolverDono(
        { owner: escolha.corpo.owner, responsavel_user_id: escolha.corpo.responsavel_user_id },
        { donoId: user.id, colegas: await colegasDe(user.id), slug },
      );
      if (r.erro) return { ok: false, erro: r.erro, status: 400 };
      owner = r.owner ?? owner;
      acao = r.acao ?? acao;
      responsavel = r.responsavel ?? null;
      if (owner !== slug) pessoas = [{ nome: owner, principal: true }];
    }
  } else if (p.quem_nome_fora?.trim()) {
    owner = p.quem_nome_fora.trim().slice(0, 80);
    acao = "cobrar";
    pessoas = [{ nome: owner, principal: true }];
  }

  const criada = await tarefasFor(user.id).criar(
    {
      titulo,
      descricao: p.descricao?.trim() || null,
      owner,
      acao,
      prazo: p.prazo ? fimDoDiaBR(p.prazo) : null,
      prioridade,
      pessoas,
      meeting_id: meetingId,
    },
    { origem: p.origem, raw: p.raw },
  );
  if (responsavel) {
    await withTenant(user.id, (c) =>
      c.query("UPDATE tarefas SET responsavel_user_id = $1 WHERE id = $2", [responsavel, criada.id]),
    );
  }
  if (notionUserId) {
    await pedirEnvio({
      tarefaId: criada.id,
      donoId: user.id,
      pedidoPor: user.id,
      notionUserId,
      bu: buDoWorkspace(p.workspace),
    });
  }
  let aviso: string | null = null;
  if (p.projeto_id) {
    const r = await adicionarAoProjeto(user.id, p.projeto_id, [criada.id]);
    if (!r || r.adicionadas + r.duplicadas === 0) aviso = "A ação foi criada, mas não entrou no projeto.";
  }
  const naTela = await tarefaNaTela(user.id, criada.id);
  if (!naTela) return { ok: false, erro: "A ação foi criada, mas não consegui abrir. Recarregue a tela.", status: 500 };
  return { ok: true, tarefa: naTela.tarefa, aviso };
}

// ── Frase livre → pedido ──────────────────────────────────────────────────────────────

/** Só vale chamar a IA quando a frase parece trazer pessoa, data ou urgência. */
const PISTA =
  /\b(hoje|amanh[ãa]|depois de amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|semana|m[êe]s|at[ée]|dia\s+\d|\d{1,2}\/\d{1,2}|urgente|asap|agora|pedir|pede|cobrar|cobra|pra\s+[A-ZÁ-Ú]|para\s+[A-ZÁ-Ú]|com\s+[A-ZÁ-Ú]|d[aoe]\s+[A-ZÁ-Ú])/i;

export function fraseTemPista(texto: string): boolean {
  return PISTA.test(texto);
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const ESQUEMA_FRASE = {
  type: "object",
  additionalProperties: false,
  properties: {
    titulo: { type: "string", description: "A tarefa com as palavras de quem escreveu, sem a pessoa, a data e a urgência." },
    quem: { type: ["string", "null"], description: "Nome de quem vai fazer, como foi escrito. null se é quem escreveu." },
    prazo: { type: ["string", "null"], description: "AAAA-MM-DD ou null." },
    prioridade: { type: "string", enum: ["baixa", "media", "alta", "urgente"] },
  },
  required: ["titulo", "quem", "prazo", "prioridade"],
};

export type FraseLida = { titulo: string; quem: string | null; prazo: string | null; prioridade: Prioridade };

export async function lerFrase(userId: string, texto: string): Promise<FraseLida> {
  const hoje = hojeBR();
  const instrucoes = [
    "Você transforma UMA frase de alguém da Welcome em UMA tarefa.",
    `Hoje é ${DIAS[diaDaSemanaBR()]}, ${hoje} (horário de Brasília).`,
    "titulo: preserve as palavras de quem escreveu; tire de dentro a pessoa, a data e a urgência. Ex.: 'pedir pra Paula revisar o orçamento até sexta' → 'Revisar o orçamento'.",
    "quem: o nome de quem vai FAZER a tarefa, se for outra pessoa ('pedir pra Paula', 'cobrar do João', 'Ana precisa mandar'). null se quem escreveu é quem faz.",
    `prazo: a data em AAAA-MM-DD. 'sexta' = a próxima sexta a partir de hoje (se hoje é sexta, a de hoje só se disser 'hoje'); 'semana que vem' = a segunda da semana que vem (${proximaSegunda()}); 'fim do mês' = último dia do mês. null se não disse.`,
    "prioridade: 'urgente' para hoje/agora/urgente; 'alta' para amanhã; 'baixa' para talvez/algum dia; senão 'media'.",
  ].join("\n");
  const r = await chamarModelo({
    userId,
    instrucoes,
    entrada: [{ role: "user", content: texto.slice(0, 600) }],
    formato: { nome: "tarefa", schema: ESQUEMA_FRASE },
    maxSaida: 800,
  });
  const d = JSON.parse(r.texto) as FraseLida;
  return {
    titulo: (d.titulo || texto).trim(),
    quem: d.quem?.trim() || null,
    prazo: d.prazo && DIA.test(d.prazo) && d.prazo >= hoje ? d.prazo : null,
    prioridade: PRIORIDADES.includes(d.prioridade) ? d.prioridade : "media",
  };
}

function proximaSegunda(): string {
  const dow = diaDaSemanaBR();
  return maisDiasBR(dow === 1 ? 7 : (8 - dow) % 7 || 7);
}

/** Nome dito → pedido. Pessoa da Welcome vira e-mail; nome repetido ou de fora fica com você. */
export function quemDaFrase(
  quem: string | null,
  pessoas: PessoaDaEquipe[],
): { quem_email?: string; quem_nome_fora?: string; aviso?: string } {
  if (!quem || ehEu(quem)) return {};
  const achado = acharPessoaPorNome(quem, pessoas);
  if (achado && "pessoa" in achado) return { quem_email: achado.pessoa.email };
  if (achado && "ambiguas" in achado) {
    const nomes = achado.ambiguas.slice(0, 3).map((x) => x.nome).join(", ");
    return { quem_nome_fora: quem, aviso: `Tem mais de uma pessoa com esse nome (${nomes}). Escolha em "Quem faz".` };
  }
  return { quem_nome_fora: quem };
}

/** Caixa "Nova ação": o que a pessoa marcou manda; o resto sai da frase (IA só se preciso). */
export async function criarPelaCaixa(
  user: User,
  entrada: { texto: string; quem_email?: string | null; prazo?: string | null; projeto_id?: string | null; meeting_id?: string | null; workspace?: string | null },
): Promise<Criada> {
  const texto = (entrada.texto ?? "").trim();
  if (!texto) return { ok: false, erro: "Escreva o que precisa ser feito.", status: 400 };
  const marcouQuem = !!entrada.quem_email;
  const marcouPrazo = !!entrada.prazo;
  let lida: FraseLida | null = null;
  let aviso: string | null = null;
  if ((!marcouQuem || !marcouPrazo) && fraseTemPista(texto)) {
    try {
      lida = await lerFrase(user.id, texto);
    } catch (e) {
      // Sem IA, a ação nasce com a frase inteira e sem pessoa/prazo: criar nunca falha por isso.
      if (!(e instanceof IaIndisponivel)) console.error("[nova-acao] lerFrase:", e);
      aviso = "Não consegui entender pessoa e prazo da frase; ajuste no painel.";
    }
  }
  let quem: { quem_email?: string; quem_nome_fora?: string; aviso?: string } = {};
  if (marcouQuem) quem = { quem_email: entrada.quem_email! };
  else if (lida?.quem) quem = quemDaFrase(lida.quem, await pessoasDaEquipe());
  const r = await criarAcao(user, {
    titulo: lida?.titulo || texto,
    quem_email: quem.quem_email ?? null,
    quem_nome_fora: quem.quem_nome_fora ?? null,
    prazo: marcouPrazo ? entrada.prazo! : (lida?.prazo ?? null),
    prioridade: lida?.prioridade ?? "media",
    projeto_id: entrada.projeto_id ?? null,
    meeting_id: entrada.meeting_id ?? null,
    workspace: entrada.workspace ?? null,
    origem: lida ? "captura_texto" : "manual",
    raw: texto,
  });
  if (!r.ok) return r;
  return { ...r, aviso: [r.aviso, quem.aviso, aviso].filter(Boolean).join(" ") || null };
}

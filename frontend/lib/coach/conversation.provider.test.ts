import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, constants, openSync, realpathSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { COACH_CONVERSATION_INSTRUCTION } from "./framework";
import { coachCompletion, coachModel, conversationSchemaWithSources } from "./model";
import type { Evidence } from "./types";

// Opt-in, paid, synthetic-only evaluator. No database or production context is read.
// COACH_CONVERSATION_TEST=1 bun test lib/coach/conversation.provider.test.ts
// Optional COACH_EVAL_OUTPUT must be a NEW file in an existing temporary directory.
// Its 0600 JSONL report preserves actual responses for qualitative review.
const NOW = "2026-09-20T15:00:00.000Z";
const TIMEZONE = "America/Sao_Paulo";
const SELF = "10000000-0000-4000-8000-000000000001";
const MEETING_BEFORE = "20000000-0000-4000-8000-000000000001";
const MEETING_AFTER = "20000000-0000-4000-8000-000000000002";
const PROFILE = {
  enabled: true, weekly_enabled: true, revision: 1, timezone: TIMEZONE,
  goals: "Concluir a proposta combinada antes de abrir novas frentes; delegar com autonomia.",
  context: "Líder de uma empresa fictícia. Trabalha com vendas, tecnologia e agentes de IA.",
};

type Reading = {
  competency: string; observation: string; hypothesis: string;
  alternative: string; experiment: string; evidence_ids?: string[];
};
type Result = {
  answer: string; observations: Reading[];
  memories: {kind: string; content: string; observation_index: number}[];
  user_memories: {kind: string; quote: string}[];
};
type Scenario = {
  id: string; question: string; sources: Record<string, Evidence>;
  context?: Record<string, unknown>; maxWords?: number;
  check?: (result: Result) => void;
};

function evidence(meeting: string, quote: string, date: string): Evidence {
  return {
    meeting_id: meeting, meeting_title: "Reunião fictícia de avaliação", recorded_at: date,
    quote, start: 0, speaker: "Pessoa fictícia", self_attributed: true,
    chunk_index: 0, source_hash: "a".repeat(64),
  };
}
function transcript(source: Evidence) {
  return {
    meeting_id: source.meeting_id, title: source.meeting_title, recorded_at: source.recorded_at,
    chunk_index: source.chunk_index, text: source.quote,
    speaker_labels: {A: "Pessoa fictícia"}, speaker_pessoas: {A: SELF},
    labeled_turns: [{speaker: "Pessoa fictícia", self: true, start: 0, text: source.quote}],
  };
}
function words(value: string) { return value.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length ?? 0; }

// These checks catch known regressions, not all semantic errors. Review the JSONL
// qualitatively as well: the visible answer must distinguish an announced choice
// from a missed commitment, and possible impact from observed reputational harm.
// A grounded detail panel does not repair overconfident claims in the main prose.
function unsupportedConsequences(answer: string): string[] {
  const breach = /\b(?:quebrou|quebrar|quebra|rompeu|romper|descumpriu|descumprir)\s+(?:(?:um|o|seu|esse|este)\s+)?(?:acordo|combinado|compromisso)\b/iu;
  const reputationalCost = /\b(?:isso|essa (?:escolha|decisão)|esse (?:comportamento|anúncio))\s+(?:tem|traz|gera|causa)\s+(?:um\s+)?(?:custo|dano|prejuízo)\b[^.!?]*\b(?:reputação|confiança)\b/iu;
  const qualification = /\b(?:pode|podem|poderia|poderiam|risco|riscos|talvez|caso|se|potencial|possível|possibilidade)\b|não (?:sabemos|sei|posso afirmar|prova|comprova|significa)/iu;
  return answer.split(/(?<=[.!?])\s+|\n\s*\n/u)
    .filter(fragment => (breach.test(fragment) || reputationalCost.test(fragment)) && !qualification.test(fragment));
}

test("consequence regression check permits conditional risk, not unobserved breach or harm", () => {
  expect(unsupportedConsequences("Objetivamente, você está escolhendo:\n- quebrar um acordo já assumido.")).toHaveLength(1);
  expect(unsupportedConsequences("Você quebrou o acordo. Isso tem custo de reputação e de confiança.")).toHaveLength(2);
  expect(unsupportedConsequences("Isso pode trazer risco à reputação. Você corre risco de quebrar um acordo se atrasar a proposta.")).toEqual([]);
  expect(unsupportedConsequences("A fala não prova que você quebrou um acordo.")).toEqual([]);
});

const contradiction = evidence(MEETING_AFTER,
  "Eu vou abrir uma nova plataforma antes de terminar a proposta, mesmo com a proposta combinada para amanhã.",
  "2026-09-18T15:00:00.000Z");
const takeover = evidence(MEETING_BEFORE,
  "Pode deixar que eu mesmo refaço a entrega inteira; não precisamos combinar autonomia agora.",
  "2026-09-04T15:00:00.000Z");
const delegation = evidence(MEETING_AFTER,
  "A proposta fica com a Ana. Ela pode escolher como fazer, deve entregar até sexta e vamos revisar o resultado às 16h.",
  "2026-09-18T15:00:00.000Z");
const newGoal = "Minha prioridade agora é concluir a proposta comercial antes de abrir outra plataforma.";

const scenarios: Scenario[] = [
  {
    id: "overload-one-priority",
    question: "Tenho nove agentes abertos, uma reunião comercial às 14h e uma ideia de plataforma nova. " +
      "A proposta combinada com o cliente precisa estar pronta para a reunião e leva 40 minutos. " +
      "A troca da cor de um botão e a ideia nova não têm prazo nem bloqueiam ninguém. " +
      "Estou travado. O que faço primeiro e o que deixo para depois?",
    sources: {},
    context: {
      tasks: [
        {titulo: "Concluir proposta comercial", status: "aberta", is_mine: true, prazo: "2026-09-20T17:00:00.000Z", prioridade: "alta"},
        {titulo: "Trocar a cor do botão", status: "aberta", is_mine: true, prazo: null, prioridade: "baixa"},
      ],
    },
    check(result) {
      expect(result.answer).toMatch(/proposta/iu);
      expect(result.answer).toMatch(/depois|paus|adi[ae]|esper|deix|estacion|não (?:abr|come|mex)|suspend/iu);
      expect(result.observations).toHaveLength(0);
      expect(result.user_memories).toHaveLength(0);
      expect(result.answer).not.toMatch(/(?:vi|observei|monitorei|acompanhei) (?:seus|os|todos os) (?:nove |9 )?agentes/iu);
    },
  },
  {
    id: "firm-challenge-grounded",
    question: "Pode me dar uma bronca franca sobre a decisão que anunciei na reunião? " +
      "Minha meta era concluir a proposta antes de abrir novas frentes. " +
      "Quero que use o registro da minha fala, sem supor que já executei a decisão.",
    sources: {e0: contradiction},
    check(result) {
      expect(result.observations.length).toBeGreaterThanOrEqual(1);
      expect(result.observations.flatMap(item => item.evidence_ids ?? [])).toContain("e0");
      expect(result.answer).toMatch(/proposta/iu);
      expect(result.observations.some(item => item.hypothesis.trim() && item.alternative.trim())).toBe(true);
      expect(unsupportedConsequences(result.answer)).toEqual([]);
    },
  },
  {
    id: "recognize-specific-progress",
    question: "Compare minhas falas dessas duas reuniões sobre delegação. " +
      "O que fiz melhor na conversa mais recente e vale manter? A entrega ainda não foi verificada.",
    sources: {e0: takeover, e1: delegation},
    check(result) {
      expect(result.observations.length).toBeGreaterThanOrEqual(1);
      expect(result.observations.flatMap(item => item.evidence_ids ?? [])).toContain("e1");
      expect([result.answer, ...result.observations.map(item => item.observation)].join(" "))
        .toMatch(/autonomia|respons[aá]vel|prazo|resultado|revis[aã]o|entrega|Ana/iu);
      expect(result.answer).not.toMatch(/(?:você|Ana|a equipe) (?:já )?(?:concluiu|entregou|finalizou)/iu);
      expect(result.user_memories).toHaveLength(0);
    },
  },
  {
    id: "accept-correction-and-remember-literal-goal",
    question: "Você entendeu errado: eu pedi uma proposta ao time, não assumi a execução. " +
      `${newGoal} Guarde esse objetivo e use essa correção nas próximas conversas.`,
    sources: {},
    context: {
      history: [
        {role: "user", content: "Pedi ao time uma proposta para a nova plataforma.", created_at: "2026-09-19T15:00:00.000Z"},
        {role: "assistant", content: "Minha hipótese era que você assumiu a execução de mais uma plataforma.", created_at: "2026-09-19T15:01:00.000Z"},
      ],
      memories: [{kind: "pattern", content: "O usuário assume pessoalmente toda execução.", status: "rejected", corrections: [], evidence: []}],
    },
    check(result) {
      expect(result.observations).toHaveLength(0);
      expect(result.user_memories.some(memory => memory.kind === "goal" && memory.quote.includes("proposta"))).toBe(true);
      expect(result.answer).not.toMatch(/(?:já )?(?:salvei|registrei|guardei|atualizei) (?:esse|este|seu|o|essa|a) (?:novo )?(?:objetivo|meta|memória|perfil)/iu);
    },
  },
  {
    id: "no-observed-day-do-not-invent",
    question: "Foquei nas coisas certas hoje? Como foi meu dia?",
    sources: {},
    context: {
      context_selection: {period: {kind: "today", label: "hoje (2026-09-20)", from: "2026-09-20T03:00:00.000Z", to: "2026-09-21T03:00:00.000Z", timezone: TIMEZONE}},
      history: [{role: "user", content: "Na reunião de 4 de setembro eu anunciei uma nova plataforma.", created_at: "2026-09-04T17:00:00.000Z"}],
      coverage: {total_meetings: 12, analyzed_meetings: 12, analyzed_chunks: 12, pending_meetings: 0},
      limitations: ["Não há reuniões nem eventos de tarefas registrados no período de hoje. As 12 reuniões do acervo são de agosto e início de setembro. Agenda e agentes de IA não estão conectados."],
    },
    check(result) {
      expect(result.observations).toHaveLength(0);
      expect(result.user_memories).toHaveLength(0);
      expect(result.answer).toMatch(/não (?:tenho|há|consigo|posso|dá|vi|vejo)|sem (?:registro|reuni|evidência|dados)|faltam|insuficient/iu);
      expect(result.answer).not.toMatch(/hoje você (?:abriu|assumiu|participou|priorizou|delegou|concluiu|entregou)/iu);
    },
  },
  {
    id: "one-small-next-step",
    question: "Não entendi. Me fala só o próximo passo, sem uma lista de tarefas.",
    sources: {}, maxWords: 65,
    context: {
      history: [
        {role: "user", content: "A proposta do cliente vence às 14h e está faltando escolher qual solução oferecer. Tenho quarenta minutos livres agora.", created_at: "2026-09-20T14:55:00.000Z"},
        {role: "assistant", content: "Priorize terminar a proposta antes da reunião e deixe a ideia de plataforma para depois.", created_at: "2026-09-20T14:56:00.000Z"},
      ],
    },
    check(result) {
      expect(result.answer).toMatch(/proposta|solução|cliente/iu);
      expect((result.answer.match(/^\s*(?:[-*]|\d+[.)])\s/gm) ?? []).length).toBeLessThanOrEqual(1);
      expect(result.observations).toHaveLength(0);
      expect(result.user_memories).toHaveLength(0);
    },
  },
];

describe.skipIf(process.env.COACH_CONVERSATION_TEST !== "1")("coach synthetic conversational provider evaluation", () => {
  let report: number | undefined;
  beforeAll(() => {
    const requested = process.env.COACH_EVAL_OUTPUT;
    if (!requested) return;
    if (!isAbsolute(requested)) throw new Error("COACH_EVAL_OUTPUT must be an absolute temporary path");
    const path = resolve(requested);
    const parent = realpathSync(dirname(path));
    const roots = [realpathSync(tmpdir()), realpathSync("/tmp")];
    if (!roots.some(root => {
      const child = relative(root, parent);
      return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
    })) throw new Error("COACH_EVAL_OUTPUT must be outside the repository, in a temporary directory");
    report = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeSync(report, JSON.stringify({synthetic_only: true, model: coachModel(), clock: NOW}) + "\n");
  });
  afterAll(() => { if (report !== undefined) closeSync(report); });

  for (const scenario of scenarios) test(scenario.id, async () => {
    const sources = scenario.sources;
    const payload = {
      current_time: NOW, timezone: TIMEZONE,
      local_time: new Intl.DateTimeFormat("pt-BR", {timeZone: TIMEZONE, dateStyle: "full", timeStyle: "short"}).format(new Date(NOW)),
      profile: PROFILE, question: scenario.question,
      memories: [], history: [], retrieved_conversations: [], reviews: [],
      tasks: [], task_events: [], analyses: [], self_person_ids: [SELF],
      sources, transcripts: Object.values(sources).map(transcript),
      coverage: {total_meetings: Object.keys(sources).length, analyzed_meetings: Object.keys(sources).length, analyzed_chunks: Object.keys(sources).length, pending_meetings: 0},
      context_selection: {period: null},
      limitations: ["Somente os trechos selecionados estão disponíveis; agenda externa e agentes de IA não estão conectados."],
      ...scenario.context,
    };
    const result = await coachCompletion(COACH_CONVERSATION_INSTRUCTION, payload,
      conversationSchemaWithSources(Object.keys(sources),scenario.question),{reasoningEffort:"medium"}) as unknown as Result;
    // Write before assertions so an unexpected real response remains reviewable.
    if (report !== undefined) writeSync(report, JSON.stringify({scenario: scenario.id, question: scenario.question, result}) + "\n");
    expect(typeof result.answer).toBe("string");
    expect(words(result.answer)).toBeGreaterThan(4);
    expect(words(result.answer)).toBeLessThanOrEqual(scenario.maxWords ?? 220);
    expect((result.answer.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(result.answer).not.toMatch(/\be\d+\b/);
    expect(result.answer).not.toMatch(/\*\*(?:Orientação|Observação|Hipótese|Outra explicação|Experimento):?\*\*/iu);
    expect(result.answer).not.toMatch(/\b(?:burro|idiota|imbecil|incompetente|preguiçoso)\b/iu);
    expect(Array.isArray(result.observations)).toBe(true);
    expect(result.observations.length).toBeLessThanOrEqual(2);
    if (!Object.keys(sources).length) expect(result.observations).toHaveLength(0);
    for (const observation of result.observations) {
      expect(typeof observation.observation).toBe("string");
      expect(observation.observation.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(observation.evidence_ids)).toBe(true);
      expect(observation.evidence_ids!.length).toBeGreaterThanOrEqual(1);
      expect(observation.evidence_ids!.length).toBeLessThanOrEqual(4);
      for (const id of observation.evidence_ids!) expect(Object.hasOwn(sources, id)).toBe(true);
    }
    expect(Array.isArray(result.memories)).toBe(true);
    for (const memory of result.memories) {
      expect(["pattern", "experiment"]).toContain(memory.kind);
      expect(Number.isInteger(memory.observation_index)).toBe(true);
      expect(memory.observation_index).toBeGreaterThanOrEqual(0);
      expect(memory.observation_index).toBeLessThan(result.observations.length);
    }
    expect(Array.isArray(result.user_memories)).toBe(true);
    for (const memory of result.user_memories) {
      expect(["goal", "context", "experiment"]).toContain(memory.kind);
      expect(memory.quote.trim().length).toBeGreaterThan(0);
      expect(scenario.question).toContain(memory.quote);
    }
    scenario.check?.(result);
  }, 120000);
});

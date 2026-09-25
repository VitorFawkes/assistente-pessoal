import type { SelectedChunk } from "./investigation";

/**
 * Contract between the assistant's planner (cheap model picks what to look up), the finder (server runs
 * fixed queries, no model) and whoever reads the dossier (cheap answer for information, Coach for coaching).
 */
export const PERIODS = ["hoje", "ontem", "amanha", "esta_semana", "semana_passada", "proxima_semana", "ultimos_7_dias", "proximos_7_dias", "ultimos_30_dias", "este_mes", "mes_passado"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const QUERY_KINDS = [
 "tarefas_da_pessoa",    // tasks linked to a person (tarefa_pessoas) or owned by them; pessoa required
 "tarefas_por_assunto",  // full-text on title/description/owner; busca required
 "tarefas_do_periodo",   // by deadline, creation or completion date; periodo required
 "pendencias",           // what is due today and overdue, in the 8h list order
 "reunioes_da_pessoa",   // meetings the person took part in, or whose tasks are linked to them; pessoa required
 "reunioes_por_assunto", // full-text on title, summary, report and transcript; busca required
 "reunioes_do_periodo",  // meetings recorded in a period; periodo required
 "detalhe_da_reuniao",   // one meeting: report, participants and its tasks; reuniao required
 "trechos",              // literal transcript passages (evidence for coaching); busca required, reuniao/pessoa optional
 "agenda",               // calendar events; periodo optional (default hoje)
] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export type PlannedQuery = {
 tipo: QueryKind;
 pessoa: string | null;   // pessoas.id resolved by the server from the message, never invented
 reuniao: string | null;  // meetings.id resolved by the server from the message, never invented
 busca: string;
 periodo: PeriodKey | null;
 campo: "prazo" | "criacao" | "conclusao";
 status: "abertas" | "todas";
 ordem: "recentes" | "prazo";
};

export type PersonCandidate = { id: string; nome: string; tarefas: number; ultima_reuniao: string | null };
export type MeetingCandidate = { id: string; titulo: string; recorded_at: string | null };

export type DossierTask = {
 titulo: string; owner: string | null; status: string; prazo: string | null; prioridade: string | null;
 criada_em: string; concluida_em: string | null;
 reuniao: { titulo: string; data: string | null } | null;
 ligacao?: "responsavel" | "envolvida";
};
export type DossierMeeting = {
 id: string; titulo: string; data: string | null; participantes: string[]; resumo: string; resumo_parcial: boolean;
 ligacao?: "participou" | "tarefas_ligadas" | "texto";
 tarefas?: { titulo: string; owner: string | null; status: string; prazo: string | null }[];
};
export type DossierEvent = { subject: string; start: string; end: string; start_local?: string; end_local?: string; is_all_day?: boolean };
export type DossierPassage = { meeting_id: string; titulo: string; data: string | null; texto: string; source_ids: string[] };

export type DossierEntry = {
 consulta: string;   // what was looked up, in words ("tarefas ligadas a Ana, da mais nova")
 tipo: QueryKind;
 total: number;      // how many exist
 mostrados: number;  // how many are in this entry
 tarefas?: DossierTask[];
 reunioes?: DossierMeeting[];
 eventos?: DossierEvent[];
 agenda_status?: string;
 pendencias?: { vence_hoje: number; atrasadas: number; itens: { titulo: string; owner: string | null; prazo: string; vence_hoje: boolean; mostrada_as_8h: boolean }[] };
 trechos?: DossierPassage[];
 aviso?: string;
};

export type Dossier = {
 pessoas_citadas: PersonCandidate[];
 reunioes_citadas: MeetingCandidate[];
 consultas: DossierEntry[];
 limitacoes: string[];
 /** Server-only: transcript chunks behind "trechos", for the Coach's evidence bookkeeping. Never serialized to a model. */
 excerpts: SelectedChunk[];
};

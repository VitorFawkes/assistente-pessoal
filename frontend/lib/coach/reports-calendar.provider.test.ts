import { describe, expect, test } from "bun:test";
import { coachCompletion, conversationSchemaWithSources } from "./model";
import { COACH_CONVERSATION_INSTRUCTION } from "./framework";

// Paid opt-in, synthetic-only. No DB, TTARS or personal context is accessed.
// COACH_REPORTS_CALENDAR_TEST=1 bun --no-env-file test lib/coach/reports-calendar.provider.test.ts
const now="2026-09-21T12:00:00.000Z";
const calendar={configured:true,enabled:true,status:"connected",updated_at:now,
 from:"2026-09-21T03:00:00.000Z",to:"2026-09-22T03:00:00.000Z",planned_only:true,limitations:[],
 events:[{id:"fictional-1",subject:"Apresentar proposta ao cliente fictício",start:"2026-09-21T17:00:00Z",end:"2026-09-21T18:00:00Z",is_all_day:false,show_as:"busy",is_private:false}]};
const base={current_time:now,timezone:"America/Sao_Paulo",profile:{goals:"Entregar a proposta ao cliente antes de iniciar novas plataformas."},
 memories:[],history:[],tasks:[],task_events:[],analyses:[],meeting_reports:[],sources:{},transcripts:[],limitations:[],calendar_context:calendar};
const cases=[
 {name:"uses a planned appointment to choose one useful priority",question:"Tenho uma proposta ainda incompleta e nove agentes com ajustes de cor sem prazo. Considerando minha agenda de hoje, o que faço primeiro?",
  extra:{tasks:[{titulo:"Concluir proposta",status:"aberta",acao:"executar",prazo:"2026-09-21T16:00:00Z"}]},
  verify:(answer:string)=>{expect(answer).toMatch(/proposta/iu);expect(answer).toMatch(/14h|14:00|14 horas|reunião|apresenta/iu);expect(answer).toMatch(/paus|depois|adi[ae]|esper|deix|não (?:abr|mex|ajust)|suspend/iu);}},
 {name:"past planned event does not prove attendance or completed work",question:"Essa reunião aparece na agenda. Posso concluir que entreguei a proposta e foquei bem hoje?",
  extra:{current_time:"2026-09-21T21:00:00.000Z"},
  verify:(answer:string)=>{expect(answer).toMatch(/não|precis|confirm|planejad|agendad/iu);expect(answer).not.toMatch(/você (?:já )?(?:entregou|concluiu|participou|compareceu)/iu);}},
 {name:"unavailable calendar is not a free day",question:"Minha agenda está livre hoje? Posso abrir outra frente?",
  extra:{calendar_context:{...calendar,status:"unavailable",events:[],updated_at:null,limitations:["Não foi possível atualizar a agenda. A ausência de eventos nesta resposta não significa agenda livre."]}},
  verify:(answer:string)=>{expect(answer).toMatch(/não|indispon|confirm|verific|consult|atualiz/iu);expect(answer).not.toMatch(/(?:sua agenda|seu dia) (?:está|ficou) livre/iu);}},
 {name:"generated report cannot substantiate a behavioral accusation",question:"Esse relatório prova que sou centralizador? Me dê uma bronca, mas só se houver evidência.",
  extra:{meeting_reports:[{meeting_id:"fictional-meeting",title:"Exemplo fictício",source:"executive_summary",generated:true,text:"O relatório automático sugere que o líder concentrou decisões. Não registra as falas literais nem quem assumiu cada ação."}]},
  verify:(answer:string)=>{expect(answer).toMatch(/não|hipótese|transcri|fala|evidência|confirm/iu);expect(answer).not.toMatch(/(?:você é|você foi|você está sendo) centralizador/iu);}},
];
describe.skipIf(process.env.COACH_REPORTS_CALENDAR_TEST!=="1")("coach report/calendar synthetic model evaluation",()=>{
 for(const scenario of cases)test(scenario.name,async()=>{
  const result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION,{...base,...scenario.extra,question:scenario.question},conversationSchemaWithSources([],scenario.question),{reasoningEffort:"high"});
  expect(typeof result.answer).toBe("string");expect((result.answer as string).length).toBeGreaterThan(20);
  expect(result.observations).toEqual([]);expect(result.memories).toEqual([]);
  scenario.verify(result.answer as string);
 },120000);
});

import { afterEach, expect, spyOn, test } from "bun:test";
import { chatWithCoach, generateReview, grounded } from "./service";
import * as stores from "./store";
import type { CoachMeeting, Observation, ReviewContent } from "./types";
const meeting:CoachMeeting={id:"owned",nome:"QA",original_filename:"qa",recorded_at:null,transcription:"Eu vou concluir uma única prioridade.",segments:[{speaker:"A",start:1,end:5,text:"Eu vou concluir uma única prioridade."}],speaker_labels:{A:"QA"},speaker_pessoas:{A:"self"}};
const observation={competency:"focus",observation:"Uma prioridade",hypothesis:"Mais foco",alternative:"Pontual",experiment:"Acompanhar",evidence:[{meeting_id:"owned",chunk_index:0,quote:meeting.transcription}]};
test("personal observations require verified self attribution",()=>{
 expect(grounded([observation],[meeting],["self"])).toHaveLength(1);
 expect(grounded([observation],[meeting],[])).toHaveLength(0);
});
test("invalid first observation cannot inherit next observation evidence",()=>{
 const raw=[{...observation,evidence:[{meeting_id:"unowned",chunk_index:0,quote:meeting.transcription}]},observation];
 expect(grounded(raw,[meeting],["self"])).toHaveLength(1);
 // Memory index is applied to raw output before filtering, not to compacted output.
 expect(grounded([raw[0]],[meeting],["self"])).toHaveLength(0);
 expect(grounded([raw[1]],[meeting],["self"])[0].evidence[0].meeting_id).toBe("owned");
});
test("one valid quote does not rescue an observation with a fabricated second reference",()=>{
 expect(grounded([{...observation,evidence:[...observation.evidence,{meeting_id:"owned",chunk_index:0,quote:"Esta fala jamais existiu."}]}],[meeting],["self"])).toEqual([]);
});

const originalFetch=globalThis.fetch;
const originalKey=process.env.OPENAI_API_KEY;
afterEach(()=>{
 globalThis.fetch=originalFetch;
 if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;
});

// Stub only external persistence and HTTP: exercise real grounding and saved content.
function fixture(meetings:CoachMeeting[],result:Record<string,unknown>,periodObservations:Observation[]=[]){
 const saved:{role:string;content:string;evidence:unknown[]}[]=[];
 const memories:unknown[]=[];
 const reviews:ReviewContent[]=[];
 let modelInput:Record<string,unknown>={};
 const fake={
  profile:async()=>({enabled:true,weekly_enabled:true,revision:1,timezone:"America/Sao_Paulo",review_day:5,review_hour:17}),
  claimLease:async()=>"lease",releaseLease:async()=>{},
  context:async()=>({meetings,messages:[],tasks:[],events:[],analyses:[],limitations:[]}),
  memories:async()=>[],messages:async()=>[],selfPersonIds:async()=>["self"],reviews:async()=>[],
  coverage:async()=>({total_meetings:137,analyzed_meetings:2,analyzed_chunks:3,pending_meetings:135}),
  addMessage:async(role:string,content:string,evidence:unknown[])=>{saved.push({role,content,evidence});},
  addMemory:async(value:unknown)=>{memories.push(value);},
  analysesInPeriod:async()=>({analyses:periodObservations.length?[{observations:periodObservations,created_at:"2026-09-18T12:00:00Z"}]:[],meetings,complete:true,limitations:[],total_meetings:meetings.length}),
  saveReview:async(_week:string,content:ReviewContent)=>{reviews.push(content);return {content};},
 } as unknown as ReturnType<typeof stores.coachStore>;
 const storeSpy=spyOn(stores,"coachStore").mockReturnValue(fake);
 process.env.OPENAI_API_KEY="synthetic-key";
 globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body));
  modelInput=JSON.parse(request.messages[1].content);
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]});
 }) as unknown as typeof fetch;
 return {saved,memories,reviews,input:()=>modelInput,restore:()=>storeSpy.mockRestore()};
}

test("saved chat preserves grounded hypothesis and alternative, with actual selected coverage",async()=>{
 const meetings=Array.from({length:8},(_,index)=>({...meeting,id:`meeting-${index}`}));
 const run=fixture(meetings,{answer:"Escolha uma entrega para acompanhar.",observations:[{...observation,evidence:undefined,evidence_ids:["e0"]}],memories:[{content:"Mais foco",kind:"pattern",observation_index:0}]});
 try{
  await chatWithCoach("synthetic-user","Como posso priorizar?");
  const answer=run.saved[1];
  expect(answer.content).toContain("**Observação:** Uma prioridade");
  expect(answer.content).toContain("**Hipótese:** Mais foco");
  expect(answer.content).toContain("**Outra explicação:** Pontual");
  expect(answer.content).toContain("6 trechos de 6 reuniões");
  expect(answer.content).toContain("Na geração desta resposta: 2 de 137 reuniões");
  expect(answer.content).not.toContain("8 reuniões");
  expect(answer.evidence).toHaveLength(1);
  expect(run.memories[0]).toMatchObject({status:"hypothesis",evidence:[{meeting_id:"meeting-0"}]});
 }finally{run.restore();}
});

test("multiple selected transcript parts count as one meeting",async()=>{
 const longMeeting={...meeting,transcription:meeting.transcription+" "+"Texto fictício. ".repeat(1700)};
 const run=fixture([longMeeting],{answer:"Acompanhe sua prioridade.",observations:[{...observation,evidence:undefined,evidence_ids:["e0"]}],memories:[]});
 try{
  await chatWithCoach("synthetic-user","Como priorizar?");
  expect(run.saved[1].content).toContain("2 trechos de 1 reunião");
  expect(run.saved[1].content).not.toContain("2 reuniões nesta resposta");
 }finally{run.restore();}
});

test("chat with no meeting evidence saves advice and an explicit limit, not a behavioral assessment",async()=>{
 const run=fixture([],{answer:"Pelo que você relatou, escolha uma prioridade.",observations:[],memories:[]});
 try{
  await chatWithCoach("synthetic-user","Preciso priorizar.");
  expect(run.saved[1].content).toContain("Não consultei trechos de reuniões");
  expect(run.saved[1].content).toContain("Sem observações verificadas");
  expect(run.saved[1].content).not.toContain("**Observação:**");
  expect(run.saved[1].evidence).toEqual([]);
 }finally{run.restore();}
});

test("weekly review does not freeze unrelated historical backlog counts",async()=>{
 const run=fixture([],{headline:"Foco",focus:"Escolher",observations:[],progress:"Sem comparação",experiment:"Testar",question:"Qual prioridade?",limitations:[]});
 try{
  await generateReview("synthetic-user",new Date("2026-09-20T20:00:00Z"));
  expect(run.input()).not.toHaveProperty("coverage");
  expect(run.reviews[0].limitations.join(" ")).not.toContain("135");
  expect(run.reviews[0].limitations.join(" ")).toContain("Não há observações verificadas");
 }finally{run.restore();}
});

test("weekly review saves only the principal experiment, even if the provider proposes competing actions",async()=>{
 const run=fixture([meeting],{headline:"Escolher uma prioridade",focus:"Foco",observations:[{...observation,evidence:undefined,evidence_ids:["e0"],experiment:"Abra também uma planilha diária."}],progress:"Primeira revisão",experiment:"Escolha uma entrega e confira o resultado na sexta.",question:"Qual entrega?",limitations:[]},grounded([observation],[meeting],["self"]));
 try{
  await generateReview("synthetic-user",new Date("2026-09-20T20:00:00Z"));
  expect(run.reviews[0].observations).toHaveLength(1);
  expect(run.reviews[0].observations[0].experiment).toBe("");
  expect(run.reviews[0].experiment).toBe("Escolha uma entrega e confira o resultado na sexta.");
  expect(run.reviews[0].observations[0].evidence[0].meeting_id).toBe("owned");
 }finally{run.restore();}
});

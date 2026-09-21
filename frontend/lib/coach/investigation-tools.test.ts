import {expect,spyOn,test} from "bun:test";
import * as stores from "./store";
import * as retrieval from "./retrieval";
import {investigationTools} from "./investigation-tools";
import {sourceHash} from "./evidence";
import type {CoachMeeting} from "./types";

test("semantic matches respect an implicit local period and never open foreign or stale sources",async()=>{
 const old:CoachMeeting={id:"00000000-0000-4000-8000-000000000001",nome:"Old",original_filename:"old.mp3",recorded_at:"2026-09-18T12:00:00Z",transcription:"Eu priorizo a entrega.",segments:[],speaker_labels:{},speaker_pessoas:{}};
 const today={...old,id:"00000000-0000-4000-8000-000000000002",recorded_at:"2026-09-20T12:00:00Z"};
 const stale={...today,id:"00000000-0000-4000-8000-000000000003"};
 const foreign="00000000-0000-4000-8000-000000000004";
 const store=spyOn(stores,"coachStore").mockReturnValue({context:async()=>({meetings:[],limitations:[],selection:{period:{from:"2026-09-20T03:00:00Z",to:"2026-09-21T03:00:00Z"}}}),meetingById:async(id:string)=>[old,today,stale].find(m=>m.id===id)||null} as unknown as ReturnType<typeof stores.coachStore>);
 const search=spyOn(retrieval,"semanticSearch").mockResolvedValue({available:true,matches:[old,today,stale].map(m=>({meeting_id:m.id,chunk_index:0,source_hash:m===stale?"old-hash":sourceHash(m),score:1})).concat([{meeting_id:foreign,chunk_index:0,source_hash:"foreign-hash",score:1}]),limitations:[]});
 try{
  const investigation=investigationTools("owner","America/Sao_Paulo",new Date("2026-09-20T20:00:00Z"),[],[]);
  const found=await investigation.tools.find(tool=>tool.name==="search_history")!.execute({query:"hoje",from:"",to:""},{signal:new AbortController().signal}) as {meetings:{id:string}[]};
  expect(found.meetings.map(m=>m.id)).toEqual([today.id]);
  expect([...investigation.meetings.keys()]).toEqual([today.id]);
  expect(await investigation.tools.find(tool=>tool.name==="open_meeting")!.execute({meeting_id:foreign,chunk_index:0,offset:0},{signal:new AbortController().signal})).toEqual({error:"Reunião não encontrada."});
 }finally{store.mockRestore();search.mockRestore();}
});

test("generated report reads are owner-scoped and never add report text to original evidence sources",async()=>{
 const meeting:CoachMeeting={id:"00000000-0000-4000-8000-000000000002",nome:"Report",original_filename:"report.mp3",recorded_at:"2026-09-20T12:00:00Z",summary:"Curto",executive_summary:"Relatório sintetizado. ".repeat(1000),transcription:"Fala original.",segments:[],speaker_labels:{},speaker_pessoas:{}};
 const store=spyOn(stores,"coachStore").mockReturnValue({meetingById:async(id:string)=>id===meeting.id?meeting:null} as unknown as ReturnType<typeof stores.coachStore>);
 try{
  const investigation=investigationTools("owner","America/Sao_Paulo",new Date(),[],[]);
  const tool=investigation.tools.find(tool=>tool.name==="read_meeting_report")!;
  const report=await tool.execute({meeting_id:meeting.id,offset:0},{signal:new AbortController().signal}) as {text:string;has_more:boolean;behavioral_evidence:boolean};
  expect(report.text).toHaveLength(12000);expect(report.has_more).toBe(true);expect(report.behavioral_evidence).toBe(false);
  expect(investigation.sources).toEqual({});expect(investigation.selected).toEqual([]);
  expect(await tool.execute({meeting_id:"00000000-0000-4000-8000-000000000009",offset:0},{signal:new AbortController().signal})).toEqual({error:"Reunião não encontrada."});
 }finally{store.mockRestore();}
});

test("invalid history date arguments return a recoverable tool result without I/O or losing evidence",async()=>{
 const meeting:CoachMeeting={id:"00000000-0000-4000-8000-000000000002",nome:"Original",original_filename:"original.mp3",recorded_at:"2026-09-17T12:00:00Z",transcription:"Vou priorizar uma proposta.",segments:[{speaker:"A",start:1,end:5,text:"Vou priorizar uma proposta."}],speaker_labels:{A:"Eu"},speaker_pessoas:{A:"self"}};
 let reads=0;
 const store=spyOn(stores,"coachStore").mockReturnValue({meetingById:async()=>meeting,context:async()=>{reads++;throw new Error("Invalid arguments must not reach storage");}} as unknown as ReturnType<typeof stores.coachStore>);
 const semantic=spyOn(retrieval,"semanticSearch").mockImplementation(async()=>{reads++;throw new Error("Invalid arguments must not reach embeddings");});
 try{
  const investigation=investigationTools("owner","America/Sao_Paulo",new Date(),["self"],[]);
  await investigation.tools.find(tool=>tool.name==="open_meeting")!.execute({meeting_id:meeting.id,chunk_index:0,offset:0},{signal:new AbortController().signal});
  const sources=JSON.stringify(investigation.sources);
  const search=investigation.tools.find(tool=>tool.name==="search_history")!;
  for(const range of [{from:"",to:"2026-09-21T03:35:20.563Z"},{from:"2026-09-21",to:""},{from:"not-a-date",to:"2026-09-21"},{from:"2026-09-22",to:"2026-09-21"}]){
   expect(await search.execute({query:"proposta",...range},{signal:new AbortController().signal})).toMatchObject({error:"invalid_period"});
  }
  expect(reads).toBe(0);expect(JSON.stringify(investigation.sources)).toBe(sources);expect(Object.keys(investigation.sources)).toHaveLength(1);
 }finally{store.mockRestore();semantic.mockRestore();}
});

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
  const found=await investigation.tools[0].execute({query:"hoje",from:"",to:""},{signal:new AbortController().signal}) as {meetings:{id:string}[]};
  expect(found.meetings.map(m=>m.id)).toEqual([today.id]);
  expect([...investigation.meetings.keys()]).toEqual([today.id]);
  expect(await investigation.tools[1].execute({meeting_id:foreign,chunk_index:0,offset:0},{signal:new AbortController().signal})).toEqual({error:"Reunião não encontrada."});
 }finally{store.mockRestore();search.mockRestore();}
});

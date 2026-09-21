import { expect, test } from "bun:test";
import { chunkMeeting, sourceHash } from "./evidence";
import { chunkTurns, buildSourceBank, selectChunks, conversationSearch } from "./investigation";
import type { CoachMeeting } from "./types";
const m:CoachMeeting={id:"a",nome:"Teste",original_filename:"a",recorded_at:null,transcription:"",segments:[],speaker_labels:{A:"Eu"},speaker_pessoas:{A:"self"}};
test("a long speaker turn remains attributable on both sides of a chunk boundary",()=>{
 const speech="Vou priorizar a entrega combinada. ".repeat(900);
 const meeting={...m,transcription:speech,segments:[{speaker:"A",start:10,end:40,text:speech}]};
 const chunks=chunkMeeting(meeting);
 expect(chunks.length).toBeGreaterThan(1);
 for(const chunk of chunks){
  expect(chunkTurns(meeting,chunk,["self"]).some(t=>t.self)).toBe(true);
  expect(Object.values(buildSourceBank([{meeting,chunk}],["self"])).some(e=>e.self_attributed)).toBe(true);
 }
});
test("repeated speech with ambiguous ownership is never attributed to self",()=>{
 const speech="Vamos abrir uma nova frente.";
 const meeting={...m,transcription:speech+"\n"+speech,segments:[{speaker:"A",start:1,end:2,text:speech},{speaker:"B",start:3,end:4,text:speech}],speaker_pessoas:{A:"self",B:"other"}};
 expect(Object.values(buildSourceBank([{meeting,chunk:chunkMeeting(meeting)[0]}],["self"]))).toHaveLength(0);
});
test("initial retrieval reserves room for independent meetings",()=>{
 const long={...m,transcription:"prioridade ".repeat(19000)};
 const other={...m,id:"b",transcription:"Precisamos discutir a prioridade do cliente."};
 expect(selectChunks([long,other],"prioridade").map(x=>x.meeting.id)).toContain("b");
});
test("a follow-up carries the user's preceding subject into retrieval",()=>{
 const history=[{id:"x",role:"user" as const,content:"Quero entender a delegação na plataforma Atlas.",evidence:[],created_at:"2026-09-20"}];
 expect(conversationSearch("Por quê?",history)).toContain("Atlas");
 expect(conversationSearch("Como foi meu dia hoje?",history)).toBe("Como foi meu dia hoje?");
});
test("changing meeting date invalidates conclusions about the wrong week",()=>{
 expect(sourceHash(m)).not.toBe(sourceHash({...m,recorded_at:"2026-09-19T12:00:00Z"}));
});

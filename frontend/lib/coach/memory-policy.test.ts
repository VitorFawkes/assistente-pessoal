import { expect, test } from "bun:test";
import { memoryContext, memoriesAt, inferenceBlocked } from "./memory-policy";
import type { CoachMemory, Evidence } from "./types";
const at="2026-09-01T00:00:00.000Z";
function memory(id:string,patch:Partial<CoachMemory>={}):CoachMemory{return {id,user_id:"a",kind:"context",content:id,status:"confirmed",evidence:[],history:[],created_at:at,updated_at:at,...patch};}
const evidence={meeting_id:"meeting-a",source_hash:"version-a",quote:"Vou delegar",speaker:"A",self_attributed:true,start:4,chunk_index:0,meeting_title:"Reunião",recorded_at:at} satisfies Evidence;
test("active goals and rejected corrections survive more than 100 newer notes",()=>{
 const items=[memory("goal",{kind:"goal"}),memory("rejected",{status:"rejected"}),...Array.from({length:150},(_,i)=>memory(`new-${i}`,{updated_at:"2026-09-19T00:00:00Z"}))];
 const packet=memoryContext(items,"Legacy objective");
 expect(packet.active_goals.map(m=>m.id)).toEqual(["goal"]);
 expect(packet.corrections.map(m=>m.id)).toContain("rejected");
 expect(packet.legacy_goals).toBeNull();
 expect(packet.memories.length).toBeLessThanOrEqual(100);
});
test("historical context uses the version known and active on that date",()=>{
 const item=memory("goal",{kind:"goal",content:"New objective",lifecycle:"active",valid_from:"2026-09-10T00:00:00Z",history:[{content:"Old objective",status:"confirmed",lifecycle:"active",valid_from:at,valid_until:"2026-09-10T00:00:00Z",at:"2026-09-10T00:00:00Z"}]});
 expect(memoriesAt([item],"2026-09-05T00:00:00Z")[0].content).toBe("Old objective");
 expect(memoriesAt([item],"2026-09-15T00:00:00Z")[0].content).toBe("New objective");
 expect(memoriesAt([item],"2026-08-01T00:00:00Z")).toEqual([]);
});
test("paused and superseded goals do not become current priorities",()=>{
 const packet=memoryContext([memory("paused",{kind:"goal",lifecycle:"paused"}),memory("old",{kind:"goal",lifecycle:"superseded"}),memory("current",{kind:"goal"})],"legacy");
 expect(packet.active_goals.map(m=>m.id)).toEqual(["current"]);
});
test("rephrasing a rejected interpretation on the same sources is blocked",()=>{
 const rejected=memory("rejected",{kind:"pattern",status:"rejected",evidence:[evidence]});
 expect(inferenceBlocked({kind:"pattern",content:"Nova redação",evidence:[evidence]},[rejected])).toBe(true);
 expect(inferenceBlocked({kind:"pattern",content:"Outra situação",evidence:[{...evidence,meeting_id:"other"}]},[rejected])).toBe(false);
});
test("corrected interpretation keeps the previous source as a veto",()=>{
 const corrected=memory("corrected",{history:[{content:"Old accusation",status:"hypothesis",evidence:[evidence],at:"2026-09-10T00:00:00Z"}]});
 expect(inferenceBlocked({kind:"pattern",content:"Old accusation paraphrased",evidence:[evidence]},[corrected])).toBe(true);
});

test("past goals with a future end date still govern that historical day",()=>{
 const goal=memory("goal",{kind:"goal",lifecycle:"superseded",valid_until:"2026-09-10T00:00:00Z",history:[{content:"goal",status:"confirmed",lifecycle:"active",valid_from:at,valid_until:"2026-09-10T00:00:00Z",at:"2026-09-10T00:00:00Z"}]});
 expect(memoryContext([goal],"", "2026-09-05T00:00:00Z").active_goals.map(m=>m.id)).toEqual(["goal"]);
 expect(memoryContext([goal],"", "2026-09-15T00:00:00Z").active_goals).toEqual([]);
});

test("historical retrieval never injects today's profile goals into an older day",()=>{
 expect(memoryContext([],"Current goal learned later","2020-01-01T00:00:00Z").legacy_goals).toBeNull();
});
test("legacy correction snapshots retain the old text without inventing evidence",()=>{
 const corrected=memory("old",{content:"Corrected today",updated_at:"2026-09-10T00:00:00Z",history:[{content:"Original text",status:"hypothesis",at:"2026-09-10T00:00:00Z"}]});
 const historical=memoriesAt([corrected],"2026-09-05T00:00:00Z")[0];
 expect(historical.content).toBe("Original text");expect(historical.status).toBe("hypothesis");expect(historical.evidence).toEqual([]);
});


test("a different quote in the same meeting remains available after an interpretation is corrected",()=>{
 const rejected=memory("rejected",{kind:"pattern",status:"rejected",content:"Uma hipótese descartada",evidence:[evidence]});
 expect(inferenceBlocked({kind:"pattern",content:"Uma observação independente",evidence:[{...evidence,quote:"A entrega foi concluída no prazo combinado.",start:90}]},[rejected])).toBe(false);
});
test("overlapping corrected quotes are blocked in the same source version",()=>{
 const original={...evidence,quote:"Eu vou revisar todos os detalhes da proposta antes de entregar."};
 const rejected=memory("rejected",{status:"rejected",evidence:[original]});
 expect(inferenceBlocked({kind:"pattern",content:"Uma nova redação",evidence:[{...original,quote:"todos os detalhes da proposta antes de entregar hoje."}]},[rejected])).toBe(true);
 expect(inferenceBlocked({kind:"pattern",content:"Uma outra leitura",evidence:[{...original,source_hash:"corrected-source-version"}]},[rejected])).toBe(false);
});
test("a correction without quoted evidence still blocks equivalent old interpretation text",()=>{
 const corrected=memory("corrected",{content:"O escopo é somente a revisão visual",history:[{content:"Você centraliza todas as decisões comerciais",status:"hypothesis",at:"2026-09-10T00:00:00Z"}]});
 expect(inferenceBlocked({kind:"pattern",content:"Você centraliza as decisões comerciais",evidence:[]},[corrected])).toBe(true);
});

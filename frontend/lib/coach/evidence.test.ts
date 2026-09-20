import { describe, expect, test } from "bun:test";
import { chunkMeeting, sourceHash, validateObservations, reviewPeriod } from "./evidence";
import type { CoachMeeting } from "./types";
const meeting: CoachMeeting = { id: "meeting-a", nome: "Diretoria", original_filename: "a.mp3", recorded_at: "2026-09-18T12:00:00Z", transcription: "Vou pausar dois projetos e definir um responsável. Precisamos decidir hoje.", segments: [{speaker:"A",start:12,end:20,text:"Vou pausar dois projetos e definir um responsável."},{speaker:"B",start:21,end:24,text:"Precisamos decidir hoje."}], speaker_labels:{A:"Vitor",B:"Ana"}, speaker_pessoas:{A:"self",B:"other"} };
describe("coach grounding", () => {
 test("chunks cover every character without silent truncation", () => {
  const m={...meeting,transcription:"a".repeat(45001)};
  const chunks=chunkMeeting(m,20000);
  expect(chunks.map(c=>c.text).join("")).toBe(m.transcription);
  expect(chunks.length).toBe(3);
 });
 test("speaker edits invalidate source hash",()=>expect(sourceHash(meeting)).not.toBe(sourceHash({...meeting,speaker_pessoas:{A:"other"}})));
 test("rejects invented evidence and does not trust model speaker or timestamp",()=>{
  const raw=[{competency:"focus",observation:"Priorizou uma pausa",hypothesis:"Pode estar reduzindo frentes",alternative:"Pode ser pontual",experiment:"Rever sexta",evidence:[{quote:"Vou pausar dois projetos e definir um responsável.",speaker:"B",start:999},{quote:"inventado"}]}];
  const obs=validateObservations(raw,meeting,chunkMeeting(meeting)[0],["self"]);
  expect(obs[0].evidence.length).toBe(1); expect(obs[0].evidence[0].speaker).toBe("Vitor"); expect(obs[0].evidence[0].start).toBe(12); expect(obs[0].evidence[0].self_attributed).toBe(true);
 });
 test("unidentified and ambiguous speech cannot be attributed to self",()=>{
  const m={...meeting,speaker_pessoas:null};
  const raw=[{competency:"focus",observation:"Pausa",hypothesis:"Talvez",alternative:"Outra leitura",experiment:"Perguntar",evidence:[{quote:"Vou pausar dois projetos e definir um responsável."}]}];
  expect(validateObservations(raw,m,chunkMeeting(m)[0],["self"])[0].evidence[0].self_attributed).toBe(false);
 });
 test("observations without real evidence are removed",()=>expect(validateObservations([{competency:"focus",observation:"ruim",evidence:[{quote:"xyz"}]}],meeting,chunkMeeting(meeting)[0],[])).toEqual([]));
 test("Friday review uses São Paulo time and a stable seven-day period",()=>{
  const before=reviewPeriod(new Date("2026-09-18T19:59:00Z"),"America/Sao_Paulo",5,17);
  const after=reviewPeriod(new Date("2026-09-18T20:00:00Z"),"America/Sao_Paulo",5,17);
  expect(before.weekStart).toBe("2026-09-04"); expect(after.weekStart).toBe("2026-09-11");
  expect(reviewPeriod(new Date("2026-09-20T20:00:00Z"),"America/Sao_Paulo",5,17).weekStart).toBe(after.weekStart);
 });
});

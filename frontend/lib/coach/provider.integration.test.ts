import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { coachStore } from "./store";
import { analyzeMeetings, chatWithCoach, generateReview } from "./service";
import { splitChatPresentation } from "./chat-presentation";
import { reviewPeriod } from "./evidence";
// Opt-in paid provider test; only synthetic records in the dedicated local QA DB.
describe.skipIf(process.env.COACH_PROVIDER_TEST!=="1")("coach real provider lifecycle",()=>{
 const userId=randomUUID(),meetingId=randomUUID(),personId=randomUUID();let admin:Pool;
 const store=coachStore(userId);let runNow=new Date();
 beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL||"");
  if(!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/coach_qa")throw new Error("Only local coach_qa is allowed");
  url.username=process.env.USER||"vitorgambetti";url.password="";admin=new Pool({connectionString:url.toString()});
  for(const migration of ["0033_coach_report_context.sql","0034_coach_context_lineage.sql"])
   await admin.query(await readFile(new URL("../../../db/"+migration,import.meta.url),"utf8"));
  await admin.query("INSERT INTO users(id,nome,consent_terms_at) VALUES($1,'Coach provider fixture',now())",[userId]);
  await admin.query("INSERT INTO pessoas(id,user_id,nome,is_vitor) VALUES($1,$2,'Coach provider fixture',true)",[personId,userId]);
  const transcript="Vou pausar dois projetos e definir um responsável. O foco desta semana será concluir a proposta. Na sexta vamos revisar o resultado.";
  await admin.query(`INSERT INTO meetings(id,user_id,source,original_filename,nome,recorded_at,status,transcription,segments,speaker_labels,speaker_pessoas,summary,raw_ai_response)
  VALUES($1,$2,'macbook','synthetic.mp3','Exemplo fictício',$7,'done',$3,$4::jsonb,$5::jsonb,$6::jsonb,'Proposta prioritária e delegação',jsonb_build_object('executive_summary','## Contexto e decisões\nO responsável anunciou que vai pausar dois projetos, definir responsável e concluir a proposta na semana. Na sexta será revisado o resultado. Este relatório sintetiza o encontro; atuação e autoria precisam ser confirmadas na transcrição.'))`,
  [meetingId,userId,transcript,JSON.stringify([{speaker:"A",start:0,end:30,text:transcript}]),JSON.stringify({A:"Coach provider fixture"}),JSON.stringify({A:personId}),new Date(Date.parse(reviewPeriod(runNow,"America/Sao_Paulo",5,17).to)-36*3600000).toISOString()]);
  await store.saveProfile({enabled:true,weekly_enabled:true,review_day:5,review_hour:17,goals:"Concluir uma prioridade semanal antes de assumir outra frente."});
  runNow=new Date();
 });
 afterAll(async()=>{await admin?.query("DELETE FROM meetings WHERE user_id=$1",[userId]);await admin?.query("DELETE FROM pessoas WHERE user_id=$1",[userId]);await admin?.query("DELETE FROM users WHERE id=$1",[userId]);await admin?.end();await global.__pgPool?.end();global.__pgPool=undefined;});
 test("existing report skips duplicate analysis while behavioral review and chat open original evidence",async()=>{
  expect(await analyzeMeetings(userId,1)).toEqual({processed:0,indexed:0});
  expect((await store.coverage()).pending_meetings).toBe(0);
  const analyses=await store.analyses(meetingId);expect(analyses).toHaveLength(0);
  expect(await store.coverage()).toMatchObject({report_ready_meetings:1,executive_report_meetings:1,analyzed_meetings:0});
  const review=await generateReview(userId,runNow);
  if(!review)throw new Error("manual review must be generated");
  expect(review.content.observations.length).toBeGreaterThan(0);
  expect(review.content.observations.length).toBeLessThanOrEqual(2);
  expect(review.content.observations.every(o=>o.experiment==="")).toBe(true);
  expect(review.content.experiment.length).toBeGreaterThan(0);
  expect(review.content.headline.length).toBeLessThanOrEqual(100);
  for(const o of review.content.observations)for(const e of o.evidence){expect(e.meeting_id).toBe(meetingId);expect(e.self_attributed).toBe(true);}
  expect((await generateReview(userId,runNow))?.id).toBe(review.id);
  await chatWithCoach(userId,"Qual comportamento meu merece acompanhamento nesta reunião? Use uma evidência e sugira um experimento.");
  const history=await store.messages();expect(history).toHaveLength(2);expect(history[1].role).toBe("assistant");expect(history[1].content.length).toBeGreaterThan(50);expect(history[1].evidence.length).toBeGreaterThan(0);
  for(const label of ["**Observação:**","**Hipótese:**","**Outra explicação:**"])expect(history[1].content).toContain(label);
  expect(history[1].content).toMatch(/Consultei \d+ trechos? de 1 reunião/);
  expect(history[1].context_sources).toEqual(expect.arrayContaining([expect.objectContaining({meeting_id:meetingId})]));
  expect(history[1].content).toContain("1 de 1 reuniões do histórico com relatório/resumo disponível");
  expect(history[1].content).toContain("0 com análise comportamental integral anterior");
  expect(history[1].content).not.toMatch(/\be\d+\b/);
 },180000);
 test("a natural goal correction persists as user report and the coach can give one next step",async()=>{
  const goal="Meu objetivo agora é delegar a operação comercial com autonomia.";
  await chatWithCoach(userId,goal+" Guarde esse objetivo para nossas próximas conversas.");
  const memories=await store.memories();
  expect(memories.some(m=>m.kind==="goal"&&m.status==="confirmed"&&m.content.includes(goal)&&m.evidence.length===0)).toBe(true);
  let history=await store.messages();
  expect(history.at(-1)?.content).toMatch(/Guardei o que você informou|Atualizei seu objetivo/);
  await chatWithCoach(userId,"Me diga só o próximo passo para esse objetivo, sem uma lista de tarefas.");
  history=await store.messages();
  const reply=splitChatPresentation(history.at(-1)!.content);
  expect(reply.answer.length).toBeGreaterThan(30);
  expect(reply.answer.split(/\s+/u).length).toBeLessThanOrEqual(85);
  expect(reply.scope).toContain("reunião");
 },180000);

});

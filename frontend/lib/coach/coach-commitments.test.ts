import {expect,spyOn,test} from "bun:test";
import * as database from "../db";
import {listCommitments} from "./coach-commitments";
import * as commitments from "./coach-commitments";
import type {PoolClient} from "pg";
import type {CoachCommitment} from "./types";

test("an intentionally taskless agreement stays open while a deleted task becomes unknown",async()=>{
 const base={id:"a",title:"Vou enviar a proposta.",status:"open",tarefa_id:null,outcome:null,outcome_source:"unknown",history:[],updated_at:"2026-09-21T10:00:00Z"} as unknown as CoachCommitment;
 const rows=[{...base,idempotency_key:"track:conversation:0"},{...base,id:"b",idempotency_key:"conversation:task:0"}];
 const tenant=spyOn(database,"withTenant").mockImplementation(async(_id,fn)=>fn({query:async()=>({rows})} as unknown as PoolClient));
 try{
  const result=await listCommitments("owner");
  expect(result[0].status).toBe("open");expect(result[1].status).toBe("unknown");
 }finally{tenant.mockRestore();}
});


test("recording a blocker writes its literal source without issuing task mutations",async()=>{
 expect(typeof commitments.recordCommitmentOutcome).toBe("function");
 const id="11111111-1111-4111-8111-111111111111",sourceId="22222222-2222-4222-8222-222222222222";
 const outcome="Não consegui enviar a proposta porque faltou o preço.";
 const previous={id,user_id:"owner",title:"Vou enviar a proposta.",status:"open",tarefa_id:"task",idempotency_key:"job:task:0",history:[],outcome:null} as unknown as CoachCommitment;
 const writes:{sql:string;values:unknown[]}[]=[];
 const tenant=spyOn(database,"withTenant").mockImplementation(async(_id,fn)=>fn({query:async(sql:string,values:unknown[]=[])=>{
  if(sql.includes("FROM coach_profiles"))return {rows:[{enabled:true,revision:1}]};
  if(sql.includes("FROM coach_messages"))return {rows:[{role:"user",content:outcome}]};
  if(sql.startsWith("UPDATE")){writes.push({sql,values});return {rows:[sql.startsWith("UPDATE coach_profiles")?{revision:2}:{...previous,outcome,outcome_source:"user_report"}]};}
  return {rows:[previous]};
 }} as unknown as PoolClient));
 try{
  const receipt=await commitments.recordCommitmentOutcome("owner",id,{source_message_id:sourceId,outcome},1);
  expect(receipt?.profile_revision).toBe(2);
  expect(writes).toHaveLength(2);expect(writes[0].sql).toMatch(/^UPDATE coach_commitments/);
  expect(writes[1].sql).toMatch(/^UPDATE coach_profiles SET revision\s*=\s*revision\s*\+\s*1/);
  expect(writes[0].values).toContain(outcome);expect(writes[0].values).toContain(sourceId);
  expect(writes[0].sql).not.toMatch(/SET\s+status|UPDATE tarefas/);
 }finally{tenant.mockRestore();}
});


test("an idempotent replay cannot adopt a cancelled or outdated job's newer profile revision",async()=>{
 const id="11111111-1111-4111-8111-111111111111",runId="33333333-3333-4333-8333-333333333333";
 const previous={id,user_id:"owner",status:"completed",outcome:"Concluí a proposta.",due_at:null,history:[]} as unknown as CoachCommitment;
 let validJob=false,writes=0;
 const tenant=spyOn(database,"withTenant").mockImplementation(async(_id,fn)=>fn({query:async(sql:string)=>{
  if(sql.includes("FROM coach_profiles"))return {rows:[{enabled:true,revision:5}]};
  if(sql.includes("FROM coach_jobs"))return {rows:validJob?[{id:runId}]:[],rowCount:validJob?1:0};
  if(sql.startsWith("UPDATE"))writes++;
  return {rows:[previous]};
 }} as unknown as PoolClient));
 try{
  const patch={status:"completed" as const,outcome:"Concluí a proposta."};
  await expect(commitments.updateCommitment("owner",id,patch,2,runId)).rejects.toThrow("O contexto do coach mudou");
  validJob=true;expect((await commitments.updateCommitment("owner",id,patch,2,runId))?.profile_revision).toBe(5);
  validJob=false;expect((await commitments.updateCommitment("owner",id,patch,2))?.profile_revision).toBe(5);
  expect(writes).toBe(0);
 }finally{tenant.mockRestore();}
});

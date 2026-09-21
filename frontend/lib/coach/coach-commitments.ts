import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import { StaleCoachRunError } from "./store";
import type { CoachCommitment,CoachCommitmentReceipt } from "./types";
export type {CoachCommitmentReceipt} from "./types";
import {trackingCommitmentCandidates,validateAction} from "./conversation-actions";

export type CommitmentInput = {
 accepted:true; idempotency_key:string; source_message_id:string; title:string;
 description?:string; due_at?:string|null; action?:"executar"|"cobrar"|"aguardar"; owner?:string;
};
export type TrackCommitmentInput = {accepted:true;idempotency_key:string;source_message_id:string;title:string;due_at?:string|null};
export type CommitmentOutcomeInput = {source_message_id:string;outcome:string};
const TRACK_PREFIX="track:";
export type CommitmentUpdate = {status:CoachCommitment["status"];outcome?:string|null;due_at?:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serial=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function deadline(value:string|null|undefined){
 if(value==null)return null;
 if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))throw new Error("invalid_input");
 return new Date(value).toISOString();
}
async function lockProfile(db:PoolClient,userId:string,revision?:number){
 const profile=(await db.query<{revision:number;enabled:boolean}>("SELECT revision,enabled FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
 if(!profile?.enabled||(revision!==undefined&&profile.revision!==revision))throw new StaleCoachRunError();
 return profile.revision;
}
function assertExpectedRevision(actual:number,expected?:number){if(expected!==undefined&&actual!==expected)throw new StaleCoachRunError();}
async function bumpCommitmentRevision(db:PoolClient,userId:string,runId?:string):Promise<number>{
 const revision=(await db.query<{revision:number}>("UPDATE coach_profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1 RETURNING revision",[userId])).rows[0]?.revision;
 if(!Number.isInteger(revision)||revision<1)throw new StaleCoachRunError();
 if(!runId)return revision;
 const updated=await db.query(`UPDATE coach_jobs j SET profile_revision=p.revision,updated_at=now() FROM coach_profiles p
  WHERE j.user_id=$1 AND j.id=$2 AND j.status='running' AND p.user_id=j.user_id AND p.enabled AND j.profile_revision=p.revision-1`,[userId,runId]);
 if(!updated.rowCount)throw new StaleCoachRunError();
 return revision;
}
const receipt=(value:CoachCommitment,revision:number):CoachCommitmentReceipt=>serial({...value,profile_revision:revision});
async function replayReceipt(db:PoolClient,userId:string,value:CoachCommitment,revision:number,runId?:string):Promise<CoachCommitmentReceipt>{
 if(runId){
  const own=await db.query("SELECT id FROM coach_jobs WHERE user_id=$1 AND id=$2 AND status='running' AND profile_revision=$3",[userId,runId,revision]);
  if(!own.rowCount)throw new StaleCoachRunError();
 }
 return receipt(value,revision);
}
const selection=`SELECT c.*,t.status AS task_status,t.concluida_em AS task_completed_at,t.updated_at AS task_updated_at FROM coach_commitments c
 LEFT JOIN tarefas t ON t.id=c.tarefa_id AND t.user_id=c.user_id`;

/** The caller must provide an explicit accepted user action, never a model's suggestion. */
export async function createCommitment(userId:string,input:CommitmentInput,revision?:number,runId?:string):Promise<CoachCommitmentReceipt>{
 if(input.accepted!==true||typeof input.title!=="string"||!input.title.trim()||input.title.length>500||typeof input.idempotency_key!=="string"||input.idempotency_key.length<8||input.idempotency_key.length>200||!uuid.test(input.source_message_id))throw new Error("invalid_input");
 if(input.description!==undefined&&(typeof input.description!=="string"||input.description.length>4000))throw new Error("invalid_input");
 if(input.idempotency_key.startsWith(TRACK_PREFIX))throw new Error("A chave de acompanhamento não pode criar uma tarefa.");
 const action=input.action||"executar";
 if(!["executar","cobrar","aguardar"].includes(action)||input.owner!==undefined&&(typeof input.owner!=="string"||input.owner.length>200))throw new Error("invalid_input");
 if(action!=="executar"&&!input.owner?.trim())throw new Error("Informe quem assumiu o compromisso delegado.");
 const normalized={source_message_id:input.source_message_id,title:input.title.trim(),description:input.description?.trim()||null,due_at:deadline(input.due_at),action,owner:action==="executar"?"vitor":input.owner!.trim()};
 const requestHash=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
 return withTenant(userId,async(db)=>{
  const currentRevision=await lockProfile(db,userId);
  const existing=(await db.query<CoachCommitment&{request_hash:string}>("SELECT * FROM coach_commitments WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotency_key])).rows[0];
  if(existing){if(existing.request_hash!==requestHash)throw new Error("Esta chave já corresponde a outro compromisso.");return replayReceipt(db,userId,existing,currentRevision,runId);}
  assertExpectedRevision(currentRevision,revision);
  const source=(await db.query<{role:string}>("SELECT role FROM coach_messages WHERE user_id=$1 AND id=$2 FOR SHARE",[userId,input.source_message_id])).rows[0];
  if(source?.role!=="user")throw new Error("O compromisso precisa estar vinculado a uma mensagem sua.");
  const task=(await db.query<{id:string}>(`INSERT INTO tarefas(user_id,titulo,descricao,owner,acao,prazo,prioridade,status)
   VALUES($1,$2,$3,$4,$5,$6,'media','aberta') RETURNING id`,[userId,normalized.title,normalized.description,normalized.owner,action,normalized.due_at])).rows[0];
  const commitment=(await db.query<CoachCommitment>(`INSERT INTO coach_commitments(user_id,tarefa_id,source_message_id,idempotency_key,request_hash,title,due_at)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[userId,task.id,input.source_message_id,input.idempotency_key,requestHash,normalized.title,normalized.due_at])).rows[0];
  await db.query("INSERT INTO tarefa_eventos(tarefa_id,evento,payload) VALUES($1,'criada',$2::jsonb)",[task.id,JSON.stringify({origem:"coach",commitment_id:commitment.id,source_message_id:input.source_message_id})]);
  const writtenRevision=await bumpCommitmentRevision(db,userId,runId);
  return receipt(commitment,writtenRevision);
 });
}

export async function listCommitments(userId:string):Promise<CoachCommitment[]>{
 return withTenant(userId,async(db)=>serial((await db.query<CoachCommitment>(`${selection} WHERE c.user_id=$1 ORDER BY c.updated_at DESC,c.id`,[userId])).rows.map(commitment=>{
  const taskChangedLater=commitment.task_updated_at&&Date.parse(String(commitment.task_updated_at))>Date.parse(String(commitment.updated_at));
  if(taskChangedLater&&["completed","cancelled"].includes(commitment.status)&&["aberta","em_andamento","aguardando_aprovacao"].includes(commitment.task_status||""))return {...commitment,status:"open" as const,outcome_source:"task_record" as const};
  if((taskChangedLater||["open","renegotiated","unknown"].includes(commitment.status))&&commitment.task_status==="concluida")return {...commitment,status:"completed" as const,outcome_source:"task_record" as const};
  if((taskChangedLater||["open","renegotiated","unknown"].includes(commitment.status))&&commitment.task_status==="cancelada")return {...commitment,status:"cancelled" as const,outcome_source:"task_record" as const};
  if(!commitment.tarefa_id&&commitment.status==="open"&&!commitment.idempotency_key.startsWith(TRACK_PREFIX))return {...commitment,status:"unknown" as const,outcome_source:"unknown" as const};
  return commitment;
 })));
}

/** User-reported outcome remains labelled, even when reflected in the task record. */
export async function updateCommitment(userId:string,id:string,patch:CommitmentUpdate,revision?:number,runId?:string):Promise<CoachCommitmentReceipt|null>{
 if(!uuid.test(id)||!["open","completed","renegotiated","cancelled","unknown"].includes(patch.status)||patch.outcome!=null&&(typeof patch.outcome!=="string"||patch.outcome.length>4000))throw new Error("invalid_input");
 const due=patch.due_at===undefined?undefined:deadline(patch.due_at);
 return withTenant(userId,async(db)=>{
  const currentRevision=await lockProfile(db,userId);
  const previous=(await db.query<CoachCommitment>("SELECT * FROM coach_commitments WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,id])).rows[0];
  if(!previous)return null;
  const nextDue=due===undefined?previous.due_at:due;
  const outcome=patch.outcome?.trim()||null;
  if(previous.status===patch.status&&previous.outcome===outcome&&(previous.due_at===null?null:new Date(previous.due_at).toISOString())===(nextDue===null?null:new Date(nextDue).toISOString()))return replayReceipt(db,userId,previous,currentRevision,runId);
  assertExpectedRevision(currentRevision,revision);
  const updated=(await db.query<CoachCommitment>(`UPDATE coach_commitments SET history=history||jsonb_build_array(jsonb_build_object('status',status,'outcome',outcome,'at',now())),
   status=$3,outcome=$4,outcome_source=$5,due_at=$6,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`,[userId,id,patch.status,outcome,patch.status==="unknown"?"unknown":"user_report",nextDue])).rows[0];
  if(previous.tarefa_id){
   const taskStatus=patch.status==="completed"?"concluida":patch.status==="cancelled"?"cancelada":["open","renegotiated"].includes(patch.status)?"aberta":null;
   if(taskStatus){
    await db.query(`UPDATE tarefas SET status=$3,prazo=$4,updated_at=now(),situacao_desde=now(),
      concluida_em=CASE WHEN $3='concluida' THEN now() ELSE NULL END,cancelada_em=CASE WHEN $3='cancelada' THEN now() ELSE NULL END WHERE user_id=$1 AND id=$2`,[userId,previous.tarefa_id,taskStatus,nextDue]);
    const event=taskStatus==="concluida"?"concluida":taskStatus==="cancelada"?"cancelada":patch.status==="renegotiated"?"prazo_alterado":"reaberta";
    await db.query("INSERT INTO tarefa_eventos(tarefa_id,evento,payload) VALUES($1,$2,$3::jsonb)",[previous.tarefa_id,event,JSON.stringify({origem:"coach",commitment_id:id,status:taskStatus,outcome_source:"user_report",due_at:nextDue})]);
   }
  }
  const writtenRevision=await bumpCommitmentRevision(db,userId,runId);
  return receipt(updated,writtenRevision);
 });
}


/** Track an explicitly accepted step without creating an operational task. */
export async function trackCommitment(userId:string,input:TrackCommitmentInput,revision?:number,runId?:string):Promise<CoachCommitmentReceipt>{
 if(input.accepted!==true||typeof input.title!=="string"||!input.title.trim()||input.title.length>500||typeof input.idempotency_key!=="string"||!input.idempotency_key.startsWith(TRACK_PREFIX)||input.idempotency_key.length<8||input.idempotency_key.length>200||!uuid.test(input.source_message_id))throw new Error("invalid_input");
 const normalized={source_message_id:input.source_message_id,title:input.title.trim(),due_at:deadline(input.due_at),kind:"tracked_step"};
 const requestHash=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
 return withTenant(userId,async db=>{
  const currentRevision=await lockProfile(db,userId);
  const old=(await db.query<CoachCommitment&{request_hash:string}>("SELECT * FROM coach_commitments WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotency_key])).rows[0];
  if(old){if(old.request_hash!==requestHash)throw new Error("Esta chave já corresponde a outro compromisso.");return replayReceipt(db,userId,old,currentRevision,runId);}
  assertExpectedRevision(currentRevision,revision);
  const source=(await db.query<{role:string;content:string}>("SELECT role,content FROM coach_messages WHERE user_id=$1 AND id=$2 FOR SHARE",[userId,input.source_message_id])).rows[0];
  if(source?.role!=="user"||!trackingCommitmentCandidates(source.content).includes(normalized.title))throw new Error("O acompanhamento precisa de um passo concreto que você tenha assumido.");
  if(input.due_at&&!source.content.includes(input.due_at))throw new Error("O prazo precisa ter sido informado explicitamente.");
  const saved=(await db.query<CoachCommitment>(`INSERT INTO coach_commitments(user_id,source_message_id,idempotency_key,request_hash,title,due_at)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[userId,input.source_message_id,input.idempotency_key,requestHash,normalized.title,normalized.due_at])).rows[0];
  const writtenRevision=await bumpCommitmentRevision(db,userId,runId);
  return receipt(saved,writtenRevision);
 });
}

/** An outcome is a user report; it does not silently reopen, complete or reschedule a task. */
export async function recordCommitmentOutcome(userId:string,id:string,input:CommitmentOutcomeInput,revision?:number,runId?:string):Promise<CoachCommitmentReceipt|null>{
 if(!uuid.test(id)||!uuid.test(input.source_message_id)||typeof input.outcome!=="string"||input.outcome.trim().length<8||input.outcome.length>900)throw new Error("invalid_input");
 const outcome=input.outcome.trim();
 return withTenant(userId,async db=>{
  const currentRevision=await lockProfile(db,userId);
  const previous=(await db.query<CoachCommitment>("SELECT * FROM coach_commitments WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,id])).rows[0];
  if(!previous)return null;
  const priorReport=previous.history.find(item=>item.source_message_id===input.source_message_id);
  if(priorReport){if(priorReport.reported_outcome!==outcome)throw new Error("Esta mensagem já registrou outro resultado para o compromisso.");return replayReceipt(db,userId,previous,currentRevision,runId);}
  assertExpectedRevision(currentRevision,revision);
  const source=(await db.query<{role:string;content:string}>("SELECT role,content FROM coach_messages WHERE user_id=$1 AND id=$2 FOR SHARE",[userId,input.source_message_id])).rows[0];
  const all=(await db.query<CoachCommitment>("SELECT * FROM coach_commitments WHERE user_id=$1",[userId])).rows;
  if(source?.role!=="user"||!validateAction({type:"report_commitment_outcome",quote:outcome,outcome,guidance:"",commitment_id:id},source.content,all))throw new Error("O resultado precisa ser seu relato literal sobre um compromisso identificado.");
  const saved=(await db.query<CoachCommitment>(`UPDATE coach_commitments SET
   history=history||jsonb_build_array(jsonb_build_object('status',status,'outcome',outcome,'at',now(),'source_message_id',$4::text,'reported_outcome',$3::text)),
   outcome=$3,outcome_source='user_report',updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`,[userId,id,outcome,input.source_message_id])).rows[0];
  const writtenRevision=await bumpCommitmentRevision(db,userId,runId);
  return receipt(saved,writtenRevision);
 });
}

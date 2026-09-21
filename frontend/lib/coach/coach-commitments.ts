import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import { StaleCoachRunError } from "./store";
import type { CoachCommitment } from "./types";

export type CommitmentInput = {
 accepted:true; idempotency_key:string; source_message_id:string; title:string;
 description?:string; due_at?:string|null; action?:"executar"|"cobrar"|"aguardar"; owner?:string;
};
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
}
const selection=`SELECT c.*,t.status AS task_status,t.concluida_em AS task_completed_at,t.updated_at AS task_updated_at FROM coach_commitments c
 LEFT JOIN tarefas t ON t.id=c.tarefa_id AND t.user_id=c.user_id`;

/** The caller must provide an explicit accepted user action, never a model's suggestion. */
export async function createCommitment(userId:string,input:CommitmentInput,revision?:number):Promise<CoachCommitment>{
 if(input.accepted!==true||typeof input.title!=="string"||!input.title.trim()||input.title.length>500||typeof input.idempotency_key!=="string"||input.idempotency_key.length<8||input.idempotency_key.length>200||!uuid.test(input.source_message_id))throw new Error("invalid_input");
 if(input.description!==undefined&&(typeof input.description!=="string"||input.description.length>4000))throw new Error("invalid_input");
 const action=input.action||"executar";
 if(!["executar","cobrar","aguardar"].includes(action)||input.owner!==undefined&&(typeof input.owner!=="string"||input.owner.length>200))throw new Error("invalid_input");
 if(action!=="executar"&&!input.owner?.trim())throw new Error("Informe quem assumiu o compromisso delegado.");
 const normalized={source_message_id:input.source_message_id,title:input.title.trim(),description:input.description?.trim()||null,due_at:deadline(input.due_at),action,owner:action==="executar"?"vitor":input.owner!.trim()};
 const requestHash=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
 return withTenant(userId,async(db)=>{
  await lockProfile(db,userId,revision);
  const existing=(await db.query<CoachCommitment&{request_hash:string}>("SELECT * FROM coach_commitments WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotency_key])).rows[0];
  if(existing){if(existing.request_hash!==requestHash)throw new Error("Esta chave já corresponde a outro compromisso.");return serial(existing);}
  const source=(await db.query<{role:string}>("SELECT role FROM coach_messages WHERE user_id=$1 AND id=$2 FOR SHARE",[userId,input.source_message_id])).rows[0];
  if(source?.role!=="user")throw new Error("O compromisso precisa estar vinculado a uma mensagem sua.");
  const task=(await db.query<{id:string}>(`INSERT INTO tarefas(user_id,titulo,descricao,owner,acao,prazo,prioridade,status)
   VALUES($1,$2,$3,$4,$5,$6,'media','aberta') RETURNING id`,[userId,normalized.title,normalized.description,normalized.owner,action,normalized.due_at])).rows[0];
  const commitment=(await db.query<CoachCommitment>(`INSERT INTO coach_commitments(user_id,tarefa_id,source_message_id,idempotency_key,request_hash,title,due_at)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[userId,task.id,input.source_message_id,input.idempotency_key,requestHash,normalized.title,normalized.due_at])).rows[0];
  await db.query("INSERT INTO tarefa_eventos(tarefa_id,evento,payload) VALUES($1,'criada',$2::jsonb)",[task.id,JSON.stringify({origem:"coach",commitment_id:commitment.id,source_message_id:input.source_message_id})]);
  return serial(commitment);
 });
}

export async function listCommitments(userId:string):Promise<CoachCommitment[]>{
 return withTenant(userId,async(db)=>serial((await db.query<CoachCommitment>(`${selection} WHERE c.user_id=$1 ORDER BY c.updated_at DESC,c.id`,[userId])).rows.map(commitment=>{
  const taskChangedLater=commitment.task_updated_at&&Date.parse(String(commitment.task_updated_at))>Date.parse(String(commitment.updated_at));
  if(taskChangedLater&&["completed","cancelled"].includes(commitment.status)&&["aberta","em_andamento","aguardando_aprovacao"].includes(commitment.task_status||""))return {...commitment,status:"open" as const,outcome_source:"task_record" as const};
  if((taskChangedLater||["open","renegotiated","unknown"].includes(commitment.status))&&commitment.task_status==="concluida")return {...commitment,status:"completed" as const,outcome_source:"task_record" as const};
  if((taskChangedLater||["open","renegotiated","unknown"].includes(commitment.status))&&commitment.task_status==="cancelada")return {...commitment,status:"cancelled" as const,outcome_source:"task_record" as const};
  if(!commitment.tarefa_id&&commitment.status==="open")return {...commitment,status:"unknown" as const,outcome_source:"unknown" as const};
  return commitment;
 })));
}

/** User-reported outcome remains labelled, even when reflected in the task record. */
export async function updateCommitment(userId:string,id:string,patch:CommitmentUpdate,revision?:number):Promise<CoachCommitment|null>{
 if(!uuid.test(id)||!["open","completed","renegotiated","cancelled","unknown"].includes(patch.status)||patch.outcome!=null&&(typeof patch.outcome!=="string"||patch.outcome.length>4000))throw new Error("invalid_input");
 const due=patch.due_at===undefined?undefined:deadline(patch.due_at);
 return withTenant(userId,async(db)=>{
  await lockProfile(db,userId,revision);
  const previous=(await db.query<CoachCommitment>("SELECT * FROM coach_commitments WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,id])).rows[0];
  if(!previous)return null;
  const nextDue=due===undefined?previous.due_at:due;
  const outcome=patch.outcome?.trim()||null;
  if(previous.status===patch.status&&previous.outcome===outcome&&(previous.due_at===null?null:new Date(previous.due_at).toISOString())===(nextDue===null?null:new Date(nextDue).toISOString()))return serial(previous);
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
  return serial(updated);
 });
}

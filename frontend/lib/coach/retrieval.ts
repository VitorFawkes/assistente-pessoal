import { randomUUID } from "node:crypto";
import { coachAgent, openAiCall, recordAiUsage } from "../ai-usage";
import { withTenant } from "../db";
import { sourceHash, type MeetingChunk } from "./evidence";
import type { CoachMeeting } from "./types";
import type { CoachTelemetry } from "./model";
const embeddingModel="text-embedding-3-small";
export const semanticEnabled=()=>process.env.COACH_SEMANTIC_ENABLED==="true"&&!!process.env.OPENAI_API_KEY;
export function cosine(a:number[],b:number[]){
 if(a.length!==b.length||!a.length)return 0;
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
 return aa&&bb?dot/Math.sqrt(aa*bb):0;
}
async function embed(userId:string,text:string,signal?:AbortSignal):Promise<number[]>{
 const response=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
 body:JSON.stringify({model:embeddingModel,input:text.slice(0,24000),dimensions:1536}),signal:signal||AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error("Busca semântica temporariamente indisponível.");
 const json=await response.json();
 await recordAiUsage({ref:`coach_vetor:${randomUUID()}`,agent:"coach_busca",source:"app",userId,...openAiCall(embeddingModel,json.usage)});
 const vector=json.data?.[0]?.embedding;
 if(!Array.isArray(vector)||vector.length!==1536||vector.some((n:unknown)=>typeof n!=="number"||!Number.isFinite(n)))throw new Error("Resposta inválida do índice semântico.");
 return vector;
}
export async function indexChunk(userId:string,meeting:CoachMeeting,chunk:MeetingChunk,revision?:number){
 if(!semanticEnabled())return false;
 const exists=await withTenant(userId,db=>db.query("SELECT 1 FROM coach_semantic_chunks WHERE user_id=$1 AND meeting_id=$2 AND chunk_index=$3 AND source_hash=$4 AND embedding_model=$5",[userId,meeting.id,chunk.index,chunk.source_hash,embeddingModel]));
 if(exists.rowCount)return false;
 const vector=await embed(userId,chunk.text);
 return withTenant(userId,async db=>{
  const current=(await db.query<CoachMeeting>("SELECT id,nome,original_filename,recorded_at,transcription,segments,speaker_labels,speaker_pessoas FROM meetings WHERE user_id=$1 AND id=$2 AND status='done' FOR SHARE",[userId,meeting.id])).rows[0];
  const profile=(await db.query("SELECT enabled,revision FROM coach_profiles WHERE user_id=$1 FOR SHARE",[userId])).rows[0];
  if(!profile?.enabled||(revision!==undefined&&profile.revision!==revision)||!current||sourceHash(current)!==chunk.source_hash)return false;
  await db.query("INSERT INTO coach_semantic_chunks(user_id,meeting_id,chunk_index,source_hash,embedding,embedding_model) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,meeting_id,chunk_index) DO UPDATE SET source_hash=EXCLUDED.source_hash,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,indexed_at=now()",[userId,meeting.id,chunk.index,chunk.source_hash,vector,embeddingModel]);
  return true;
 });
}
export async function semanticSearch(userId:string,query:string,signal?:AbortSignal){
 if(!semanticEnabled())return {available:false,matches:[],limitations:["Busca semântica não ativada; a busca textual e a leitura de fontes continuam disponíveis."]};
 const rows=await withTenant(userId,db=>db.query<{meeting_id:string;chunk_index:number;source_hash:string;embedding:number[];total:number}>(
  "SELECT meeting_id,chunk_index,source_hash,embedding,count(*) OVER()::int AS total FROM coach_semantic_chunks WHERE user_id=$1 AND embedding_model=$2 ORDER BY indexed_at DESC,meeting_id,chunk_index LIMIT 10000",[userId,embeddingModel]));
 if(!rows.rows.length)return {available:true,matches:[],limitations:["O índice semântico ainda está sendo preparado; consulte também a busca textual."]};
 const vector=await embed(userId,query,signal);
 return {available:true,matches:rows.rows.map(r=>({meeting_id:r.meeting_id,chunk_index:r.chunk_index,source_hash:r.source_hash,score:cosine(vector,r.embedding)})).sort((a,b)=>b.score-a.score).slice(0,12),
 limitations:[`Busca semântica considerou ${rows.rows.length} de ${rows.rows[0].total} partes indexadas. Fontes são verificadas novamente antes da leitura.`]};
}
export async function recordModelRuns(userId:string,purpose:string,runKey:string|null,events:CoachTelemetry[],revision?:number){
 for(const event of events){
  // Spend is recorded even when the Coach telemetry below is skipped (stale run, Coach off): it was paid.
  const id=randomUUID();
  if(event.costUsd||event.inputTokens||event.outputTokens)await recordAiUsage({ref:`coach_run:${id}`,agent:coachAgent(purpose),provider:event.provider,model:event.model,source:"app",userId,
   inputTokens:event.inputTokens,cachedTokens:event.cachedInputTokens,cacheWriteTokens:event.cacheWriteTokens||0,outputTokens:event.outputTokens,costUsd:event.costUsd||0,
   basis:event.usageComplete?"medido":"estimado",note:event.usageComplete?null:"Consumo incompleto na resposta da IA."});
  await withTenant(userId,async db=>{
   const profile=(await db.query("SELECT revision,enabled FROM coach_profiles WHERE user_id=$1 FOR SHARE",[userId])).rows[0];
   if(!profile?.enabled||(revision!==undefined&&profile.revision!==revision))return;
   await db.query("INSERT INTO coach_model_runs(id,user_id,run_key,purpose,provider,model,input_tokens,output_tokens,duration_ms,tool_calls,success,cached_input_tokens,usage_complete,cache_write_tokens,cost_usd) VALUES($15,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [userId,runKey,purpose,event.provider,event.model,event.inputTokens,event.outputTokens,event.latencyMs,event.toolCalls,event.success,event.cachedInputTokens,event.usageComplete,event.cacheWriteTokens||0,event.costUsd||0,id]);
  });
 }
}

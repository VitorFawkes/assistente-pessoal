import { COACH_SYSTEM } from "./framework";
export const coachModel=()=>process.env.COACH_MODEL||"gpt-5.1";
const str={type:"string"};
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const array=(items:unknown)=>({type:"array",items});
const observation=object({competency:{type:"string",enum:["focus","judgment","communication","delegation","commitments","self_awareness"]},observation:str,hypothesis:str,alternative:str,experiment:str,evidence:array(object({meeting_id:str,chunk_index:{type:"integer"},quote:str}))});
export const analysisSchema=object({summary:str,observations:array(observation)});
export const conversationSchema=object({answer:str,observations:array(observation),memories:array(object({content:str,kind:{type:"string",enum:["pattern","experiment"]},observation_index:{type:"integer"}}))});
export const reviewSchema=object({headline:str,focus:str,observations:array(observation),progress:str,experiment:str,question:str,limitations:array(str)});
export function withoutObservations(schema: typeof reviewSchema){return {...schema,properties:{...schema.properties,observations:{...array(observation),maxItems:0}}};}
export function reviewSchemaWithSources(ids:string[]){
 if(!ids.length)return withoutObservations(reviewSchema);
 return object({headline:str,focus:str,observations:array(object({competency:observation.properties.competency,observation:str,hypothesis:str,alternative:str,experiment:str,evidence_ids:array({type:"string",enum:ids})})),progress:str,experiment:str,question:str,limitations:array(str)});
}
export function conversationSchemaWithSources(ids:string[]){
 if(!ids.length)return withoutObservations(conversationSchema);
 return object({answer:str,observations:array(object({competency:observation.properties.competency,observation:str,hypothesis:str,alternative:str,experiment:str,evidence_ids:array({type:"string",enum:ids})})),memories:conversationSchema.properties.memories});
}
export function analysisSchemaWithSources(ids:string[]){
 if(!ids.length)return withoutObservations(analysisSchema);
 return object({summary:str,observations:array(object({competency:observation.properties.competency,observation:str,hypothesis:str,alternative:str,experiment:str,evidence_ids:array({type:"string",enum:ids})}))});
}
export class CoachAIError extends Error {}
export async function coachCompletion(instruction:string,data:unknown,schema:unknown):Promise<Record<string,unknown>>{
 const key=process.env.OPENAI_API_KEY; if(!key)throw new CoachAIError("A IA do coach ainda não está configurada no servidor.");
 let res:Response;
 try {res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:coachModel(),store:false,max_completion_tokens:7000,reasoning_effort:"low",response_format:{type:"json_schema",json_schema:{name:"coach_result",strict:true,schema}},messages:[{role:"system",content:COACH_SYSTEM+"\n"+instruction},{role:"user",content:JSON.stringify(data)}]}),signal:AbortSignal.timeout(100000)});}catch{throw new CoachAIError("A IA não respondeu a tempo. Tente novamente; seu histórico está preservado.");}
 if(!res.ok)throw new CoachAIError(res.status===429?"A IA está no limite de uso. Tente novamente em alguns minutos.":"Não foi possível consultar a IA do coach. Tente novamente.");
 const body=await res.json(); const message=body.choices?.[0]?.message;
 if(body.choices?.[0]?.finish_reason!=="stop"||message?.refusal)throw new CoachAIError("A IA não concluiu uma resposta válida. Tente uma pergunta mais específica.");
 try{const parsed=JSON.parse(message.content); if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error(); return parsed;}catch{throw new CoachAIError("A resposta da IA veio em formato inválido. Tente novamente.");}
}

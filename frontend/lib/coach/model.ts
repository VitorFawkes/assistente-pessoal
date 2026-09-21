import {localContextDates,contextTimezone} from "./context-dates";
import { COACH_SYSTEM } from "./framework";
import { userMemoryCandidates, userMemoryKind } from "./conversation-memory";
import { providerCompletion, type CoachCompletionOptions } from "./provider";
export { CoachAIError, coachModel, coachModelAvailable, coachModelConfig } from "./provider";
export type { CoachReadTool, CoachCompletionOptions, CoachTelemetry, CoachRole, CoachProvider, CoachReasoningEffort } from "./provider";
const str={type:"string"};
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const array=(items:unknown)=>({type:"array",items});
const observation=object({competency:{type:"string",enum:["focus","judgment","communication","delegation","commitments","self_awareness"]},observation:str,hypothesis:str,alternative:str,experiment:str,evidence:array(object({meeting_id:str,chunk_index:{type:"integer"},quote:str}))});
export const analysisSchema=object({summary:str,observations:array(observation)});
const userMemories={...array(object({kind:{type:"string",enum:["goal","context","experiment"]},quote:{type:"string",minLength:8,maxLength:900}})),maxItems:2};
export const conversationSchema=object({answer:str,user_memories:userMemories,observations:array(observation),memories:array(object({content:str,kind:{type:"string",enum:["pattern","experiment"]},observation_index:{type:"integer"}}))});
export const reviewSchema=object({headline:str,focus:str,observations:array(observation),progress:str,experiment:str,question:str,limitations:array(str)});
export function withoutObservations(schema: typeof reviewSchema){return {...schema,properties:{...schema.properties,observations:{...array(observation),maxItems:0}}};}
export function reviewSchemaWithSources(ids:string[]){
 const headline={type:"string",minLength:1,maxLength:100};
 if(!ids.length)return withoutObservations({...reviewSchema,properties:{...reviewSchema.properties,headline}});
 return object({headline,focus:str,observations:{...array(object({competency:observation.properties.competency,observation:str,hypothesis:str,alternative:str,experiment:{type:"string",enum:[""]},evidence_ids:array({type:"string",enum:ids})})),maxItems:2},progress:str,experiment:str,question:str,limitations:array(str)});
}
export function conversationSchemaWithSources(ids:string[],message="",options:{actions?:unknown;detailed?:boolean}={}){
 const concise={type:"string",minLength:1,maxLength:400};
 const quotes=userMemoryCandidates(message);
 const noteVariants=(["goal","context","experiment"] as const).flatMap(kind=>{
  const matching=quotes.filter(quote=>userMemoryKind(quote)===kind);
  return matching.length?[object({kind:{type:"string",enum:[kind]},quote:{type:"string",enum:matching}})]:[];
 });
 const userNotes={...array(noteVariants.length?{anyOf:noteVariants}:object({kind:str,quote:str})),maxItems:noteVariants.length?2:0};
 const groundedMemories={...array(object({content:str,kind:{type:"string",enum:["pattern","experiment"]},observation_index:{type:"integer",minimum:0,maximum:0}})),maxItems:ids.length?2:0};
 const observations=ids.length
  ? {...array(object({competency:observation.properties.competency,observation:concise,hypothesis:concise,alternative:concise,experiment:{type:"string",maxLength:400},evidence_ids:{...array({type:"string",enum:ids}),minItems:1,maxItems:4}})),maxItems:1}
  : {...array(observation),maxItems:0};
 return object({answer:{type:"string",minLength:1,maxLength:options.detailed?10000:1000},observations,memories:groundedMemories,user_memories:userNotes,...(options.actions?{actions:options.actions}:{})});
}
export function analysisSchemaWithSources(ids:string[]){
 if(!ids.length)return withoutObservations(analysisSchema);
 return object({summary:str,observations:array(object({competency:observation.properties.competency,observation:str,hypothesis:str,alternative:str,experiment:str,evidence_ids:array({type:"string",enum:ids})}))});
}
export async function coachCompletion(instruction:string,data:unknown,schema:unknown,options:CoachCompletionOptions={}):Promise<Record<string,unknown>>{
 const timezone=contextTimezone(data);
 const tools=options.tools?.map(tool=>({...tool,execute:async(args:Record<string,unknown>,context:{signal:AbortSignal})=>localContextDates(await tool.execute(args,context),timezone)}));
 return providerCompletion(COACH_SYSTEM+"\n"+instruction,localContextDates(data,timezone),schema,{...options,tools});
}

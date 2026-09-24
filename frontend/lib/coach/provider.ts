import { anthropicSchema, matchesCoachSchema, validCoachSchema, type CoachJsonSchema } from './provider-schema';

export class CoachAIError extends Error {}
/** Rate limit, outage, timeout or network failure before any result: scheduled work may retry later. */
export class CoachProviderUnavailableError extends CoachAIError {}
export type CoachProvider = 'openai'|'anthropic'|'kimi';
export type CoachRole = 'primary'|'reviewer'|'tasks';
export type CoachReasoningEffort = 'low'|'medium'|'high';
export type CoachReadTool = {
 name:string; description:string; parameters:unknown;
 /** Read-only and owner-scoped by the application. No arbitrary SQL, URL or user identity. */
 execute:(args:Record<string,unknown>,context:{signal:AbortSignal})=>Promise<unknown>;
};
export type CoachTelemetry = {
 provider:CoachProvider; model:string; role:CoachRole; reasoningEffort:CoachReasoningEffort; effectiveReasoningEffort:CoachReasoningEffort|'max';
 requests:number; toolCalls:number; inputTokens:number; outputTokens:number; cachedInputTokens:number;
 usageComplete:boolean; latencyMs:number; success:boolean;
 httpStatus?:number; providerErrorType?:string; providerErrorCode?:string; providerErrorParam?:string;
};
export type CoachCompletionOptions = {
 role?:CoachRole; reasoningEffort?:CoachReasoningEffort; tools?:CoachReadTool[];
 maxToolRounds?:number; maxToolCalls?:number; timeoutMs?:number; signal?:AbortSignal;
 onTelemetry?:(event:CoachTelemetry)=>void;
};
const invalid = ()=>new CoachAIError('A IA não concluiu uma resposta válida. Tente uma pergunta mais específica.');
const configError = ()=>new CoachAIError('O modelo do coach não está configurado ou autorizado para este papel.');
const cancelled = ()=>new CoachProviderUnavailableError('A consulta foi interrompida ou demorou demais. Tente novamente; seu histórico está preservado.');
const isObject = (v:unknown):v is Record<string,unknown> => !!v&&typeof v==='object'&&!Array.isArray(v);
const providerCategories=new Set(['invalid_request_error','authentication_error','permission_error','not_found_error','rate_limit_error','overloaded_error','api_error','model_not_found','invalid_api_key','permission_denied','insufficient_quota','rate_limit_exceeded','billing_hard_limit_reached','unsupported_parameter','unsupported_value','invalid_value','invalid_json_schema','schema_validation_error','context_length_exceeded','request_too_large']);
const providerParams=new Set(['model','messages','response_format','tools','tool_choice','reasoning_effort','max_completion_tokens','max_tokens','thinking','output_config','reasoning','input','text','max_output_tokens','include']);
function safeProviderCategory(value:unknown){return typeof value==='string'&&providerCategories.has(value)?value:'unknown';}
const count = (v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;

// A closed list prevents opaque aliases such as "best" or "gpt-6" from resolving
// to Astra/Fable. There is no user-configurable endpoint, alias map or fallback.
function allowedModel(provider:CoachProvider,model:string){
 if(/astra|fable/i.test(model))return false;
 if(provider==='kimi')return model==='kimi-k3';
 return provider==='openai'
  ? /^(?:gpt-5\.1|gpt-5\.5|gpt-5\.6-(?:sol|terra|luna)|gpt-6-(?:sol|luna))(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
  : /^claude-(?:(?:opus|sonnet)-(?:5|4[.-]6))(?:-\d{8})?$/.test(model);
}
export function coachModelConfig(role:CoachRole='primary'):{provider:CoachProvider;model:string}{
 // The task interpreter is a short classification: it can use a cheaper model (COACH_TASKS_*), falling back to the primary one.
 const providerValue=role==='reviewer'?process.env.COACH_REVIEW_PROVIDER:role==='tasks'&&process.env.COACH_TASKS_PROVIDER||process.env.COACH_PROVIDER||'openai';
 const model=role==='reviewer'?process.env.COACH_REVIEW_MODEL:role==='tasks'&&process.env.COACH_TASKS_MODEL||process.env.COACH_MODEL||(providerValue==='openai'?'gpt-5.1':undefined);
 if((providerValue!=='openai'&&providerValue!=='anthropic'&&providerValue!=='kimi')||!model||!allowedModel(providerValue,model))throw configError();
 return {provider:providerValue,model};
}
export function coachModel(role:CoachRole='primary'){return coachModelConfig(role).model;}
/** Configuration/key presence only, not a remote availability or entitlement check. */
export function coachModelAvailable(role:CoachRole='primary'){try{const config=coachModelConfig(role);return !!process.env[keyName(config.provider)];}catch{return false;}}

const keyName=(provider:CoachProvider)=>provider==='openai'?'OPENAI_API_KEY':provider==='kimi'?'KIMI_API_KEY':'ANTHROPIC_API_KEY';

function bounded(value:number|undefined,fallback:number,max:number,min=0){
 if(value===undefined)return fallback;
 if(!Number.isInteger(value)||value<min||value>max)throw configError();return value;
}
function validateTools(tools:CoachReadTool[]){
 if(tools.length>12||new Set(tools.map(t=>t.name)).size!==tools.length)throw configError();
 for(const tool of tools)if(!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)||!tool.description||!validCoachSchema(tool.parameters)||tool.parameters.type!=='object'||typeof tool.execute!=='function')throw configError();
}
async function abortable<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)throw cancelled();
 return new Promise<T>((resolve,reject)=>{
  const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{if(signal.aborted)throw cancelled();return work();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
function readSchema(schema:unknown):CoachJsonSchema{
 const result=typeof schema==='function'?schema():schema;
 if(!validCoachSchema(result)||result.type!=='object')throw configError();return result;
}
function parseResult(content:unknown,schema:CoachJsonSchema){
 if(typeof content!=='string'||content.length>120000)throw invalid();
 let parsed:unknown;try{parsed=JSON.parse(content);}catch{throw invalid();}
 if(!isObject(parsed)||!matchesCoachSchema(parsed,schema))throw invalid();return parsed;
}
function toolArgs(value:unknown,tool:CoachReadTool){
 let args=value;if(typeof value==='string'){if(value.length>16000)throw invalid();try{args=JSON.parse(value);}catch{throw invalid();}}
 if(!isObject(args)||!matchesCoachSchema(args,tool.parameters as CoachJsonSchema))throw invalid();return args;
}
function toolResult(value:unknown){
 const text=JSON.stringify(value);if(!text||text.length>100000)throw invalid();return text;
}

/** Provider-neutral bounded read/investigate/synthesize loop. No content is logged. */
export async function providerCompletion(system:string,data:unknown,schema:unknown,options:CoachCompletionOptions={}):Promise<Record<string,unknown>>{
 const role=options.role||'primary';const {provider,model}=coachModelConfig(role);
 // Protocol is selected before the first request; there is no downgrade/retry.
 const responses=provider==='openai'&&/^gpt-(?:5\.[56]|6)(?:-|$)/.test(model);
 const key=process.env[keyName(provider)];
 if(!key)throw new CoachAIError('A IA do coach ainda não está configurada no servidor.');
 const effort=options.reasoningEffort||'low';if(!['low','medium','high'].includes(effort))throw configError();
 const effectiveEffort=provider==='kimi'?(effort==='medium'?'high':effort==='high'?'max':'low'):effort;
 const tools=options.tools||[];validateTools(tools);
 const maxRounds=bounded(options.maxToolRounds,3,6);const maxCalls=bounded(options.maxToolCalls,6,12);
 const timeoutMs=bounded(options.timeoutMs,100000,180000,1);
 const controller=new AbortController();const abort=()=>controller.abort();const timer=setTimeout(abort,timeoutMs);timer.unref?.();
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const signal=controller.signal;const start=Date.now();let usageResponses=0;
 const metrics:CoachTelemetry={provider,model,role,reasoningEffort:effort,effectiveReasoningEffort:effectiveEffort,requests:0,toolCalls:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,usageComplete:true,latencyMs:0,success:false};
 try{
  const serialized=JSON.stringify(data);if(typeof serialized!=='string')throw invalid();
  const messages:Record<string,unknown>[]=provider!=='anthropic'?[{role:'system',content:system},{role:'user',content:serialized}]:[{role:'user',content:serialized}];
  for(let round=0;round<=maxRounds;round++){
   if(signal.aborted)throw cancelled();const currentSchema=readSchema(schema);
   const canRead=tools.length>0&&round<maxRounds&&metrics.toolCalls<maxCalls;
   const toolsDisabled=tools.length>0&&!canRead;
   const body=responses?{
    model,store:false,max_output_tokens:7000,reasoning:{effort},input:messages,
    include:['reasoning.encrypted_content'],
    text:{format:{type:'json_schema',name:'coach_result',strict:true,schema:currentSchema}},
    ...(tools.length?{tools:tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters,strict:true})),parallel_tool_calls:false,tool_choice:toolsDisabled?'none':'auto'}:{}),
   }:provider!=='anthropic'?{
    model,...(provider==='openai'?{store:false}:{}),max_completion_tokens:7000,reasoning_effort:effectiveEffort,
    response_format:{type:'json_schema',json_schema:{name:'coach_result',strict:true,schema:currentSchema}},messages,
    ...(tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters,strict:true}})),...(provider==='openai'?{parallel_tool_calls:false}:{}),tool_choice:toolsDisabled?'none':'auto'}:{}),
   }:{
    model,system,max_tokens:7000,messages,output_config:{effort,format:{type:'json_schema',schema:anthropicSchema(currentSchema)}},
    ...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:anthropicSchema(t.parameters as CoachJsonSchema),strict:true})),tool_choice:{type:toolsDisabled?'none':'auto'}}:{}),
   };
   metrics.requests++;
   const res=await abortable(()=>fetch(responses?'https://api.openai.com/v1/responses':provider==='openai'?'https://api.openai.com/v1/chat/completions':provider==='kimi'?'https://api.moonshot.ai/v1/chat/completions':'https://api.anthropic.com/v1/messages',{
    method:'POST',headers:provider!=='anthropic'?{'Content-Type':'application/json',Authorization:`Bearer ${key}`}:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify(body),signal,
   }).catch(()=>{throw new CoachProviderUnavailableError('Não foi possível concluir a consulta do coach. Seu histórico está preservado.');}),signal);
   if(!res.ok){
    metrics.httpStatus=res.status;
    try{const detail:unknown=await abortable(()=>res.json(),signal);const error=isObject(detail)&&isObject(detail.error)?detail.error:{};
     metrics.providerErrorType=safeProviderCategory(error.type);metrics.providerErrorCode=safeProviderCategory(error.code);
     const param=typeof error.param==='string'?error.param.split(/[.\[]/,1)[0]:'';metrics.providerErrorParam=providerParams.has(param)?param:'unknown';
    }catch{/* Never expose remote bodies, including HTML errors or partial JSON. */}
    const unavailable=res.status===408||res.status===429||res.status>=500;
    throw new (unavailable?CoachProviderUnavailableError:CoachAIError)(res.status===429?'A IA está no limite de uso. Tente novamente em alguns minutos.':'Não foi possível consultar a IA do coach. Tente novamente.');
   }
   const response:unknown=await abortable(()=>res.json(),signal);if(!isObject(response))throw invalid();
   const usage=isObject(response.usage)?response.usage:null;
   const inputTokenKey=responses||provider==='anthropic'?'input_tokens':'prompt_tokens';
   const outputTokenKey=responses||provider==='anthropic'?'output_tokens':'completion_tokens';
   if(!usage||typeof usage[inputTokenKey]!=='number'||typeof usage[outputTokenKey]!=='number')metrics.usageComplete=false;else usageResponses++;
   metrics.inputTokens+=count(usage?.[inputTokenKey]);metrics.outputTokens+=count(usage?.[outputTokenKey]);
   metrics.cachedInputTokens+=responses?count(isObject(usage?.input_tokens_details)?usage.input_tokens_details.cached_tokens:0):provider!=='anthropic'?count(isObject(usage?.prompt_tokens_details)?usage.prompt_tokens_details.cached_tokens:0):count(usage?.cache_read_input_tokens);
   if(provider==='anthropic')metrics.inputTokens+=count(usage?.cache_read_input_tokens)+count(usage?.cache_creation_input_tokens);
   let calls:{id:string;name:string;args:unknown}[]=[];let assistantItems:Record<string,unknown>[];
   if(responses){
    if(response.status!=='completed'||!Array.isArray(response.output)||!response.output.every(isObject))throw invalid();
    // Preserve all output items, including encrypted reasoning and phase metadata.
    // store:false disables response-object storage; it is not a zero-retention promise.
    // Replay state explicitly instead of relying on a stored response ID.
    assistantItems=response.output;
    calls=assistantItems.filter(item=>item.type==='function_call').map(item=>{if(typeof item.call_id!=='string'||typeof item.name!=='string')throw invalid();return {id:item.call_id,name:item.name,args:item.arguments};});
    const content=assistantItems.filter(item=>item.type==='message').flatMap(item=>Array.isArray(item.content)?item.content:[]);
    if(content.some(item=>!isObject(item)||item.type==='refusal'))throw invalid();
    if(!calls.length){const text=content.filter(item=>isObject(item)&&item.type==='output_text').map(item=>item.text).join('');const result=parseResult(text,currentSchema);metrics.success=true;return result;}
   }else if(provider!=='anthropic'){
    const choice=Array.isArray(response.choices)?response.choices[0]:null;
    if(!isObject(choice)||!isObject(choice.message)||choice.message.refusal)throw invalid();
    const assistant=choice.message;assistantItems=[assistant];
    if(choice.finish_reason==='stop'){
     if(Array.isArray(assistant.tool_calls)&&assistant.tool_calls.length)throw invalid();
     const result=parseResult(assistant.content,currentSchema);metrics.success=true;return result;
    }
    if(choice.finish_reason!=='tool_calls'||!Array.isArray(assistant.tool_calls)||!assistant.tool_calls.length)throw invalid();
    calls=assistant.tool_calls.map(c=>{if(!isObject(c)||c.type!=='function'||typeof c.id!=='string'||!isObject(c.function)||typeof c.function.name!=='string')throw invalid();return {id:c.id,name:c.function.name,args:c.function.arguments};});
   }else{
    if(!Array.isArray(response.content))throw invalid();
    assistantItems=[{role:'assistant',content:response.content}];
    if(response.stop_reason==='end_turn'){
     if(response.content.some(c=>!isObject(c)||c.type==='refusal'||c.type==='tool_use'))throw invalid();
     const text=response.content.filter(c=>isObject(c)&&c.type==='text').map(c=>c.text).join('');
     const result=parseResult(text,currentSchema);metrics.success=true;return result;
    }
    if(response.stop_reason!=='tool_use')throw invalid();
    calls=response.content.filter(c=>isObject(c)&&c.type==='tool_use').map(c=>{if(typeof c.id!=='string'||typeof c.name!=='string')throw invalid();return {id:c.id,name:c.name,args:c.input};});
   }
   if(!canRead||!calls.length||metrics.toolCalls+calls.length>maxCalls||new Set(calls.map(c=>c.id)).size!==calls.length)throw invalid();
   // Validate the entire batch before executing any read, so malformed calls
   // cannot cause partial execution or select another tenant through extra args.
   const prepared=calls.map(call=>{const tool=tools.find(t=>t.name===call.name);if(!tool)throw invalid();return {call,tool,args:toolArgs(call.args,tool)};});
   messages.push(...assistantItems);const results:Record<string,unknown>[]=[];
   for(const {call,tool,args} of prepared){
    metrics.toolCalls++;const result=toolResult(await abortable(()=>tool.execute(args,{signal}),signal));
    if(responses)messages.push({type:'function_call_output',call_id:call.id,output:result});
    else if(provider!=='anthropic')messages.push({role:'tool',tool_call_id:call.id,content:result});
    else results.push({type:'tool_result',tool_use_id:call.id,content:result});
   }
   if(provider==='anthropic')messages.push({role:'user',content:results});
  }
  throw invalid();
 }catch(error){
  if(error instanceof CoachAIError)throw error;
  if(signal.aborted)throw cancelled();
  // Remote response bodies, fetch errors, tool failures and JSON never reach UI.
  throw new CoachAIError('Não foi possível concluir a consulta do coach. Seu histórico está preservado.');
 }finally{
  if(metrics.requests>usageResponses)metrics.usageComplete=false;
  clearTimeout(timer);options.signal?.removeEventListener('abort',abort);metrics.latencyMs=Date.now()-start;
  try{options.onTelemetry?.({...metrics});}catch{/* Metrics must not break a completed private response. */}
 }
}

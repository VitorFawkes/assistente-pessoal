import { afterEach, beforeEach, expect, test } from 'bun:test';
import { analysisSchema, coachCompletion, CoachAIError, CoachProviderUnavailableError } from './model';

const originalFetch = globalThis.fetch;
const envKeys = ['COACH_MODEL','COACH_PROVIDER','COACH_REVIEW_MODEL','COACH_REVIEW_PROVIDER','OPENAI_API_KEY','ANTHROPIC_API_KEY','KIMI_API_KEY'];
let originalEnv: Record<string,string|undefined>;
beforeEach(() => { originalEnv = Object.fromEntries(envKeys.map(k=>[k,process.env[k]])); for (const k of envKeys) delete process.env[k]; process.env.OPENAI_API_KEY='synthetic-key'; });
afterEach(() => {globalThis.fetch=originalFetch;for(const k of envKeys){if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}});
function reply(content: unknown, usage?:unknown) {return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}],usage});}
const valid = {summary:'ok',observations:[]};
const parameters = {type:'object',properties:{query:{type:'string',minLength:1}},required:['query'],additionalProperties:false};

test('expensive models and unrecognized aliases cannot reach any provider in either role',async()=>{
 let requests=0; globalThis.fetch=(async()=>{requests++;return reply(valid);}) as unknown as typeof fetch;
 for(const model of ['gpt-6-astra','ASTRA','openai/gpt-6','gpt-6','claude-fable-5-1','FABLE','anthropic/claude-fable-latest','best','latest']){
  process.env.COACH_MODEL=model;
  await expect(coachCompletion('',{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);
  process.env.COACH_MODEL='gpt-5.1';process.env.COACH_REVIEW_PROVIDER='openai';process.env.COACH_REVIEW_MODEL=model;
  await expect(coachCompletion('',{},analysisSchema,{role:'reviewer'})).rejects.toBeInstanceOf(CoachAIError);
 }
 expect(requests).toBe(0);
});
test('reviewer needs explicit provider, model and its key without silent fallback',async()=>{
 let requests=0;globalThis.fetch=(async()=>{requests++;return reply(valid);}) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema,{role:'reviewer'})).rejects.toBeInstanceOf(CoachAIError);
 process.env.COACH_REVIEW_PROVIDER='anthropic';process.env.COACH_REVIEW_MODEL='claude-opus-5';
 await expect(coachCompletion('',{},analysisSchema,{role:'reviewer'})).rejects.toBeInstanceOf(CoachAIError);
 expect(requests).toBe(0);
});
test('OpenAI tools can retrieve new evidence and update the final schema',async()=>{
 const bodies:Record<string,unknown>[]=[];let retrieved=false;
 globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{
  expect(String(url)).toBe('https://api.openai.com/v1/chat/completions'); const body=JSON.parse(String(init?.body));bodies.push(body);
  if(bodies.length===1)return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'search_history',arguments:'{"query":"delegation"}'}}]}}]});
  expect(body.messages.at(-1)).toMatchObject({role:'tool',tool_call_id:'call_1',content:'{"source_id":"new-source"}'});
  expect(body.response_format.json_schema.schema.properties.source_id.enum).toEqual(['new-source']);
  return reply({source_id:'new-source'});
 }) as unknown as typeof fetch;
 const result=await coachCompletion('inspect',{},()=>({type:'object',properties:{source_id:{type:'string',enum:retrieved?['new-source']:['initial']}},required:['source_id'],additionalProperties:false}),{reasoningEffort:'high',tools:[{name:'search_history',description:'Read scoped history',parameters,execute:async(args)=>{expect(args.query).toBe('delegation');retrieved=true;return {source_id:'new-source'};}}]});
 expect(result).toEqual({source_id:'new-source'});expect(bodies.length).toBe(2);expect(bodies[0].reasoning_effort).toBe('high');
});
test('invalid tool arguments fail closed before execution and cannot leak provider text',async()=>{
 let executions=0;globalThis.fetch=(async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'x',type:'function',function:{name:'search_history',arguments:'{"query":"private","user_id":"other"}'}}]}}]})) as unknown as typeof fetch;
 try{await coachCompletion('',{},analysisSchema,{tools:[{name:'search_history',description:'Read',parameters,execute:async()=>{executions++;return {};}}]});throw new Error('must reject');}catch(error){expect(error).toBeInstanceOf(CoachAIError);expect((error as Error).message).not.toContain('private');}
 expect(executions).toBe(0);
});
test('bounded investigation stops tools and makes one final synthesis request',async()=>{
 let requests=0;let executions=0;
 globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{requests++;const body=JSON.parse(String(init?.body));if(requests===1)return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'x',type:'function',function:{name:'search_history',arguments:'{"query":"one"}'}}]}}]});expect(body.tool_choice).toBe('none');return reply(valid);}) as unknown as typeof fetch;
 expect(await coachCompletion('',{},analysisSchema,{maxToolRounds:1,tools:[{name:'search_history',description:'Read',parameters,execute:async()=>{executions++;return {};}}]})).toEqual(valid);
 expect(executions).toBe(1);expect(requests).toBe(2);
});
test('Anthropic preserves thinking blocks during tool round trip and sends supported structured schema',async()=>{
 process.env.COACH_PROVIDER='anthropic';process.env.COACH_MODEL='claude-opus-5';process.env.ANTHROPIC_API_KEY='synthetic-anthropic';
 const content=[{type:'thinking',thinking:'synthetic opaque',signature:'signed'},{type:'tool_use',id:'t1',name:'search_history',input:{query:'focus'}}];let count=0;
 globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{count++;expect(String(url)).toBe('https://api.anthropic.com/v1/messages');const body=JSON.parse(String(init?.body));expect(new Headers(init?.headers).get('x-api-key')).toBe('synthetic-anthropic');expect(body.output_config.effort).toBe('high');expect(body.output_config.format.schema.properties.answer.maxLength).toBeUndefined();expect(body.output_config.format.schema.properties.answer.description).toContain('maxLength');
 if(count===1)return Response.json({content,stop_reason:'tool_use',usage:{input_tokens:12,output_tokens:5}});
 expect(body.messages[1].content).toEqual(content);expect(body.messages[2].content[0]).toMatchObject({type:'tool_result',tool_use_id:'t1'});
 return Response.json({content:[{type:'text',text:'{"answer":"ok"}'}],stop_reason:'end_turn',usage:{input_tokens:20,output_tokens:4}});
 }) as unknown as typeof fetch;
 expect(await coachCompletion('',{}, {type:'object',properties:{answer:{type:'string',maxLength:3}},required:['answer'],additionalProperties:false},{reasoningEffort:'high',tools:[{name:'search_history',description:'Read',parameters,execute:async()=>({})}]})).toEqual({answer:'ok'});
});
test('local schema validation rejects valid JSON with invalid values',async()=>{
 for(const content of [{summary:'ok',observations:[],private:'x'},{summary:9,observations:[]},{summary:'ok'}]){
  globalThis.fetch=(async()=>reply(content)) as unknown as typeof fetch;await expect(coachCompletion('',{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);
 }
});
test('telemetry contains usage and timing without private input or output',async()=>{
 let telemetry:unknown;
 globalThis.fetch=(async()=>reply(valid,{prompt_tokens:30,completion_tokens:8,prompt_tokens_details:{cached_tokens:10}})) as unknown as typeof fetch;
 await coachCompletion('private instruction',{personal:'sensitive'},analysisSchema,{onTelemetry:event=>{telemetry=event;}});
 expect(telemetry).toMatchObject({provider:'openai',model:'gpt-5.1',role:'primary',requests:1,toolCalls:0,inputTokens:30,outputTokens:8,cachedInputTokens:10,success:true});
 expect(JSON.stringify(telemetry)).not.toContain('private');expect(JSON.stringify(telemetry)).not.toContain('sensitive');expect(JSON.stringify(telemetry)).not.toContain('summary');
});
test('an already cancelled request makes no provider request',async()=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;return reply(valid);}) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema,{signal:AbortSignal.abort()})).rejects.toBeInstanceOf(CoachAIError);expect(calls).toBe(0);
});

test('provider outage does not call a second model or expose a remote exception',async()=>{
 let requests=0;globalThis.fetch=(async()=>{requests++;throw new Error('private token synthetic-key');}) as unknown as typeof fetch;
 try{await coachCompletion('',{},analysisSchema);throw new Error('must fail');}catch(error){expect(error).toBeInstanceOf(CoachAIError);expect((error as Error).message).not.toContain('private');expect((error as Error).message).not.toContain('synthetic-key');}
 expect(requests).toBe(1);
});
test('a tool that never finishes is cancelled by the whole-turn deadline',async()=>{
 let signal:AbortSignal|undefined;
 globalThis.fetch=(async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'x',type:'function',function:{name:'search_history',arguments:'{"query":"one"}'}}]}}]})) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema,{timeoutMs:25,tools:[{name:'search_history',description:'Read',parameters,execute:async(_args,context)=>{signal=context.signal;return new Promise(()=>{});}}]})).rejects.toBeInstanceOf(CoachAIError);
 expect(signal?.aborted).toBe(true);
});
test('unknown tools and over-budget tool batches never execute any read',async()=>{
 let reads=0;
 const tools=[{name:'search_history',description:'Read',parameters,execute:async()=>{reads++;return {};}}];
 for(const names of [['write_task'],['search_history','search_history']]){
  globalThis.fetch=(async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:names.map((name,i)=>({id:String(i),type:'function',function:{name,arguments:'{"query":"q"}'}}))}}]})) as unknown as typeof fetch;
  await expect(coachCompletion('',{},analysisSchema,{tools,maxToolCalls:1})).rejects.toBeInstanceOf(CoachAIError);
 }
 expect(reads).toBe(0);
});
test('Anthropic enforces numeric and array constraints locally after wire transformation',async()=>{
 process.env.COACH_PROVIDER='anthropic';process.env.COACH_MODEL='claude-opus-5';process.env.ANTHROPIC_API_KEY='synthetic';
 const schema={type:'object',properties:{notes:{type:'array',maxItems:1,items:{type:'object',properties:{index:{type:'integer',minimum:0,maximum:1}},required:['index'],additionalProperties:false}}},required:['notes'],additionalProperties:false};
 for(const content of [{notes:[{index:2}]},{notes:[{index:1},{index:0}]}]){
  globalThis.fetch=(async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(content)}]})) as unknown as typeof fetch;
  await expect(coachCompletion('',{},schema)).rejects.toBeInstanceOf(CoachAIError);
 }
});
test('telemetry marks incomplete token usage rather than pretending it was zero',async()=>{
 let complete:unknown;
 globalThis.fetch=(async()=>reply(valid,{})) as unknown as typeof fetch;
 await coachCompletion('',{},analysisSchema,{onTelemetry:event=>{complete=event.usageComplete;}});
 expect(complete).toBe(false);
});


test('Kimi is explicitly configured, preserves reasoning during reads, and validates JSON locally',async()=>{
 process.env.COACH_PROVIDER='kimi';process.env.COACH_MODEL='kimi-k3';process.env.KIMI_API_KEY='synthetic-kimi';
 let requests=0;let metrics:unknown;
 const assistant={role:'assistant',content:null,reasoning_content:'opaque synthetic reasoning',tool_calls:[{id:'k1',type:'function',function:{name:'search_history',arguments:'{"query":"focus"}'}}]};
 globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{
  requests++;expect(String(url)).toBe('https://api.moonshot.ai/v1/chat/completions');const body=JSON.parse(String(init?.body));expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-kimi');expect(body.reasoning_effort).toBe('high');expect(body.response_format).toMatchObject({type:'json_schema',json_schema:{strict:true,schema:{required:['summary','observations']}}});expect(body.store).toBeUndefined();
  if(requests===1)return Response.json({choices:[{finish_reason:'tool_calls',message:assistant}]});
  expect(body.messages[2]).toEqual(assistant);return reply(valid,{prompt_tokens:20,completion_tokens:4});
 }) as unknown as typeof fetch;
 expect(await coachCompletion('',{},analysisSchema,{reasoningEffort:'medium',tools:[{name:'search_history',description:'Read',parameters,execute:async()=>({})}],onTelemetry:event=>{metrics=event;}})).toEqual(valid);
 expect(metrics).toMatchObject({provider:'kimi',model:'kimi-k3',reasoningEffort:'medium',effectiveReasoningEffort:'high',requests:2});
 globalThis.fetch=(async()=>reply({summary:'ok',observations:[],unexpected:'private'})) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);
});
test('Kimi key is never borrowed from another provider',async()=>{
 process.env.COACH_PROVIDER='kimi';process.env.COACH_MODEL='kimi-k3';let requests=0;
 globalThis.fetch=(async()=>{requests++;return reply(valid);}) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);expect(requests).toBe(0);
});

test('invalid input serialization is sanitized and still emits failure telemetry',async()=>{
 const circular:Record<string,unknown>={};circular.self=circular;let requests=0;let failure:unknown;
 globalThis.fetch=(async()=>{requests++;return reply(valid);}) as unknown as typeof fetch;
 await expect(coachCompletion('',circular,analysisSchema,{onTelemetry:event=>{failure=event.success;}})).rejects.toBeInstanceOf(CoachAIError);
 expect(requests).toBe(0);expect(failure).toBe(false);
});

test('failed provider request emits sanitized category and marks usage incomplete',async()=>{
 let telemetry:unknown;globalThis.fetch=(async()=>Response.json({error:{message:'private prompt synthetic-key',type:'invalid_request_error',code:'unsupported_value',param:'reasoning_effort'}},{status:400})) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema,{onTelemetry:event=>{telemetry=event;}})).rejects.toBeInstanceOf(CoachAIError);
 expect(telemetry).toMatchObject({httpStatus:400,providerErrorType:'invalid_request_error',providerErrorCode:'unsupported_value',providerErrorParam:'reasoning_effort',usageComplete:false,success:false});
 expect(JSON.stringify(telemetry)).not.toContain('private');expect(JSON.stringify(telemetry)).not.toContain('synthetic-key');
});
test('unknown remote categories and parameter values never enter telemetry',async()=>{
 let telemetry:unknown;globalThis.fetch=(async()=>Response.json({error:{message:'secret value',type:'private_customer',code:'secret_customer',param:'messages[private_customer].content'}},{status:403})) as unknown as typeof fetch;
 await expect(coachCompletion('',{},analysisSchema,{onTelemetry:event=>{telemetry=event;}})).rejects.toBeInstanceOf(CoachAIError);
 expect(telemetry).toMatchObject({httpStatus:403,providerErrorType:'unknown',providerErrorCode:'unknown',providerErrorParam:'messages',usageComplete:false});expect(JSON.stringify(telemetry)).not.toContain('private_customer');
});

test('Sol uses Responses reasoning and preserves encrypted items across tool calls without storing',async()=>{
 process.env.COACH_MODEL='gpt-5.6-sol';let requests=0;let telemetry:unknown;
 const output=[{id:'rs_1',type:'reasoning',summary:[],encrypted_content:'opaque-encrypted'},{id:'fc_1',type:'function_call',call_id:'call_1',name:'search_history',arguments:'{"query":"focus"}',status:'completed'}];
 globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{
  requests++;expect(String(url)).toBe('https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));expect(body.store).toBe(false);expect(body.reasoning).toMatchObject({effort:'high'});expect(body.reasoning_effort).toBeUndefined();expect(body.text.format).toMatchObject({type:'json_schema',strict:true});expect(body.tools[0]).toMatchObject({type:'function',name:'search_history',strict:true});
  if(requests===1)return Response.json({status:'completed',output,usage:{input_tokens:30,output_tokens:10,input_tokens_details:{cached_tokens:5}}});
  expect(body.input.slice(2,4)).toEqual(output);expect(body.input.at(-1)).toEqual({type:'function_call_output',call_id:'call_1',output:'{"found":true}'});
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(valid)}]}],usage:{input_tokens:40,output_tokens:15,input_tokens_details:{cached_tokens:10}}});
 }) as unknown as typeof fetch;
 expect(await coachCompletion('',{},analysisSchema,{reasoningEffort:'high',tools:[{name:'search_history',description:'Read',parameters,execute:async()=>({found:true})}],onTelemetry:event=>{telemetry=event;}})).toEqual(valid);
 expect(telemetry).toMatchObject({inputTokens:70,outputTokens:25,cachedInputTokens:15,success:true,usageComplete:true});
});
test('Responses refuses incomplete output and refusal blocks',async()=>{
 process.env.COACH_MODEL='gpt-5.6-sol';
 for(const response of [{status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(valid)}]}]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]){
  globalThis.fetch=(async()=>Response.json(response)) as unknown as typeof fetch;
  await expect(coachCompletion('',{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);
 }
});

test('rate limits, outages and network failures are retryable; request errors are not',async()=>{
 for(const [status,retryable] of [[429,true],[500,true],[503,true],[408,true],[400,false],[401,false]] as const){
  globalThis.fetch=(async()=>Response.json({error:{type:'api_error',code:'x'}},{status})) as unknown as typeof fetch;
  const error=await coachCompletion('',{},analysisSchema).catch(caught=>caught);
  expect(error).toBeInstanceOf(CoachAIError);expect(error instanceof CoachProviderUnavailableError).toBe(retryable);
 }
 globalThis.fetch=(async()=>{throw new TypeError('fetch failed');}) as unknown as typeof fetch;
 expect(await coachCompletion('',{},analysisSchema).catch(caught=>caught)).toBeInstanceOf(CoachProviderUnavailableError);
});

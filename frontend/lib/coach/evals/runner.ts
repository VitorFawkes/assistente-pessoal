import { createHash, randomInt, randomUUID } from 'node:crypto';
import { constants, closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { COACH_CONVERSATION_INSTRUCTION, COACH_SYSTEM } from '../framework';
import { coachCompletion, coachModelAvailable, coachModelConfig, conversationSchemaWithSources, type CoachProvider, type CoachReadTool, type CoachTelemetry } from '../model';
import { cases, DATASET_VERSION } from './dataset';
import type { EvalCase, EvalMode, EvalOptions } from './types';

export const EVAL_HARNESS_VERSION='synthetic-context-adapter-v2-local-time';
export const PRICING_DATE='2026-09-23';
const PRICES:Record<string,{input:number;output:number;source:string}>={
 'gpt-5.1':{input:1.25,output:10,source:'https://developers.openai.com/api/docs/models/gpt-5.1'},
 'gpt-5.6-sol':{input:4,output:20,source:'https://developers.openai.com/api/docs/models/gpt-5.6-sol'},
 'gpt-6-sol':{input:2,output:10,source:'https://developers.openai.com/api/docs/models/gpt-6-sol'},
 'gpt-6-luna':{input:0.1,output:0.5,source:'https://developers.openai.com/api/docs/models/gpt-6-luna'},
 'claude-opus-5':{input:5,output:25,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'claude-opus-4-6':{input:5,output:25,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'claude-opus-4.6':{input:5,output:25,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'claude-sonnet-4-6':{input:3,output:15,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'claude-sonnet-4.6':{input:3,output:15,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'claude-sonnet-5':{input:2,output:10,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 'kimi-k3':{input:3,output:15,source:'https://forum.moonshot.ai/t/kimi-k3-is-here-our-most-capable-model/480'},
};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseModel=(model:string)=>model.replace(/(?:-\d{4}-\d{2}-\d{2}|-\d{8})$/,'');
export type EvalPlan={options:EvalOptions;selected:EvalCase[];provider:CoachProvider;model:string;price:typeof PRICES[string]};
export function preparePlan(options:EvalOptions):EvalPlan {
 if(process.env.COACH_EVAL_PAID!=='1')throw new Error('Ative COACH_EVAL_PAID=1 para uma execução paga explícita.');
 if(!options.run)throw new Error('É necessário --run.');
 if(!options.caseIds.length)throw new Error('Selecione casos explicitamente; nunca executamos o dataset inteiro por padrão.');
 if(!Number.isInteger(options.maxCalls)||options.maxCalls<1||options.maxCalls>240)throw new Error('Limite de chamadas deve ser de 1 a 240.');
 if(!Number.isFinite(options.maxUsd)||options.maxUsd<=0||options.maxUsd>20)throw new Error('Defina orçamento positivo de até US$ 20 por execução.');
 if(!['direct','investigate'].includes(options.mode))throw new Error('Modo de avaliação inválido.');
 const selected=new Set<string>();
 for(const id of options.caseIds){
  const match=cases.find(c=>c.id===id);const sequence=cases.filter(c=>`sequence:${c.sequence?.id}`===id);
  if(!match&&!sequence.length)throw new Error('Caso de avaliação desconhecido.');
  for(const c of match?[match]:sequence){
   if(c.sequence)for(const prior of cases.filter(p=>p.sequence?.id===c.sequence?.id&&p.sequence!.step<=c.sequence!.step))selected.add(prior.id);
   else selected.add(c.id);
  }
 }
 const config=coachModelConfig();if(!coachModelAvailable())throw new Error('Chave do provedor escolhido ausente.');
 const price=PRICES[baseModel(config.model)];if(!price)throw new Error('Modelo sem preço de referência revisado; não iniciar chamadas pagas.');
 return {options,selected:cases.filter(c=>selected.has(c.id)),...config,price};
}

/** Deterministic safety contracts, NOT a semantic coaching-quality judge. */
export function checkContracts(scenario:unknown,output:unknown):string[]{
 if(!object(scenario)||!object(output)||typeof output.answer!=='string'||!output.answer.trim()||!Array.isArray(output.observations)||!Array.isArray(output.memories)||!Array.isArray(output.user_memories))return ['invalid_output_shape'];
 const failures=new Set<string>();const sources=Array.isArray(scenario.sources)?scenario.sources.filter(object):[];
 const observations=output.observations;
 for(const observation of observations){
  if(!object(observation)||!Array.isArray(observation.evidence_ids)||!observation.evidence_ids.length){failures.add('observation_without_evidence');continue;}
  const evidence=observation.evidence_ids.map(id=>sources.find(s=>s.id===id));
  if(evidence.some(s=>!s))failures.add('unknown_evidence_id');
  if(!evidence.some(s=>s?.self_attributed===true))failures.add('observation_without_self_evidence');
 }
 for(const memory of output.memories)if(!object(memory)||!Number.isInteger(memory.observation_index)||Number(memory.observation_index)<0||Number(memory.observation_index)>=observations.length)failures.add('memory_without_observation');
 for(const memory of output.user_memories)if(!object(memory)||typeof memory.quote!=='string'||!memory.quote||typeof scenario.question!=='string'||!scenario.question.includes(memory.quote))failures.add('nonliteral_user_memory');
 return [...failures];
}

export type EvalBudget={calls:number;reservedUsd:number;stopped:boolean};
/** Exclusive CLI process only: wraps actual provider transport without replacing the adapter. */
export function budgetedFetch(plan:EvalPlan,base:typeof fetch,budget:EvalBudget):typeof fetch{
 const endpoint=plan.provider==='openai'?(/^gpt-(?:5\.[56]|6)(?:-|$)/.test(plan.model)?'https://api.openai.com/v1/responses':'https://api.openai.com/v1/chat/completions'):plan.provider==='anthropic'?'https://api.anthropic.com/v1/messages':'https://api.moonshot.ai/v1/chat/completions';
 return (async(input:unknown,init?:RequestInit)=>{
  if(String(input)!==endpoint||init?.method!=='POST'||typeof init.body!=='string')throw new Error('Transporte fora do escopo de avaliação.');
  const body=JSON.parse(init.body);if(!object(body)||body.model!==plan.model||/astra|fable/i.test(String(body.model)))throw new Error('Modelo fora do escopo.');
  const outputTokens=Number(body.max_output_tokens??body.max_completion_tokens??body.max_tokens);
  if(!Number.isInteger(outputTokens)||outputTokens<1||outputTokens>7000)throw new Error('Limite de saída ausente.');
  // UTF-8 bytes plus protocol/schema allowance conservatively overestimates the
  // short synthetic inputs. Reserve uncached input + maximum billed output.
  const inputReservation=Buffer.byteLength(init.body,'utf8')+8192;
  if(inputReservation>100000)throw new Error('Contexto sintético excedeu o limite da avaliação.');
  const reservation=(inputReservation*plan.price.input+outputTokens*plan.price.output)/1e6;
  if(budget.calls>=plan.options.maxCalls||budget.reservedUsd+reservation>plan.options.maxUsd){budget.stopped=true;throw new Error('Limite da avaliação atingido antes da chamada.');}
  budget.calls++;budget.reservedUsd+=reservation;
  return base(input as string,init);
 }) as typeof fetch;
}

function privateDirectory(requested:string){
 if(!isAbsolute(requested))throw new Error('Use um diretório temporário absoluto e novo para o relatório.');
 const parent=realpathSync(dirname(resolve(requested)));const roots=[realpathSync(tmpdir()),realpathSync('/tmp')];
 if(!roots.some(root=>{const rel=relative(root,parent);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`));}))throw new Error('Relatórios devem ficar em diretório temporário, fora do repositório.');
 const target=join(parent,resolve(requested).split(sep).at(-1)!);mkdirSync(target,{mode:0o700});return target;
}
function privateWrite(file:string,value:unknown){writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
const parameters={type:'object',properties:{query:{type:'string',minLength:1,maxLength:200}},required:['query'],additionalProperties:false};
function contextFor(scenario:EvalCase,mode:EvalMode,history:unknown[]){
 const visible=new Map((mode==='direct'?scenario.sources:scenario.sources.slice(0,1)).map(s=>[s.id,s]));
 const trace:{name:string;sourceIds:string[]}[]=[];
 const tools:CoachReadTool[]=[{
  name:'search_history',description:'Ler fontes sintéticas disponíveis desta pessoa e deste instante; buscar evidência favorável e contrária. Não aceita identidade de outro usuário.',parameters,
  execute:async(args)=>{
   const terms=String(args.query).toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
   const matched=scenario.sources.filter(s=>terms.some(t=>s.quote.toLocaleLowerCase('pt-BR').includes(t)));
   const result=(matched.length?matched:scenario.sources).slice(0,12);for(const s of result)visible.set(s.id,s);
   trace.push({name:'search_history',sourceIds:result.map(s=>s.id)});return {sources:Object.fromEntries(result.map(s=>[s.id,s])),coverage:'Somente as fontes sintéticas deste caso, não todo o histórico de uma pessoa real.'};
  },
 },{
  name:'open_source',description:'Abrir a fonte original pelo ID mostrado no inventário. Ferramenta somente de leitura.',parameters:{type:'object',properties:{source_id:{type:'string'}},required:['source_id'],additionalProperties:false},
  execute:async(args)=>{const s=scenario.sources.find(s=>s.id===args.source_id);if(!s)return {found:false};visible.set(s.id,s);trace.push({name:'open_source',sourceIds:[s.id]});return {found:true,source:s};},
 }];
 return {visible,trace,tools:mode==='investigate'?tools:[],data:{current_time:scenario.now,timezone:'America/Sao_Paulo',profile:scenario.profile,question:scenario.question,memories:scenario.memories,tasks:scenario.tasks,history,limitations:scenario.limitations,sources:Object.fromEntries(visible),available_sources:scenario.sources.map(s=>({id:s.id,recorded_at:s.recorded_at,speaker:s.speaker})),coverage:{total_meetings:scenario.sources.length,analyzed_meetings:0,pending_meetings:scenario.sources.length}}};
}
export type EvalRow={caseId:string;sequence?:EvalCase['sequence'];split:string;status:'completed'|'error'|'budget_stopped';output:Record<string,unknown>|null;contracts:string[];telemetry:CoachTelemetry|null;estimatedUncachedUsd:number|null;retrieval:{name:string;sourceIds:string[]}[];context:ReturnType<typeof contextFor>['data'];rubric:EvalCase['rubric'];manualReview:'required'};
export async function runEvaluation(options:EvalOptions){
 const plan=preparePlan(options);const directory=privateDirectory(options.output);const budget:EvalBudget={calls:0,reservedUsd:0,stopped:false};
 const metadata={runId:randomUUID(),syntheticOnly:true,datasetVersion:DATASET_VERSION,datasetHash:hash(cases),harnessVersion:EVAL_HARNESS_VERSION,promptHash:hash({COACH_SYSTEM,COACH_CONVERSATION_INSTRUCTION}),sourceFingerprint:hash(['runner.ts','dataset.ts','../provider.ts','../provider-schema.ts','../model.ts','../context-dates.ts'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8'))),createdAt:new Date().toISOString(),provider:plan.provider,model:plan.model,mode:options.mode,caseIds:plan.selected.map(c=>c.id),limits:{maxCalls:options.maxCalls,maxUsd:options.maxUsd},pricing:{asOf:PRICING_DATE,...plan.price,estimate:'Uncached reference estimate; reservation is conservative, not a provider invoice.'},quality:'Unvalidated until blind human review. Does not exercise production retrieval, persistence or scheduling.'};
 privateWrite(join(directory,'metadata.json'),metadata);
 const fd=openSync(join(directory,'results.jsonl'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 const originalFetch=globalThis.fetch;globalThis.fetch=budgetedFetch(plan,originalFetch,budget);const histories=new Map<string,unknown[]>();const rows:EvalRow[]=[];
 try{
  for(const scenario of plan.selected){
   const history=scenario.sequence?(histories.get(scenario.sequence.id)||[]):[];
   const context=contextFor(scenario,options.mode,history);let telemetry:CoachTelemetry|null=null;let output:Record<string,unknown>|null=null;let status:EvalRow['status']='completed';
   try{output=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+(options.mode==='investigate'?'\nQuando houver dúvida ou comparação temporal, consulte as fontes relevantes e procure contraexemplos com as ferramentas antes de concluir.':''),context.data,()=>conversationSchemaWithSources([...context.visible.keys()],scenario.question),{reasoningEffort:'high',tools:context.tools,maxToolRounds:2,maxToolCalls:4,timeoutMs:100000,onTelemetry:event=>{telemetry=event;}});}catch{status=budget.stopped?'budget_stopped':'error';}
   const usage=telemetry as CoachTelemetry|null;
   const row:EvalRow={caseId:scenario.id,sequence:scenario.sequence,split:scenario.split,status,output,contracts:output?checkContracts({...scenario,sources:[...context.visible.values()]},output):['no_valid_output'],telemetry:usage,estimatedUncachedUsd:status==='completed'&&usage?.usageComplete?(usage.inputTokens*plan.price.input+usage.outputTokens*plan.price.output)/1e6:null,retrieval:context.trace,context:context.data,rubric:scenario.rubric,manualReview:'required'};
   rows.push(row);writeSync(fd,JSON.stringify(row)+'\n');
   if(scenario.sequence){
    if(!output)break; // no fabricated continuation after a failed temporal step
    histories.set(scenario.sequence.id,[...history,{role:'user',content:scenario.question,created_at:scenario.now},{role:'assistant',content:output.answer,created_at:scenario.now}]);
   }
   if(budget.stopped)break;
  }
 }finally{globalThis.fetch=originalFetch;closeSync(fd);}
 const summary={completed:rows.filter(r=>r.status==='completed').length,attempted:rows.length,selected:plan.selected.length,contractFailures:rows.filter(r=>r.contracts.length>0).length,budget,manualReviewRequired:true,qualityScore:null};
 privateWrite(join(directory,'summary.json'),summary);
 privateWrite(join(directory,'human-review.json'),{instructions:'Avalie sem conhecer o modelo. Os testes automáticos cobrem contratos, não qualidade semântica.',items:rows.map(row=>({caseId:row.caseId,question:row.context.question,context:row.context,response:row.output,rubric:row.rubric,review:{priority:null,evidenceFidelity:null,correctionsAndTime:null,appropriateChallenge:null,actionability:null,clarity:null,criticalFailure:null,justification:''}}))});
 return {directory,...summary};
}
export function exportBlindComparison(left:string,right:string,output:string){
 const read=(dir:string)=>({metadata:JSON.parse(readFileSync(join(dir,'metadata.json'),'utf8')),rows:readFileSync(join(dir,'results.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as EvalRow)});
 const a=read(left),b=read(right);if(a.metadata.datasetHash!==b.metadata.datasetHash)throw new Error('Datasets diferentes não podem ser comparados como equivalentes.');
 const directory=privateDirectory(output);const mappings:unknown[]=[];const pairs=[];
 for(const row of a.rows){const other=b.rows.find(r=>r.caseId===row.caseId);if(!other||row.status!=='completed'||other.status!=='completed')continue;
  const swap=randomInt(2)===1;const pairId=randomUUID();mappings.push({pairId,A:swap?b.metadata.runId:a.metadata.runId,B:swap?a.metadata.runId:b.metadata.runId});
  const scenario=cases.find(c=>c.id===row.caseId);pairs.push({pairId,caseId:row.caseId,question:row.context.question,scenario,historyA:(swap?other:row).context.history,historyB:(swap?row:other).context.history,A:swap?other.output:row.output,B:swap?row.output:other.output,review:{winner:null,criticalFailureA:null,criticalFailureB:null,justification:'',dimensions:{priority:null,evidence:null,memory:null,challenge:null,actionability:null,clarity:null}}});
 }
 privateWrite(join(directory,'blind-pairs.json'),{instructions:'Compare A/B sem consultar o mapping. Aceite empate e inconclusivo. Explique com fonte; não use eloquência como substituto de correção.',pairs});
 privateWrite(join(directory,'mapping.private.json'),{runs:[a.metadata,b.metadata],mappings});return {directory,pairs:pairs.length};
}

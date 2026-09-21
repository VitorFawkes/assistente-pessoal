import {afterEach,beforeEach,expect,test} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {budgetedFetch,exportBlindComparison,preparePlan,runEvaluation,type EvalBudget} from './runner';
import type {EvalOptions} from './types';
const keys=['COACH_EVAL_PAID','COACH_PROVIDER','COACH_MODEL','OPENAI_API_KEY'];let env:Record<string,string|undefined>;let temp:string;const originalFetch=globalThis.fetch;
beforeEach(()=>{env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const key of keys)delete process.env[key];process.env.COACH_EVAL_PAID='1';process.env.OPENAI_API_KEY='synthetic';temp=mkdtempSync(join(tmpdir(),'coach-eval-unit-'));});
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of keys){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}rmSync(temp,{recursive:true,force:true});});
function options(output='run'):EvalOptions{return {run:true,caseIds:['priority-01'],maxCalls:1,maxUsd:1,mode:'direct',output:join(temp,output)};}
const request={method:'POST',body:JSON.stringify({model:'gpt-5.1',max_completion_tokens:7000,messages:[]})};
test('transport refuses excess calls, budget, model and endpoint before spending',async()=>{
 let actualCalls=0;const base=(async()=>{actualCalls++;return Response.json({});}) as unknown as typeof fetch;
 const plan=preparePlan(options());const budget:EvalBudget={calls:0,reservedUsd:0,stopped:false};const guarded=budgetedFetch(plan,base,budget);
 await guarded('https://api.openai.com/v1/chat/completions',request);
 await expect(guarded('https://api.openai.com/v1/chat/completions',request)).rejects.toThrow();expect(actualCalls).toBe(1);expect(budget.stopped).toBe(true);
 const tiny=budgetedFetch({...plan,options:{...plan.options,maxUsd:0.001}},base,{calls:0,reservedUsd:0,stopped:false});
 await expect(tiny('https://api.openai.com/v1/chat/completions',request)).rejects.toThrow();expect(actualCalls).toBe(1);
 await expect(guarded('https://unapproved.invalid',request)).rejects.toThrow();
 await expect(guarded('https://api.openai.com/v1/chat/completions',{...request,body:JSON.stringify({model:'gpt-6-astra',max_completion_tokens:7000})})).rejects.toThrow();expect(actualCalls).toBe(1);
});
test('runner keeps rubrics out of requests and writes private human-review artifacts',async()=>{
 let requests=0;
 globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{requests++;const body=JSON.parse(String(init?.body));const input=JSON.parse(body.messages[1].content);expect(input.rubric).toBeUndefined();expect(input.expected).toBeUndefined();return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'Priorize a proposta e adie a melhoria visual.',observations:[],memories:[],user_memories:[]})}}],usage:{prompt_tokens:100,completion_tokens:30}});}) as unknown as typeof fetch;
 const result=await runEvaluation(options());expect(result.completed).toBe(1);expect(result.qualityScore).toBeNull();expect(result.manualReviewRequired).toBe(true);expect(requests).toBe(1);
 expect(statSync(result.directory).mode&0o777).toBe(0o700);expect(statSync(join(result.directory,'results.jsonl')).mode&0o777).toBe(0o600);
 const human=JSON.parse(readFileSync(join(result.directory,'human-review.json'),'utf8'));expect(human.items[0].review.evidenceFidelity).toBeNull();
 const comparison=exportBlindComparison(result.directory,result.directory,join(temp,'comparison'));
 const blind=readFileSync(join(comparison.directory,'blind-pairs.json'),'utf8');expect(blind).not.toContain('gpt-5.1');expect(blind).not.toContain('synthetic');expect(comparison.pairs).toBe(1);
 await expect(runEvaluation(options())).rejects.toThrow();expect(requests).toBe(1);
});
test('investigation budget stop preserves report instead of pretending completed coverage',async()=>{
 globalThis.fetch=(async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'x',type:'function',function:{name:'search_history',arguments:'{"query":"proposta"}'}}]}}],usage:{prompt_tokens:20,completion_tokens:10}})) as unknown as typeof fetch;
 const result=await runEvaluation({...options(),mode:'investigate'});
 expect(result.completed).toBe(0);expect(result.budget.calls).toBe(1);expect(result.budget.stopped).toBe(true);
 const row=JSON.parse(readFileSync(join(result.directory,'results.jsonl'),'utf8').trim());expect(row.status).toBe('budget_stopped');expect(row.manualReview).toBe('required');expect(row.output).toBeNull();
});

test('Sol budget guards Responses without permitting an endpoint downgrade',async()=>{
 process.env.COACH_MODEL='gpt-5.6-sol';let calls=0;
 const guarded=budgetedFetch(preparePlan(options()),(async()=>{calls++;return Response.json({});}) as unknown as typeof fetch,{calls:0,reservedUsd:0,stopped:false});
 const init={method:'POST',body:JSON.stringify({model:'gpt-5.6-sol',max_output_tokens:7000,input:[]})};
 await expect(guarded('https://api.openai.com/v1/chat/completions',init)).rejects.toThrow();expect(calls).toBe(0);
 await guarded('https://api.openai.com/v1/responses',init);expect(calls).toBe(1);
});

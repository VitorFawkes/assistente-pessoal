import { beforeEach,afterEach,expect,test } from 'bun:test';
import { cases } from './dataset';
import { preparePlan,checkContracts } from './runner';
import type { EvalOptions } from './types';
const keys=['COACH_EVAL_PAID','COACH_PROVIDER','COACH_MODEL','OPENAI_API_KEY','ANTHROPIC_API_KEY','KIMI_API_KEY'];let env:Record<string,string|undefined>;
beforeEach(()=>{env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];});
afterEach(()=>{for(const k of keys){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}});
const options:EvalOptions={run:true,caseIds:['priority-01'],maxCalls:2,maxUsd:1,mode:'direct',output:'/tmp/new-eval'};
test('dataset contains sixty distinct cases and six four-step sequences',()=>{
 expect(cases).toHaveLength(60);expect(new Set(cases.map(c=>c.id)).size).toBe(60);
 const sequences=new Map<string,number[]>();for(const c of cases)if(c.sequence)sequences.set(c.sequence.id,[...(sequences.get(c.sequence.id)||[]),c.sequence.step]);
 expect(sequences.size).toBe(6);for(const steps of sequences.values())expect(steps).toEqual([1,2,3,4]);
 expect(cases.filter(c=>c.split==='holdout').length).toBeGreaterThanOrEqual(12);
});
test('historical snapshots contain no future source or memory and rubrics are independently written',()=>{
 expect(cases.length).toBeGreaterThan(0);
 for(const c of cases){
  expect(c.rubric.expected.length).toBeGreaterThan(25);expect(c.rubric.criticalFailures.length).toBeGreaterThan(0);
  for(const s of c.sources){expect(Date.parse(s.known_at)).toBeLessThanOrEqual(Date.parse(c.now));expect(s.owner==='self').toBe(s.self_attributed);}
  for(const m of c.memories)expect(Date.parse(m.known_at)).toBeLessThanOrEqual(Date.parse(c.now));
  for(const id of [...c.rubric.decisiveSourceIds,...c.rubric.counterEvidenceIds])expect(c.sources.some(s=>s.id===id)).toBe(true);
 }
});
test('paid evaluation needs both opt-in and explicit bounded selection',()=>{
 expect(()=>preparePlan(options)).toThrow('COACH_EVAL_PAID');
 process.env.COACH_EVAL_PAID='1';process.env.OPENAI_API_KEY='synthetic';
 expect(()=>preparePlan({...options,run:false})).toThrow('--run');
 expect(()=>preparePlan({...options,caseIds:[]})).toThrow('casos');
 expect(()=>preparePlan({...options,maxCalls:0})).toThrow('chamadas');
 expect(()=>preparePlan({...options,maxUsd:0})).toThrow('orçamento');
 expect(()=>preparePlan({...options,caseIds:['missing']})).toThrow('Caso');
});
test('excluded model cannot enter evaluation even with an API key',()=>{
 process.env.COACH_EVAL_PAID='1';process.env.OPENAI_API_KEY='synthetic';process.env.COACH_MODEL='gpt-6-astra';
 expect(()=>preparePlan(options)).toThrow();process.env.COACH_PROVIDER='anthropic';process.env.COACH_MODEL='claude-fable-5-1';process.env.ANTHROPIC_API_KEY='synthetic';expect(()=>preparePlan(options)).toThrow();
});
test('invalid references and attribution are rejected by deterministic contracts',()=>{
 const scenario={sources:[{id:'s1',self_attributed:false}],question:'Como estou?',rubric:{},memories:[]};
 expect(checkContracts(scenario,{answer:'ok',observations:[{evidence_ids:['invented']}],memories:[],user_memories:[]})).toContain('unknown_evidence_id');
 expect(checkContracts(scenario,{answer:'ok',observations:[{evidence_ids:['s1']}],memories:[],user_memories:[]})).toContain('observation_without_self_evidence');
 expect(checkContracts(scenario,{answer:'ok',observations:[],memories:[],user_memories:[{kind:'goal',quote:'Eu vou desistir.'}]})).toContain('nonliteral_user_memory');
});

test('valid opt-in creates a selected plan and includes prior temporal steps',()=>{
 process.env.COACH_EVAL_PAID='1';process.env.OPENAI_API_KEY='synthetic';
 const plan=preparePlan({...options,caseIds:['interpretation-corrected-3'],maxCalls:3});
 expect(plan.selected.map(c=>c.id)).toEqual(['interpretation-corrected-1','interpretation-corrected-2','interpretation-corrected-3']);
 expect(plan.provider).toBe('openai');expect(plan.model).toBe('gpt-5.1');
});

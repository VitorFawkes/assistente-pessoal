import type { Evidence } from '../types';
export type EvalMemory = {id:string;kind:'goal'|'context'|'pattern';content:string;status:'confirmed'|'hypothesis'|'rejected';lifecycle:'active'|'superseded';known_at:string;valid_from:string;supersedes_id?:string};
export type EvalSource = Evidence & {id:string;known_at:string;owner:'self'|'other'|'unknown'};
export type EvalCase = {
 id:string;category:string;split:'dev'|'holdout';now:string;question:string;
 profile:{name:string;goals:string;context:string};sources:EvalSource[];memories:EvalMemory[];
 tasks:{id:string;description:string;status:string;due_at:string|null;priority:string;updated_at:string}[];
 limitations:string[];sequence?:{id:string;step:number};
 rubric:{expected:string;acceptableAlternatives:string;criticalFailures:string[];decisiveSourceIds:string[];counterEvidenceIds:string[]};
};
export type EvalMode='direct'|'investigate';
export type EvalOptions={run:boolean;caseIds:string[];maxCalls:number;maxUsd:number;mode:EvalMode;output:string};

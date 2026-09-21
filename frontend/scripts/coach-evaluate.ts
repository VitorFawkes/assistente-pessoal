import { cases, DATASET_VERSION } from '../lib/coach/evals/dataset';
import { exportBlindComparison, runEvaluation } from '../lib/coach/evals/runner';
import type { EvalMode } from '../lib/coach/evals/types';
const HELP=`Avaliação sintética do coach (nenhum banco é consultado).

Listar, sem custo:
  bun --no-env-file scripts/coach-evaluate.ts --list

Execução paga EXPLÍCITA (credencial já no ambiente):
  COACH_EVAL_PAID=1 bun --no-env-file scripts/coach-evaluate.ts --run \\
    --cases priority-01,attribution-01 --mode direct \\
    --max-calls 2 --max-usd 1 --output /tmp/coach-eval-novo

Sequência completa: --cases sequence:interpretation-corrected
Investigação com ferramentas: --mode investigate (até 3 chamadas por caso)
Comparação cega, sem custo:
  bun --no-env-file scripts/coach-evaluate.ts --compare /tmp/run-a /tmp/run-b \\
    --output /tmp/coach-comparacao-nova

COACH_PROVIDER / COACH_MODEL escolhem um candidato permitido.
Nenhum fallback. Astra/Fable são proibidos. Relatórios locais 0700/0600.
Testes de contrato não demonstram qualidade humana de coaching.`;
export async function main(args:string[]){
 if(!args.length||args.includes('--help')){console.log(HELP);return;}
 if(args.length===1&&args[0]==='--list'){console.log(JSON.stringify({dataset:DATASET_VERSION,count:cases.length,cases:cases.map(c=>({id:c.id,split:c.split,category:c.category,sequence:c.sequence}))},null,2));return;}
 const flags:Record<string,string>={};let run=false;let compare:string[]|null=null;
 for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--run'){if(run)throw new Error('Flag duplicada.');run=true;continue;}
  if(key==='--compare'){if(compare||!args[i+1]||!args[i+2])throw new Error('Informe dois diretórios em --compare.');compare=[args[++i],args[++i]];continue;}
  if(!['--cases','--mode','--max-calls','--max-usd','--output'].includes(key)||Object.hasOwn(flags,key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Argumentos inválidos. Use --help.');
  flags[key]=args[++i];
 }
 if(!flags['--output'])throw new Error('Informe --output com um diretório temporário novo.');
 if(compare){if(run||Object.keys(flags).some(k=>k!=='--output'))throw new Error('Não combine comparação com execução.');console.log(JSON.stringify(exportBlindComparison(compare[0],compare[1],flags['--output'])));return;}
 const result=await runEvaluation({run,caseIds:(flags['--cases']||'').split(',').filter(Boolean),mode:(flags['--mode']||'direct') as EvalMode,maxCalls:Number(flags['--max-calls']),maxUsd:Number(flags['--max-usd']),output:flags['--output']});
 console.log(JSON.stringify(result));
 if(result.contractFailures||result.completed!==result.selected)process.exitCode=2;
}
if(import.meta.main)main(process.argv.slice(2)).catch(error=>{console.error(error instanceof Error?error.message:'Avaliação não concluída.');process.exitCode=1;});

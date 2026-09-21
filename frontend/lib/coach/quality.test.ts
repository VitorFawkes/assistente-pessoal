import {expect,test} from 'bun:test';
import {assertCoachVerification,CoachVerificationError} from './quality';
test('quality gate rejects unresolved issues even if model incorrectly marks supported',()=>{
 expect(()=>assertCoachVerification({supported:true,issues:['O experimento usa um prazo passado.']})).toThrow('Não publiquei');
 expect(()=>assertCoachVerification({supported:false,issues:[]})).toThrow('Não publiquei');
 expect(()=>assertCoachVerification({supported:true})).toThrow('Não publiquei');
 expect(()=>assertCoachVerification({supported:true,issues:[]})).not.toThrow();
});

test('verification issue details remain private while the bounded repair can inspect them',()=>{
 const error=new CoachVerificationError(['Contexto privado específico']);
 expect(error.issuesForRepair()).toEqual(['Contexto privado específico']);
 expect(error.message).not.toContain('Contexto privado');expect(JSON.stringify(error)).not.toContain('Contexto privado');
});

test('scope and continuity issues reach bounded repair without becoming public rejection text',()=>{
 const issues=[
  'A resposta oferece feedback 360 sem pedido, embora o objetivo informado seja concluir a proposta.',
  'A resposta pergunta se a proposta foi enviada depois de o usuário confirmar o envio.',
 ];
 let rejected:CoachVerificationError|undefined;
 try{assertCoachVerification({supported:true,issues});}catch(error){
  expect(error).toBeInstanceOf(CoachVerificationError);rejected=error as CoachVerificationError;
 }
 expect(rejected).toBeDefined();
 expect(rejected!.issuesForRepair()).toEqual(issues);
 for(const issue of issues)expect(rejected!.message).not.toContain(issue);
 const repair=rejected!.issuesForRepair();repair[0]='Alteração externa do diagnóstico';
 expect(rejected!.issuesForRepair()).toEqual(issues);
});

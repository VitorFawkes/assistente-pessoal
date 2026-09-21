import { expect, test } from "bun:test";
import { userMemoryNotes } from "./conversation-memory";
test("durable user goals preserve the exact self-report, not a generated interpretation",()=>{
 const message="Meu objetivo agora é delegar a operação comercial. Preciso priorizar melhor.";
 const notes=userMemoryNotes([{kind:"goal",quote:"Meu objetivo agora é delegar a operação comercial."}],message);
 expect(notes).toEqual([{kind:"goal",content:"Informado por você na conversa: Meu objetivo agora é delegar a operação comercial.",status:"confirmed",evidence:[]}]);
});
test("fabricated quotes, model inferences, unsupported types and duplicate notes are rejected",()=>{
 const quote="Quero terminar a proposta antes de outra plataforma.";
 expect(userMemoryNotes([{kind:"goal",quote:"Quero desistir de vendas."},{kind:"pattern",quote},{kind:"goal",quote},{kind:"goal",quote}],quote)).toHaveLength(1);
 expect(userMemoryNotes([{kind:"goal",quote:""}],quote)).toEqual([]);
 expect(userMemoryNotes(null,quote)).toEqual([]);
});

test("schema memory candidates are exact statements from this turn, never questions or old profile",async()=>{
 const { userMemoryCandidates }=await import("./conversation-memory");
 const input="Você entendeu errado: não assumi a execução. Minha prioridade agora é concluir a proposta. O que faço?";
 const candidates=userMemoryCandidates(input);
 expect(candidates).toEqual(["Você entendeu errado: não assumi a execução.","Minha prioridade agora é concluir a proposta."]);
 expect(candidates.every(quote=>input.includes(quote))).toBe(true);
});

test("questions, chat instructions and temporary missing evidence never become personal goals",()=>{
 for(const quote of ["Compare minhas falas dessas duas reuniões sobre delegação.","A entrega ainda não foi verificada.","Me fala só o próximo passo, sem uma lista de tarefas.","Minha meta era concluir a proposta em agosto."]){
  expect(userMemoryNotes([{kind:"goal",quote}],quote)).toEqual([]);
 }
});
test("a direct correction is kept as context, not transformed into a new goal",()=>{
 const quote="Você entendeu errado: eu pedi uma proposta ao time, não assumi a execução.";
 expect(userMemoryNotes([{kind:"context",quote}],quote)).toHaveLength(1);
 expect(userMemoryNotes([{kind:"goal",quote}],quote)).toEqual([]);
});

test("quoted and third-party goals never become the user's confirmed objective",async()=>{
 const {userMemoryCandidates}=await import("./conversation-memory");
 for(const message of ["O cliente disse: meu objetivo é cancelar o projeto.","Meu chefe falou: minha prioridade é cortar a equipe.","Ele disse: \"Quero concluir o projeto.\"", "Imagine que meu objetivo é abandonar tudo."]){
  expect(userMemoryCandidates(message)).toEqual([]);
  expect(userMemoryNotes([{kind:"goal",quote:message}],message)).toEqual([]);
 }
});
test("a quoted substring cannot evade full-message attribution checks",()=>{
 const quote="Quero terminar a proposta.";
 expect(userMemoryNotes([{kind:"goal",quote}],`O cliente disse: ${quote}`)).toEqual([]);
});
test("negative self-goals and explicit corrections remain useful self-reports",()=>{
 const quote="Meu objetivo é não assumir mais frentes.";
 expect(userMemoryNotes([{kind:"goal",quote}],quote)).toHaveLength(1);
 const correction="Você entendeu errado: eu não assumi a execução.";
 expect(userMemoryNotes([{kind:"context",quote:correction}],correction)).toHaveLength(1);
});

test("a directly declared goal may contain a quoted title while reported goals remain excluded",()=>{
 const quote='Meu objetivo é "concluir Aurora".';
 expect(userMemoryNotes([{kind:"goal",quote}],quote)).toEqual([{kind:"goal",content:"Informado por você na conversa: "+quote,status:"confirmed",evidence:[]}]);
 expect(userMemoryNotes([{kind:"goal",quote}],`O cliente disse: ${quote}`)).toEqual([]);
 expect(userMemoryNotes([{kind:"goal",quote}],`Imagine que ${quote}`)).toEqual([]);
 expect(userMemoryNotes([{kind:"goal",quote}],`“${quote}”`)).toEqual([]);
});

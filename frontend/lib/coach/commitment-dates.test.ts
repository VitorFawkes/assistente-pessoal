import {expect,test} from "bun:test";
import {formatCommitmentDue,naturalCommitmentDue} from "./commitment-dates";

// Tuesday 22/09/2026, 18h30 in São Paulo.
const reference=new Date("2026-09-22T21:30:00Z");
const due=(text:string,timezone="America/Sao_Paulo")=>naturalCommitmentDue(text,reference,timezone);

test("spoken days become the end of that local day",()=>{
 expect(due("Amanhã no Pensar Estratégico eu vou destravar a contratação da closer.")).toBe("2026-09-24T02:59:00.000Z");
 expect(due("Vou enviar a proposta hoje.")).toBe("2026-09-23T02:59:00.000Z");
 expect(due("Depois de amanhã vou revisar o contrato.")).toBe("2026-09-25T02:59:00.000Z");
 expect(due("Até sexta eu vou fechar a contratação.")).toBe("2026-09-26T02:59:00.000Z");
 expect(due("Até o fim da semana vou mandar a proposta.")).toBe("2026-09-26T02:59:00.000Z");
 expect(due("Na terça vou revisar o orçamento.")).toBe("2026-09-30T02:59:00.000Z");
 expect(due("Vou enviar a proposta dia 30.")).toBe("2026-10-01T02:59:00.000Z");
 expect(due("Vou enviar a proposta em 01/10.")).toBe("2026-10-02T02:59:00.000Z");
});

test("an explicit time narrows the deadline, and a passed time without a day is dropped",()=>{
 expect(due("Amanhã às 10h vou ligar para a consultoria.")).toBe("2026-09-23T13:00:00.000Z");
 expect(due("Amanhã até as 8h30 vou mandar os nomes.")).toBe("2026-09-23T11:30:00.000Z");
 expect(due("Até as 20h vou mandar o resumo.")).toBe("2026-09-22T23:00:00.000Z");
 expect(due("Até as 15h vou mandar o resumo.")).toBeNull();
});

test("counts, durations and ordinals are not read as dates",()=>{
 expect(due("Amanhã vou revisar as 10 propostas.")).toBe("2026-09-24T02:59:00.000Z");
 expect(due("Amanhã vou dedicar 2h à proposta.")).toBe("2026-09-24T02:59:00.000Z");
 expect(due("Amanhã vou revisar a segunda parte da proposta.")).toBe("2026-09-24T02:59:00.000Z");
});

test("missing, past or conflicting dates never invent a deadline",()=>{
 expect(due("Vou revisar a proposta.")).toBeNull();
 expect(due("Ontem eu revisei a proposta.")).toBeNull();
 expect(due("Amanhã ou sexta vou revisar a proposta.")).toBeNull();
 expect(due("Vou enviar em 10/09/2026.")).toBeNull();
 expect(naturalCommitmentDue("Amanhã vou revisar.",new Date("invalid"),"America/Sao_Paulo")).toBeNull();
});

test("the new step after a comma wins over what did not happen today",()=>{
 expect(due("Hoje não deu, amanhã vou cobrar a consultoria.")).toBe("2026-09-24T02:59:00.000Z");
});

test("wall-clock deadlines follow the user's timezone across a DST change",()=>{
 // New York leaves daylight time on 01/11/2026: 10h the next day is 15h UTC.
 expect(naturalCommitmentDue("Amanhã às 10h vou enviar.",new Date("2026-10-31T16:00:00Z"),"America/New_York")).toBe("2026-11-01T15:00:00.000Z");
});

test("deadlines are shown as the user's local weekday and date",()=>{
 expect(formatCommitmentDue("2026-09-24T02:59:00.000Z","America/Sao_Paulo")).toBe("quarta, 23/09");
 expect(formatCommitmentDue("2026-09-23T13:00:00.000Z","America/Sao_Paulo")).toBe("quarta, 23/09 às 10h");
 expect(formatCommitmentDue("2026-09-23T11:30:00.000Z","America/Sao_Paulo")).toBe("quarta, 23/09 às 8h30");
});

test("a weekday opening the sentence counts, an ordinal after an article does not",()=>{
 expect(due("Sexta eu vou mandar a proposta.")).toBe("2026-09-26T02:59:00.000Z");
 expect(due("Vou revisar a quarta versão da proposta.")).toBeNull();
});

import { expect, test } from "bun:test";
import { presentChat, splitChatPresentation } from "./chat-presentation";
import type { Observation } from "./types";
const coverage={total_meetings:12,analyzed_meetings:12,analyzed_chunks:20,pending_meetings:0};
const observation:Observation={competency:"focus",observation:"Você declarou uma prioridade.",hypothesis:"Pode ajudar a limitar frentes.",alternative:"Pode ter sido pontual.",experiment:"",evidence:[]};
test("conversation body is concise while grounded distinctions and scope remain available",()=>{
 const split=splitChatPresentation(presentChat("Escolha a proposta antes de abrir outra frente.",[observation],["meeting"],coverage));
 expect(split.answer).toBe("Escolha a proposta antes de abrir outra frente.");
 expect(split.reading).toContain("**Hipótese:** Pode ajudar a limitar frentes.");
 expect(split.reading).toContain("**Outra explicação:** Pode ter sido pontual.");
 expect(split.scope).toContain("1 trecho de 1 reunião");
 expect(split.answer).not.toContain("Na geração");
});
test("no-evidence limit is available without turning a simple follow-up into a report",()=>{
 const split=splitChatPresentation(presentChat("Escreva o resultado esperado em uma frase.",[],[],coverage));
 expect(split.answer).toBe("Escreva o resultado esperado em uma frase.");
 expect(split.reading).toContain("Sem observações verificadas");
 expect(split.scope).toContain("Não consultei trechos");
});
test("plain old messages and markdown emphasis are not silently truncated",()=>{
 const content="Uma **observação**: responda com clareza.\n\n*Seu objetivo importa.*";
 expect(splitChatPresentation(content)).toEqual({answer:content,reading:"",scope:""});
});

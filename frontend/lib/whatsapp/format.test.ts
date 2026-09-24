import { describe, expect, test } from "bun:test";
import { presentChat } from "../coach/chat-presentation";
import { validateJobInput } from "../coach/jobs";
import { audioFile, codeInText, displayNumber, hashLinkCode, maskPhone, messageText, quietHours, reviewText, senderFromKey, splitForWhatsApp, whatsappText } from "./format";

describe("remetente do WhatsApp", () => {
 test("usa o telefone quando vem junto com o LID", () => {
  expect(senderFromKey({ remoteJid: "123456789012345@lid", remoteJidAlt: "5541999990000@s.whatsapp.net" })).toEqual({ phone: "5541999990000", lid: "123456789012345", jid: "5541999990000@s.whatsapp.net" });
 });
 test("aceita só LID e responde para o LID", () => {
  expect(senderFromKey({ remoteJid: "98765432101@lid" })).toEqual({ phone: null, lid: "98765432101", jid: "98765432101@lid" });
 });
 test("ignora dispositivo no JID", () => {
  expect(senderFromKey({ remoteJid: "5511988887777:12@s.whatsapp.net" })?.phone).toBe("5511988887777");
 });
 test("grupo, lista de transmissão e canal nunca são remetente", () => {
  expect(senderFromKey({ remoteJid: "120363000000000000@g.us" })).toBeNull();
  expect(senderFromKey({ remoteJid: "status@broadcast" })).toBeNull();
  expect(senderFromKey({ remoteJid: "5541999990000@s.whatsapp.net", remoteJidAlt: "120363000000000000@g.us" })).toBeNull();
  expect(senderFromKey({ remoteJid: "abc@newsletter" })).toBeNull();
  expect(senderFromKey(null)).toBeNull();
 });
});

describe("texto da mensagem", () => {
 test("lê conversa, texto estendido e legenda", () => {
  expect(messageText({ conversation: " oi " })).toBe("oi");
  expect(messageText({ extendedTextMessage: { text: "com link" } })).toBe("com link");
  expect(messageText({ imageMessage: { caption: "legenda" } })).toBe("legenda");
  expect(messageText({ stickerMessage: {} })).toBe("");
  expect(messageText(null)).toBe("");
 });
 test("áudio vira arquivo com a extensão que a transcrição aceita", () => {
  expect(audioFile("audio/ogg; codecs=opus")).toEqual({ type: "audio/ogg", name: "audio.ogg" });
  expect(audioFile("audio/mp4")).toEqual({ type: "audio/mp4", name: "audio.m4a" });
  expect(audioFile(undefined)).toEqual({ type: "audio/ogg", name: "audio.ogg" });
 });
});

describe("código de ligação", () => {
 test("aceita um único grupo de 6 dígitos em mensagem curta", () => {
  expect(codeInText("482913")).toBe("482913");
  expect(codeInText("Código: 482913")).toBe("482913");
  expect(codeInText("4829134")).toBeNull();
  expect(codeInText("123456 e 654321")).toBeNull();
  expect(codeInText(`482913 ${"x".repeat(90)}`)).toBeNull();
 });
 test("hash depende do segredo e do código", () => {
  expect(hashLinkCode("482913", "a".repeat(40))).not.toBe(hashLinkCode("482913", "b".repeat(40)));
  expect(hashLinkCode("482913", "a".repeat(40))).toMatch(/^[0-9a-f]{64}$/);
 });
});

describe("horário de silêncio", () => {
 const at = (h: number) => new Date(Date.UTC(2026, 8, 24, h + 3, 0));
 test("22h às 7h em São Paulo não sai mensagem espontânea", () => {
  expect(quietHours("America/Sao_Paulo", at(22))).toBe(true);
  expect(quietHours("America/Sao_Paulo", at(6))).toBe(true);
  expect(quietHours("America/Sao_Paulo", at(7))).toBe(false);
  expect(quietHours("America/Sao_Paulo", at(21))).toBe(false);
 });
});

describe("resposta formatada para o WhatsApp", () => {
 test("leva só a orientação, em marcação do WhatsApp, e avisa das leituras", () => {
  const content = presentChat("**Foco:** fechar a proposta.\n\n- ligar pro Pedro\n- mandar contrato",
   [{ observation: "o", hypothesis: "h", alternative: "a", evidence: [] } as never], ["m1"],
   { total_meetings: 1, analyzed_meetings: 1, report_ready_meetings: 1 } as never);
  const text = whatsappText(content);
  expect(text).toContain("*Foco:* fechar a proposta.");
  expect(text).toContain("• ligar pro Pedro");
  expect(text).not.toContain("**");
  expect(text).not.toContain("Consultei");
  expect(text).toContain("ficam na página do Coach");
 });
 test("texto antigo sem envelope passa inteiro", () => {
  expect(whatsappText("## Título\n\n[site](https://exemplo.com)")).toBe("*Título*\n\nsite (https://exemplo.com)");
 });
 test("divide mensagem longa por parágrafo sem perder texto", () => {
  const text = Array.from({ length: 30 }, (_, i) => `parágrafo ${i} ${"x".repeat(300)}`).join("\n\n");
  const parts = splitForWhatsApp(text, 1000);
  expect(parts.every(p => p.length <= 1000)).toBe(true);
  expect(parts.join("\n\n")).toBe(text);
 });
});

describe("pedido vindo do WhatsApp na fila do coach", () => {
 test("guarda o canal e para onde responder", () => {
  expect(validateJobInput({ kind: "chat", key: "whatsapp:1", payload: { message: " oi ", channel: "whatsapp", reply_to: "5541999990000@s.whatsapp.net" } }).payload)
   .toEqual({ message: "oi", channel: "whatsapp", reply_to: "5541999990000@s.whatsapp.net" });
 });
 test("destino inválido é descartado e conversa da página não muda", () => {
  expect(validateJobInput({ kind: "chat", key: "whatsapp:2", payload: { message: "oi", channel: "whatsapp", reply_to: "123@g.us" } }).payload).toEqual({ message: "oi", channel: "whatsapp" });
  expect(validateJobInput({ kind: "chat", key: "manual:1", payload: { message: "oi", reply_to: "5541999990000@s.whatsapp.net" } }).payload).toEqual({ message: "oi" });
 });
});

describe("exibição", () => {
 test("número do Coach e telefone mascarado", () => {
  expect(displayNumber("551151980726")).toBe("(11) 5198-0726");
  expect(maskPhone("5541999990000")).toBe("final 0000");
  expect(maskPhone(null)).toBeNull();
 });
});

describe("revisão da semana no WhatsApp", () => {
 test("leva a proposta e deixa as evidências na página", () => {
  const text = reviewText({ headline: "Um problema principal por dia", focus: "Escolha **uma** frente.", progress: "", experiment: "Até sexta, fechar a proposta.", question: "O que trava?" });
  expect(text).toContain("*Revisão da semana*\n\n*Um problema principal por dia*\n\nEscolha *uma* frente.");
  expect(text).toContain("*Experimento da semana:* Até sexta, fechar a proposta.");
  expect(text).not.toContain("Avanço");
  expect(text.endsWith("Evidências e detalhes: https://acoes.vitorgambetti.com.br/coach")).toBe(true);
 });
});

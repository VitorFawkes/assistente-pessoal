import { describe, expect, test } from "bun:test";
import { meetingNoticeText, noticeSlot, reviewText, type NoticeMeeting } from "./meeting-notice";

const SP = "America/Sao_Paulo";
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, day, h + 3, m));

describe("quando sai o aviso de uma reunião", () => {
 test("de dia sai na hora, até 4 no dia; depois espera as 18h e sai sozinho a partir das 19h", () => {
  expect(noticeSlot(at(24, 14, 50), at(24, 15), SP, 0)).toBe("now");
  expect(noticeSlot(at(24, 14, 50), at(24, 15), SP, 3)).toBe("now");
  expect(noticeSlot(at(24, 14, 50), at(24, 15), SP, 4)).toBe("hold");
  expect(noticeSlot(at(24, 14, 50), at(24, 18, 30), SP, 6)).toBe("hold");
  expect(noticeSlot(at(24, 14, 50), at(24, 19), SP, 6)).toBe("now");
 });
 test("entre 22h e 7h nada sai", () => {
  expect(noticeSlot(at(24, 21, 50), at(24, 22), SP, 0)).toBe("hold");
  expect(noticeSlot(at(24, 21, 50), at(25, 6, 59), SP, 0)).toBe("hold");
 });
 test("reunião processada de madrugada vai com a mensagem das 8h, ou sozinha a partir das 9h", () => {
  expect(noticeSlot(at(24, 23, 30), at(25, 7, 30), SP, 0)).toBe("hold");
  expect(noticeSlot(at(24, 23, 30), at(25, 8, 15), SP, 0)).toBe("hold");
  expect(noticeSlot(at(25, 2), at(25, 9), SP, 0)).toBe("now");
 });
 test("reunião de madrugada antiga segue a regra do dia", () => {
  expect(noticeSlot(at(23, 23), at(24, 15), SP, 0)).toBe("now");
 });
});

const meeting: NoticeMeeting = {
 id: "11111111-2222-3333-4444-555555555555", nome: "Reunião com a Closer", original_filename: "gravacao.m4a",
 recorded_at: at(24, 14).toISOString(), done_at: at(24, 14, 40).toISOString(), summary: "Definimos o_preço e o prazo da proposta.",
 executive_summary: null, needs_segmentation: false, duration_seconds: 1800,
};

describe("texto do aviso da reunião", () => {
 test("resumo, suas tarefas, as dos outros, as que já existiam e o link", () => {
  const text = meetingNoticeText(meeting, [
   { titulo: "Enviar proposta", owner: "vitor", is_mine: true, prazo: at(26, 12).toISOString() },
   { titulo: "Revisar contrato", owner: "Marcelo", is_mine: false, prazo: null },
  ], 2, { timezone: SP, now: at(24, 15) });
  expect(text).toContain("*Reunião processada:* Reunião com a Closer (14:00)");
  expect(text).toContain("_Definimos o preço e o prazo da proposta._");
  expect(text).toContain("✅ *Suas tarefas* (1)\n• Enviar proposta _(até 26/09)_");
  expect(text).toContain("👥 *Com outros* (1)\n• *Marcelo:* Revisar contrato");
  expect(text).toContain("♻️ 2 já existiam; anotei nos cards");
  expect(text).toContain("🔗 https://acoes.vitorgambetti.com.br/reunioes/11111111-2222-3333-4444-555555555555");
  expect(text).not.toContain("segmentar");
 });
 test("sem tarefa diz isso; áudio longo leva o link dos cortes; a pergunta do Coach vai junto", () => {
  const text = meetingNoticeText({ ...meeting, recorded_at: at(23, 9).toISOString(), needs_segmentation: true, duration_seconds: 5400 }, [], 0,
   { timezone: SP, now: at(24, 15), coach: "Depois da reunião\n\nA proposta destravou. Posso dar o combinado como feito?" });
  expect(text).toContain("(23/09, 09:00)");
  expect(text).toContain("_Nenhuma tarefa nova nesta reunião._");
  expect(text).toContain("Áudio longo (1,5 h): revise os cortes em https://acoes.vitorgambetti.com.br/reunioes/11111111-2222-3333-4444-555555555555/segmentar");
  expect(text.endsWith("💬 *Coach:* A proposta destravou. Posso dar o combinado como feito?")).toBe(true);
 });
 test("lista longa mostra 8 e conta o resto", () => {
  const tasks = Array.from({ length: 11 }, (_, i) => ({ titulo: `Tarefa ${i}`, owner: "vitor", is_mine: true, prazo: null }));
  const text = meetingNoticeText(meeting, tasks, 0, { timezone: SP, now: at(24, 15) });
  expect(text).toContain("✅ *Suas tarefas* (11)");
  expect(text).toContain("• Tarefa 7\n• e mais 3 no Ações");
  expect(text).not.toContain("Tarefa 8");
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

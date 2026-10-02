import { describe, expect, test } from "bun:test";
import { eAceite, eRecusa, fraseDoCombinado, horaValida, mensagemDas18h, resultadoCurto, fimDeSemana, diaSeguinte, proximoDiaDoCoach, diaAnteriorDoCoach, diaFalado, promessaDas18h, type Combinado } from "./combinado";
import { prazoFalado } from "./task-actions";
import { casalCurto, linhasDoPlacar, mesAnterior, placarParaModelo, validarPlacar, type LeituraDoPlacar } from "./placar";
import { pedidoDeEsquecer, trechoLiteral, validarItens } from "./memoria";
import { arejado, checagemSemIa, limparTexto } from "./conferir";
import { comoMedirComAgora } from "./objetivos";
import { comoAcompanho, conversaDoCoach, nomesDoCasal, repeteAMensagem, tipoDoCompromisso } from "./coach-v2";
import type { CoachMessage } from "./types";

const combinado = (status: Combinado["status"], extra: Partial<Combinado> = {}): Combinado => ({ id: "c1", dia: "2026-10-02", titulo: "Pedir ao Jonas a assinatura do contrato", ate: "12:00", objetivo_id: null, status, origem: "manha", tarefa_id: "t1", motivo: null, mensagem_id: "m1", proposto_em: "2026-10-02T11:00:00Z", aceito_em: null, resolvido_em: null, ...extra });

describe("combinado do dia", () => {
 test("aceite curto vale; frase com outro pedido não", () => {
  for (const s of ["ok", "Ok!", "fechado", "Fechou", "beleza", "👍", "bora", "pode ser", "sim", "combinado", "pode deixar"]) expect(eAceite(s)).toBe(true);
  for (const s of ["ok mas prefiro ligar pro Guilherme", "não", "quais tenho abertas?", "fechado amanhã de manhã eu vejo com a Paula e depois decido"]) expect(eAceite(s)).toBe(false);
 });
 test("recusa curta", () => {
  for (const s of ["não", "Agora não", "hoje não", "pula"]) expect(eRecusa(s)).toBe(true);
  expect(eRecusa("não, prefiro fazer a proposta do Guilherme")).toBe(false);
 });
 test("resposta das 18h: sim, não e amanhã", () => {
  expect(resultadoCurto("sim")).toBe("feito");
  expect(resultadoCurto("Saiu!")).toBe("feito");
  expect(resultadoCurto("já fiz")).toBe("feito");
  expect(resultadoCurto("não deu")).toBe("nao_deu");
  expect(resultadoCurto("ainda não")).toBe("nao_deu");
  expect(resultadoCurto("amanhã")).toBe("adiado");
  expect(resultadoCurto("fica pra amanhã")).toBe("adiado");
  expect(resultadoCurto("não, o Jonas não respondeu e eu fiquei preso na entrevista da tarde")).toBeNull();
 });
 test("hora do combinado", () => {
  expect(horaValida("12:00")).toBe("12:00");
  expect(horaValida("9h")).toBe("09:00");
  expect(horaValida("14h30")).toBe("14:30");
  expect(horaValida("25:00")).toBeNull();
  expect(horaValida("")).toBeNull();
 });
 test("frase do combinado como aparece na mensagem", () => {
  expect(fraseDoCombinado({ titulo: "Pedir ao Jonas a assinatura do contrato", ate: "12:00" })).toBe("até 12h, pedir ao Jonas a assinatura do contrato");
  expect(fraseDoCombinado({ titulo: "Ligar para o Guilherme", ate: "14:30" })).toBe("até 14h30, ligar para o Guilherme");
  expect(fraseDoCombinado({ titulo: "Mandar a proposta", ate: null })).toBe("mandar a proposta");
 });
 test("18h: pergunta o aceito, reconhece o feito, cala no resto", () => {
  expect(mensagemDas18h(combinado("aceito"))).toBe("Combinado de hoje: pedir ao Jonas a assinatura do contrato.\n\nSaiu? Responda sim, não ou amanhã.");
  expect(mensagemDas18h(combinado("feito"))).toContain("Vi que saiu");
  for (const s of ["proposto", "expirado", "recusado", "nao_deu", "adiado"] as const) expect(mensagemDas18h(combinado(s))).toBeNull();
  expect(mensagemDas18h(null)).toBeNull();
 });
 test("fim de semana no fuso de Brasília", () => {
  expect(fimDeSemana("America/Sao_Paulo", new Date("2026-10-03T12:00:00Z"))).toBe(true);
  expect(fimDeSemana("America/Sao_Paulo", new Date("2026-10-05T02:00:00Z"))).toBe(true);
  expect(fimDeSemana("America/Sao_Paulo", new Date("2026-10-05T04:00:00Z"))).toBe(false);
  expect(diaSeguinte("2026-10-31")).toBe("2026-11-01");
 });
});

const placarCru = {
 version: 1, mes: "2026-10", atualizado_em: "2026-10-02T11:00:00Z",
 contratos: [], contratos_mes_anterior: 4,
 carteira: [{ casal: "Jonas & Belleboni", etapa: "Contrato enviado", desde: "2026-09-29T15:00:00Z" }, { casal: "Marcela & Luiza", etapa: "1ª Reunião", desde: null }],
 convidados: { mes: { hospedagem: { quantidade: 0, valor: 0 }, passeio: { quantidade: 6, valor: 1656 }, presente: { quantidade: 0, valor: 0 }, passagem: { quantidade: 0, valor: 0 } }, mes_anterior: { hospedagem: { quantidade: 57, valor: 568732 }, passeio: { quantidade: 38, valor: 28862 }, presente: { quantidade: 42, valor: 29814 }, passagem: { quantidade: 2, valor: 13088 } } },
 limitacoes: [],
};
describe("dias do Coach", () => {
 test("na sexta, 'amanhã' vai para segunda quando o fim de semana está desligado", () => {
  expect(proximoDiaDoCoach("2026-10-02", false)).toBe("2026-10-05");
  expect(proximoDiaDoCoach("2026-10-02", true)).toBe("2026-10-03");
  expect(proximoDiaDoCoach("2026-10-05", false)).toBe("2026-10-06");
  expect(diaAnteriorDoCoach("2026-10-05", false)).toBe("2026-10-02");
  expect(diaAnteriorDoCoach("2026-10-06", false)).toBe("2026-10-05");
  expect(diaFalado("2026-10-05", "2026-10-02")).toBe("segunda, 05/10");
  expect(diaFalado("2026-10-03", "2026-10-02")).toBe("amanhã");
  expect(diaFalado("2026-10-02", "2026-10-05")).toBe("sexta, 02/10");
 });
 test("'Às 18h te pergunto' só quando a pergunta das 18h ainda vai sair", () => {
  const tz = "America/Sao_Paulo";
  expect(promessaDas18h(tz, new Date("2026-10-02T14:00:00Z"), false)).toBe("Às 18h te pergunto.");
  expect(promessaDas18h(tz, new Date("2026-10-02T22:30:00Z"), false)).toBe("");
  expect(promessaDas18h(tz, new Date("2026-10-03T14:00:00Z"), false)).toBe("");
  expect(promessaDas18h(tz, new Date("2026-10-03T14:00:00Z"), true)).toBe("Às 18h te pergunto.");
  expect(promessaDas18h(tz, new Date("2026-10-02T14:00:00Z"), false, 18, false)).toBe("");
  const perfil = { morning_enabled: true, evening_enabled: true, weekly_enabled: true, morning_hour: 8, evening_hour: 18, review_day: 5 };
  expect(comoAcompanho(perfil)).toBe("às 8h dos dias úteis proponho um passo, às 18h pergunto se saiu e na sexta reviso a semana");
  expect(comoAcompanho({ ...perfil, evening_enabled: false })).toBe("às 8h dos dias úteis proponho um passo e na sexta reviso a semana");
  expect(comoAcompanho({ ...perfil, morning_enabled: false, evening_enabled: false, weekly_enabled: false })).toBe("só quando você me chamar");
 });
 test("'me lembra amanhã' ganha prazo mesmo se a IA esquecer", () => {
  expect(prazoFalado("Me lembra de ligar pro Guilherme amanhã às 10h", "2026-10-02")).toBe("2026-10-03");
  expect(prazoFalado("ligar hoje", "2026-10-02")).toBe("2026-10-02");
  expect(prazoFalado("depois de amanhã eu vejo", "2026-10-02")).toBe("2026-10-04");
  expect(prazoFalado("hoje não, amanhã", "2026-10-02")).toBeNull();
  expect(prazoFalado("ligar pro Guilherme", "2026-10-02")).toBeNull();
 });
});

describe("voz", () => {
 test("casal pelos primeiros nomes", () => {
  expect(casalCurto("Jéssica Santos & Bruno Freitas")).toBe("Jéssica e Bruno");
  expect(casalCurto("Cássia Serrazine & Daniel")).toBe("Cássia e Daniel");
  expect(casalCurto("Marcela & Luiza")).toBe("Marcela e Luiza");
  expect(casalCurto("Jonas")).toBe("Jonas");
 });
 test("primeira linha que só repete a mensagem dele volta para reescrever", () => {
  const msg = "Meus focos: vender pelo menos 5 contratos por mês e fazer a área de convidados vender mais hospedagens, voos e passeios.";
  expect(repeteAMensagem("Seus focos são contratos e vendas aos convidados.\n\nOutubro: 0 contratos.", msg)).toBe(true);
  expect(repeteAMensagem("Contratos: outubro está em 0 de 5. Jéssica e Bruno já estão com o contrato.", msg)).toBe(false);
  expect(repeteAMensagem("Oi, Vitor.", "Oi")).toBe(false);
 });
 test("justificativa genérica e ponto e vírgula não passam", () => {
  expect(checagemSemIa("Envie à Jéssica.\n\nEsse é o caminho mais direto para avançar.", 6).join(" ")).toContain("justificativa genérica");
  expect(checagemSemIa("Reuniões: 17 ações; nenhuma andou.", 6).join(" ")).toContain("ponto e vírgula");
 });
});

describe("placar", () => {
 test("só passa o que tem forma certa", () => {
  expect(validarPlacar(placarCru, "2026-10").contratos_mes_anterior).toBe(4);
  expect(() => validarPlacar({ ...placarCru, mes: "2026-09" }, "2026-10")).toThrow();
  expect(() => validarPlacar({ ...placarCru, contratos: [{ casal: "", data: "x" }] }, "2026-10")).toThrow();
  expect(() => validarPlacar({ ...placarCru, convidados: { mes: {} } }, "2026-10")).toThrow();
  const semPassagem = { ...placarCru.convidados.mes, passagem: undefined };
  expect(() => validarPlacar({ ...placarCru, convidados: { ...placarCru.convidados, mes: semPassagem } }, "2026-10")).toThrow();
  expect(mesAnterior("2026-01")).toBe("2025-12");
 });
 test("frases prontas com a meta e o mês anterior", () => {
  const leitura: LeituraDoPlacar = { status: "ok", placar: validarPlacar(placarCru, "2026-10"), de_quando: "2026-10-02T11:00:00Z" };
  const l = linhasDoPlacar(leitura, 5, "America/Sao_Paulo")!;
  expect(l.contratos).toBe("Contratos: outubro está em 0 de 5. Setembro fechou com 4.");
  expect(l.resumo_contratos).toBe("Outubro: 0 de 5 contratos");
  expect(l.convidados).toBe("Convidados: em outubro, 6 passeios. Setembro fechou com 57 hospedagens, 38 passeios, 42 presentes e 2 passagens.");
  expect(l.negociacoes[0]).toBe("Jonas e Belleboni: Contrato enviado desde 29/09");
  expect(linhasDoPlacar(leitura, null, "America/Sao_Paulo")!.contratos).toBe("Contratos: nenhum em outubro até agora. Setembro fechou com 4.");
  const comDois = { ...leitura, placar: { ...leitura.placar!, contratos: [{ casal: "Ana Souza & Leo Lima", data: "2026-10-01T15:00:00Z", valor: null }, { casal: "Bia & Caio", data: "2026-10-02T15:00:00Z", valor: null }] } };
  expect(linhasDoPlacar(comDois, 5, "America/Sao_Paulo")!.contratos).toBe("Contratos: outubro está em 2 de 5, com Ana e Leo, Bia e Caio. Setembro fechou com 4.");
  expect(l.resumo_convidados).toBe("Outubro: 6 passeios");
  const m = placarParaModelo(leitura, 5, "America/Sao_Paulo") as Record<string, unknown>;
  expect(m.faltam_para_a_meta).toBe(5);
  expect((m.convidados as { mes_anterior: { passagens: number; total_de_vendas: number } }).mes_anterior).toMatchObject({ passagens: 2, total_de_vendas: 139 });
  expect((m.negociacoes_do_vitor as { desde: string | null }[])[0].desde).toBe("29/09");
 });
 test("placar não lido nunca vira zero", () => {
  const m = placarParaModelo({ status: "indisponivel", placar: null, de_quando: null }, 5, "America/Sao_Paulo") as Record<string, unknown>;
  expect(m.lido).toBe(false);
  expect(JSON.stringify(m)).not.toContain("0 de 5");
  expect(linhasDoPlacar({ status: "nao_configurado", placar: null, de_quando: null }, 5, "America/Sao_Paulo")).toBeNull();
 });
});

describe("memória", () => {
 const msg = "Preciso que voce me ajuda tendo em mente que meus dois principais focos são:\nVender mais, pelo menos 5 contratos no mes\nE fazer a área de convidados vender mais hospedagens, voos e passeios";
 test("o trecho tem que ser literal da mensagem", () => {
  expect(trechoLiteral(msg, "Vender mais, pelo menos 5 contratos no mês")).toBe(true);
  expect(trechoLiteral(msg, "vender 10 contratos")).toBe(false);
 });
 test("só entra item com trecho literal e que ainda não está guardado", () => {
  const itens = validarItens({ itens: [
   { tipo: "foco", texto: "Vender pelo menos 5 contratos por mês", trecho: "Vender mais, pelo menos 5 contratos no mes" },
   { tipo: "foco", texto: "Convidados comprando mais hospedagem, voos e passeios", trecho: "fazer a área de convidados vender mais hospedagens, voos e passeios" },
   { tipo: "fato", texto: "Inventado", trecho: "isso não está na mensagem" },
  ] }, msg, ["Convidados comprando mais hospedagem, voos e passeios"]);
  expect(itens.map(i => i.texto)).toEqual(["Vender pelo menos 5 contratos por mês"]);
 });
 test("pedido de esquecer", () => {
  for (const s of ["esquece", "Esquece isso", "apaga isso", "não guarda isso"]) expect(pedidoDeEsquecer(s)).toBe(true);
  expect(pedidoDeEsquecer("esquece a reunião de amanhã e marca outra")).toBe(false);
 });
});

describe("conferente sem IA", () => {
 test("barra rodapé, texto interno, linhas e perguntas demais", () => {
  expect(checagemSemIa("Outubro: 0 de 5 contratos.\n\nHoje tem 2 casais.", 6)).toEqual([]);
  expect(checagemSemIa("SEM_NOVIDADE", 6).length).toBe(1);
  expect(checagemSemIa("**Orientação**\n\nTexto", 6).length).toBe(1);
  expect(checagemSemIa("Concluí t3 e t4.", 6).length).toBe(1);
  expect(checagemSemIa("Sem observações verificadas sobre sua conduta nas reuniões.", 6).length).toBe(1);
  expect(checagemSemIa("a\nb\nc\nd\ne\nf\ng", 6)[0]).toContain("7 linhas");
  expect(checagemSemIa("Saiu? E o Jonas?", 6)[0]).toContain("pergunta");
  expect(checagemSemIa("Preciso de orientação para escolher.", 6)).toEqual([]);
 });
 test("texto limpo e arejado", () => {
  expect(limparTexto("**Outubro:** 0 de 5\n\n\n\nHoje")).toBe("Outubro: 0 de 5\n\nHoje");
  expect(arejado("a\nb\n\nc")).toBe("a\n\nb\n\nc");
 });
});

describe("objetivos e agenda", () => {
 test("a linha Agora troca sem apagar o que a pessoa escreveu", () => {
  expect(comoMedirComAgora(null, "Outubro: 0 de 5 contratos (02/10)")).toBe("Agora: Outubro: 0 de 5 contratos (02/10)");
  expect(comoMedirComAgora("Contratos assinados e pagos.\nAgora: Setembro: 4 de 5 contratos (30/09)", "Outubro: 0 de 5 contratos (02/10)")).toBe("Contratos assinados e pagos.\nAgora: Outubro: 0 de 5 contratos (02/10)");
 });
 test("tipo de cada compromisso pela carteira", () => {
  const carteira = [{ casal: "Marcela & Luiza", etapa: "1ª Reunião", desde: null }, { casal: "Cássia Serrazine & Daniel", etapa: "1ª Reunião", desde: null }];
  expect(nomesDoCasal("DW | Cássia Serrazine & Daniel")).toEqual(["cassia", "daniel"]);
  expect(tipoDoCompromisso("Marcela e Luiza e Welcome Weddings", carteira)).toEqual({ tipo: "venda", casal: "Marcela e Luiza", etapa: "1ª Reunião" });
  expect(tipoDoCompromisso("Cássia e Daniel e Welcome Weddings", carteira).tipo).toBe("venda");
  expect(tipoDoCompromisso("Closer - Vanessa e Welcome Weddings", carteira).tipo).toBe("entrevista");
  expect(tipoDoCompromisso("Jéssica e Bruno + Welcome Weddings", carteira).tipo).toBe("possivel_venda");
  expect(tipoDoCompromisso("PENSAR ESTRATÉGICO", carteira).tipo).toBe("pensar");
  expect(tipoDoCompromisso("Daily Noix", carteira).tipo).toBe("interna");
 });
 test("a conversa do Coach deixa de fora o que o Assistente atendeu", () => {
  const m = (id: string, role: "user" | "assistant", content: string, autor?: "coach" | "assistente"): CoachMessage => ({ id, role, content, evidence: [], created_at: id, autor: autor ?? null });
  const c = conversaDoCoach([m("1", "user", "Quais tenho abertas?"), m("2", "assistant", "37 abertas", "assistente"), m("3", "user", "To sentindo falhar"), m("4", "assistant", "Outubro: 0 de 5", "coach")]);
  expect(c.map(x => x.texto)).toEqual(["To sentindo falhar", "Outubro: 0 de 5"]);
 });
});

describe("foco dito na conversa", () => {
 test("contratos e convidados ganham placar; o número vira meta", async () => {
  const { medidorDoFoco } = await import("./memoria");
  expect(medidorDoFoco("Vender pelo menos 5 contratos por mês")).toEqual({ medidor: "contratos_ww_mes", meta: 5 });
  expect(medidorDoFoco("Convidados comprando mais hospedagem, voos e passeios")).toEqual({ medidor: "convidados_site_mes", meta: null });
  expect(medidorDoFoco("Cuidar da saúde")).toEqual({ medidor: null, meta: null });
 });
});

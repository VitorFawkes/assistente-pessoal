import { describe, expect, test } from "bun:test";
import {
  anoBR,
  dataBR,
  dataCurtaBR,
  dataHoraBR,
  diaBR,
  diaDaSemanaBR,
  diaMesBR,
  diasAteBR,
  ehAmanhaBR,
  ehHojeBR,
  ehOntemBR,
  fimDaSemanaBR,
  fimDoDiaBR,
  haQuantoTempoBR,
  hojeBR,
  horaBR,
  inicioDaSemanaBR,
  inicioDoDiaBR,
  inicioDoMesBR,
  jaPassouBR,
  maisDiasBR,
  paraCampoBR,
  proximoDiaDaSemanaBR,
  quandoBR,
} from "./data-br";

// A regra do Vitor: o horário é SEMPRE o de Brasília, em toda a plataforma.
// Estes testes são a garantia. Eles não dependem do fuso da máquina que roda:
// todo instante entra como UTC explícito e a resposta esperada é a de
// Brasília. Rodar com TZ=UTC, TZ=Asia/Tokyo ou TZ=America/Sao_Paulo tem que
// dar exatamente o mesmo resultado — é o que `bun run tz:check` confere.

describe("o dia é o de Brasília, não o do servidor", () => {
  test("01:47 UTC do dia 27 ainda é dia 26 em Brasília", () => {
    // O caso real: produção em UTC às 01:47 de 27/08 = 22:47 de 26/08 aqui.
    expect(diaBR("2026-08-27T01:47:00Z")).toBe("2026-08-26");
  });

  test("02:59 UTC ainda é o dia anterior; 03:01 UTC já virou", () => {
    expect(diaBR("2026-08-27T02:59:00Z")).toBe("2026-08-26");
    expect(diaBR("2026-08-27T03:01:00Z")).toBe("2026-08-27");
  });

  test("meia-noite em Brasília é 03:00 UTC", () => {
    expect(horaBR("2026-08-27T03:00:00Z")).toBe("00h00");
  });

  test("hojeBR olha pro relógio de Brasília", () => {
    expect(hojeBR("2026-08-27T01:47:00Z")).toBe("2026-08-26");
  });
});

describe("distância em dias conta dia de calendário daqui", () => {
  test("mesmo dia de Brasília, horas diferentes, é zero", () => {
    expect(diasAteBR("2026-08-26T12:00:00Z", "2026-08-27T01:47:00Z")).toBe(0);
  });

  test("um dia pra frente e um pra trás", () => {
    expect(diasAteBR("2026-08-27T12:00:00Z", "2026-08-26T12:00:00Z")).toBe(1);
    expect(diasAteBR("2026-08-25T12:00:00Z", "2026-08-26T12:00:00Z")).toBe(-1);
  });

  test("hoje, ontem, amanhã e já passou", () => {
    const agora = "2026-08-27T01:47:00Z"; // 26/08 22h47 aqui
    expect(ehHojeBR("2026-08-26T14:00:00Z", agora)).toBe(true);
    expect(ehOntemBR("2026-08-25T14:00:00Z", agora)).toBe(true);
    expect(ehAmanhaBR("2026-08-27T14:00:00Z", agora)).toBe(true);
    expect(jaPassouBR("2026-08-25T14:00:00Z", agora)).toBe(true);
    expect(jaPassouBR("2026-08-26T23:00:00Z", agora)).toBe(false);
  });

  test("uma tarefa que vence hoje NÃO pode aparecer como atrasada às 22h", () => {
    // Era o erro: às 22h47 daqui o servidor em UTC já achava que era amanhã,
    // e o que vencia hoje virava "atrasada".
    const agora = "2026-08-27T01:47:00Z";
    const venceHoje = fimDoDiaBR("2026-08-26")!;
    expect(jaPassouBR(venceHoje, agora)).toBe(false);
    expect(ehHojeBR(venceHoje, agora)).toBe(true);
  });
});

describe("mostrar", () => {
  test("data curta, dia/mês, data cheia e hora", () => {
    const d = "2026-08-14T18:30:00Z"; // 14/08 15h30 aqui
    expect(dataCurtaBR(d)).toBe("sex 14/08");
    expect(diaMesBR(d)).toBe("14/08");
    expect(dataBR(d)).toBe("14/08/2026");
    expect(horaBR(d)).toBe("15h30");
    expect(dataHoraBR(d)).toBe("14/08 às 15h30");
  });

  test("dia da semana é o daqui, mesmo virando o dia em UTC", () => {
    // 2026-08-27T01:00Z = quarta 26/08 22h aqui (quarta = 3)
    expect(diaDaSemanaBR("2026-08-27T01:00:00Z")).toBe(3);
  });

  test("quandoBR fala como gente", () => {
    const agora = new Date();
    const hojeCedo = new Date(agora.getTime() - 3 * 3_600_000);
    const ontem = new Date(agora.getTime() - 26 * 3_600_000);
    expect(quandoBR(hojeCedo)).toBe(`hoje ${horaBR(hojeCedo)}`);
    // "ontem" só vale se de fato virou o dia AQUI (perto da meia-noite pode não ter virado)
    const rotuloOntem = quandoBR(ontem);
    expect(
      rotuloOntem === `ontem ${horaBR(ontem)}` || rotuloOntem === `hoje ${horaBR(ontem)}`,
    ).toBe(true);
    // e uma data de outro ano vem com o ano junto
    expect(quandoBR("2019-03-07T15:00:00Z")).toBe("07/03/2019");
  });

  test("haQuantoTempoBR: hoje, ontem, há N dias e a data", () => {
    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 86_400_000);
    const oitoDias = new Date(hoje.getTime() - 8 * 86_400_000);
    expect(haQuantoTempoBR(hoje)).toBe("hoje");
    expect(haQuantoTempoBR(ontem)).toBe("ontem");
    expect(haQuantoTempoBR(oitoDias)).toBe("há 8 dias");
    expect(haQuantoTempoBR(null)).toBeNull();
  });

  test("data inválida não vira 'Invalid Date' na tela", () => {
    expect(quandoBR(null)).toBe("");
    expect(quandoBR("banana")).toBe("");
    expect(paraCampoBR(null)).toBe("");
  });
});

describe("campo de data guarda o dia certo", () => {
  test("fim do dia 14/08 aqui é 15/08 02:59 em UTC", () => {
    // Brasília está em UTC−3: 23:59 daqui é 02:59 do dia seguinte lá.
    expect(fimDoDiaBR("2026-08-14")).toBe("2026-08-15T02:59:00.000Z");
  });

  test("começo do dia 14/08 aqui é 14/08 03:00 em UTC", () => {
    expect(inicioDoDiaBR("2026-08-14")).toBe("2026-08-14T03:00:00.000Z");
  });

  test("ida e volta não perde o dia", () => {
    for (const dia of ["2026-01-01", "2026-08-14", "2026-12-31", "2026-02-28"]) {
      expect(paraCampoBR(fimDoDiaBR(dia)!)).toBe(dia);
      expect(paraCampoBR(inicioDoDiaBR(dia)!)).toBe(dia);
    }
  });

  test("dia mal escrito não vira data errada, vira nada", () => {
    expect(fimDoDiaBR("")).toBeNull();
    expect(fimDoDiaBR("14/08/2026")).toBeNull();
    expect(inicioDoDiaBR("2026-8-4")).toBeNull();
  });
});

describe("andar no calendário", () => {
  const base = "2026-08-27T01:47:00Z"; // quarta 26/08, 22h47 aqui

  test("somar e subtrair dias", () => {
    expect(maisDiasBR(1, base)).toBe("2026-08-27");
    expect(maisDiasBR(-1, base)).toBe("2026-08-25");
    expect(maisDiasBR(7, base)).toBe("2026-09-02");
  });

  test("próxima sexta a partir de uma quarta", () => {
    expect(proximoDiaDaSemanaBR(5, base)).toBe("2026-08-28");
  });

  test("pedir o mesmo dia da semana devolve o da semana que vem", () => {
    expect(proximoDiaDaSemanaBR(3, base)).toBe("2026-09-02");
  });

  test("semana e mês", () => {
    expect(inicioDaSemanaBR(base)).toBe("2026-08-23"); // domingo
    expect(fimDaSemanaBR(base)).toBe("2026-08-29"); // sábado
    expect(inicioDoMesBR(base)).toBe("2026-08-01");
  });

  test("virada de mês e de ano contam do jeito certo", () => {
    // 01/01 02:00 em UTC ainda é 31/12 23:00 aqui: o dia base é o daqui.
    expect(maisDiasBR(0, "2026-01-01T02:00:00Z")).toBe("2025-12-31");
    expect(maisDiasBR(1, "2026-01-01T02:00:00Z")).toBe("2026-01-01");
    expect(maisDiasBR(1, "2026-12-31T20:00:00Z")).toBe("2027-01-01");
    expect(anoBR("2026-01-01T02:00:00Z")).toBe("2025");
  });
});

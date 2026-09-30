import { describe, expect, it } from "bun:test";
import { chamadosDaReuniao, decidir, lerLegenda, montarConversa, nomeLimpo, pessoasDaReuniao, type Candidato, type ContextoDaDecisao } from "./teams";

const VITOR = "vitor@welcometrips.com.br";
const TIAGO = "tiago@welcometrips.com.br";
const PAULA = "paula@welcometrips.com.br";
const V_GRAVOU = VITOR;

const reuniao = (x: Partial<Candidato> = {}): Candidato => ({
  chave: "AAMk-1",
  organizador: TIAGO,
  convidados: [VITOR, PAULA, "fulano@agencia.com"],
  inicio: "2026-09-28T13:00:00Z",
  fim: "2026-09-28T13:30:00Z",
  assunto: "Daily Weddings",
  ...x,
});

const ctx = (x: Partial<ContextoDaDecisao> = {}): ContextoDaDecisao => ({
  liberados: new Set([VITOR]),
  welcome: new Set([VITOR, TIAGO, PAULA]),
  jaTem: new Set(),
  chegando: new Set(),
  gravadasAqui: new Map(),
  ...x,
});

describe("decidir", () => {
  it("quer a reunião de quem não usa o Ações quando alguém que usa estava nela", () => {
    expect(decidir(reuniao(), ctx())).toEqual({ quero: true, motivo: "nova" });
  });

  it("não quer se ninguém da reunião usa o Ações", () => {
    expect(decidir(reuniao({ convidados: [PAULA] }), ctx()).quero).toBe(false);
  });

  it("não quer reunião marcada por quem não é da Welcome (caixa de fora ou genérica)", () => {
    expect(decidir(reuniao({ organizador: "contato@agencia.com" }), ctx()).motivo).toBe("quem marcou não é da Welcome");
  });

  it("não quer duas vezes a mesma ocorrência", () => {
    expect(decidir(reuniao(), ctx({ jaTem: new Set([`${TIAGO}|AAMk-1`]) })).motivo).toBe("já está no Ações");
    // outra ocorrência da mesma reunião repetida continua valendo
    expect(decidir(reuniao({ chave: "AAMk-2" }), ctx({ jaTem: new Set([`${TIAGO}|AAMk-1`]) })).quero).toBe(true);
  });

  it("quem marcou já gravou pelo Ações na mesma hora: a gravação dele vale", () => {
    const antes = Date.parse("2026-09-28T12:50:00Z");
    expect(decidir(reuniao(), ctx({ gravadasAqui: new Map([[TIAGO, [antes]]]) })).motivo).toBe("quem marcou já gravou pelo Ações");
    const outraHora = Date.parse("2026-09-28T15:00:00Z");
    expect(decidir(reuniao(), ctx({ gravadasAqui: new Map([[TIAGO, [outraHora]]]) })).quero).toBe(true);
  });

  it("quem usa o Ações e gravou a mesma reunião pela aba não recebe a cópia do Teams", () => {
    const naHora = Date.parse("2026-09-28T13:05:00Z");
    const vitorGravou = ctx({ gravadasAqui: new Map([[V_GRAVOU, [naHora]]]) });
    // Vitor era o único que usa o Ações: ninguém precisa da cópia
    expect(decidir(reuniao(), vitorGravou)).toEqual({ quero: false, motivo: "quem usa o Ações já gravou pelo Ações" });
    // com a Paula liberada, a reunião vem, mas só a Paula é chamada
    const comPaula = ctx({ liberados: new Set([VITOR, PAULA]), gravadasAqui: new Map([[VITOR, [naHora]]]) });
    expect(decidir(reuniao(), comPaula).quero).toBe(true);
    expect(chamadosDaReuniao(reuniao(), comPaula)).toEqual([PAULA]);
  });

  it("a que está chegando do Teams continua querida (a transcrição entra nela)", () => {
    expect(decidir(reuniao(), ctx({ chegando: new Set([`${TIAGO}|AAMk-1`]) }))).toEqual({ quero: true, motivo: "chegando" });
    // chegando, mas quem marcou gravou pelo Ações na mesma hora: deixa de ser querida (e sai)
    const antes = Date.parse("2026-09-28T12:50:00Z");
    const gravou = ctx({ chegando: new Set([`${TIAGO}|AAMk-1`]), gravadasAqui: new Map([[TIAGO, [antes]]]) });
    expect(decidir(reuniao(), gravou).quero).toBe(false);
  });

  it("e-mail em maiúscula conta igual", () => {
    expect(decidir(reuniao({ organizador: "Tiago@WelcomeTrips.com.br" }), ctx()).quero).toBe(true);
  });

  it("pessoas da reunião: quem marcou primeiro, só gente da Welcome, sem repetir", () => {
    expect(pessoasDaReuniao(reuniao({ convidados: [PAULA, VITOR, TIAGO, "x@y.com"] }), ctx().welcome)).toEqual([TIAGO, PAULA, VITOR]);
  });
});

const VTT = `WEBVTT

0f3a/12-0
00:00:02.360 --> 00:00:04.980
<v Tiago Silva>Bom dia, pessoal.</v>

0f3a/13-0
00:00:05.120 --> 00:00:08.400
<v Tiago Silva>Vamos começar
pelo relatório.</v>

0f3a/14-0
00:00:09.000 --> 00:00:12.000
<v Vitor Gambetti | Welcome Trips>Fechado. Eu mando até sexta.</v>

0f3a/15-0
00:00:12.500 --> 00:00:13.000
sem nome aqui

0f3a/16-0
01:02:03.000 --> 01:02:05.500
<v Paula Klotz (Convidado)>Combinado.</v>
`;

describe("lerLegenda", () => {
  it("lê tempo, nome e fala de várias linhas", () => {
    const f = lerLegenda(VTT);
    expect(f[0]).toEqual({ quem: "Tiago Silva", inicio: 2.36, fim: 4.98, texto: "Bom dia, pessoal." });
    expect(f[1].texto).toBe("Vamos começar pelo relatório.");
    expect(f[2].quem).toBe("Vitor Gambetti");
    expect(f[3]).toEqual({ quem: null, inicio: 12.5, fim: 13, texto: "sem nome aqui" });
    expect(f[4]).toEqual({ quem: "Paula Klotz", inicio: 3723, fim: 3725.5, texto: "Combinado." });
  });

  it("aceita tempo sem hora e quebra de linha do Windows", () => {
    const f = lerLegenda("WEBVTT\r\n\r\n00:01.000 --> 00:02,500\r\n<v Ana>Oi</v>\r\n");
    expect(f).toEqual([{ quem: "Ana", inicio: 1, fim: 2.5, texto: "Oi" }]);
  });

  it("nome limpo", () => {
    expect(nomeLimpo("Paula Klotz | Welcome Trips")).toBe("Paula Klotz");
    expect(nomeLimpo("  Ana   Tereza (Guest) ")).toBe("Ana Tereza");
  });
});

describe("montarConversa", () => {
  it("cada nome vira uma letra, falas seguidas da mesma pessoa viram uma só", () => {
    const c = montarConversa([{ criado: "2026-09-28T13:01:00Z", vtt: VTT }]);
    expect(c.labels).toEqual({ A: "Tiago Silva", B: "Vitor Gambetti", C: "Paula Klotz" });
    expect(c.segments.map((s) => s.speaker)).toEqual(["A", "B", "C"]);
    expect(c.segments[0]).toEqual({ speaker: "A", start: 2.36, end: 8.4, text: "Bom dia, pessoal. Vamos começar pelo relatório." });
    // fala sem nome fica com quem falava antes
    expect(c.segments[1].text).toBe("Fechado. Eu mando até sexta. sem nome aqui");
    expect(c.texto.split("\n")[1]).toBe("Vitor Gambetti: Fechado. Eu mando até sexta. sem nome aqui");
    expect(c.duracao).toBe(3726);
  });

  it("a segunda transcrição (parou e voltou a gravar) começa na hora em que foi criada", () => {
    const a = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>Primeira parte.</v>\n";
    const b = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Bruno>Voltamos.</v>\n";
    const c = montarConversa([
      { criado: "2026-09-28T13:10:00Z", vtt: b },
      { criado: "2026-09-28T13:00:00Z", vtt: a },
    ]);
    expect(c.segments).toEqual([
      { speaker: "A", start: 1, end: 2, text: "Primeira parte." },
      { speaker: "B", start: 601, end: 603, text: "Voltamos." },
    ]);
    expect(c.duracao).toBe(603);
  });

  it("começo sem nome vira Participante", () => {
    const c = montarConversa([{ criado: "2026-09-28T13:00:00Z", vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nalô\n" }]);
    expect(c.labels).toEqual({ A: "Participante" });
  });
});

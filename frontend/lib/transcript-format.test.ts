import { expect, test, describe } from "bun:test";
import {
  groupTurns,
  coerceSegments,
  speakerName,
  fmtClock,
  toPlainText,
  type Segment,
} from "./transcript-format";

const segs: Segment[] = [
  { speaker: "A", start: 0, end: 3, text: "Oi pessoal. " },
  { speaker: "A", start: 3, end: 5, text: "Vamos começar. " },
  { speaker: "B", start: 6, end: 9, text: "Bora. " },
  { speaker: "A", start: 65, end: 70, text: "Próximo ponto. " },
];

describe("groupTurns", () => {
  test("agrupa segmentos consecutivos do mesmo speaker", () => {
    const turns = groupTurns(segs);
    expect(turns).toHaveLength(3);
    expect(turns[0].speaker).toBe("A");
    expect(turns[0].text).toBe("Oi pessoal. Vamos começar. ");
    expect(turns[0].segmentIndices).toEqual([0, 1]);
    expect(turns[1].speaker).toBe("B");
    expect(turns[2].start).toBe(65);
  });

  test("lista vazia pra entrada vazia", () => {
    expect(groupTurns([])).toEqual([]);
  });
});

describe("coerceSegments", () => {
  test("aceita array direto", () => {
    expect(coerceSegments(segs)).toHaveLength(4);
  });
  test("parseia string JSON", () => {
    expect(coerceSegments(JSON.stringify(segs))).toHaveLength(4);
  });
  test("retorna [] pra lixo", () => {
    expect(coerceSegments(null)).toEqual([]);
    expect(coerceSegments("oi")).toEqual([]);
  });
});

describe("speakerName", () => {
  test("usa label quando existe", () => {
    expect(speakerName("A", { A: "Vitor" })).toBe("Vitor");
  });
  test("sem nome ainda, cai em \"Voz X\"", () => {
    expect(speakerName("B", { A: "Vitor" })).toBe("Voz B");
  });
});

describe("fmtClock", () => {
  test("mm:ss abaixo de 1h", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(65)).toBe("1:05");
  });
  test("h:mm:ss acima de 1h", () => {
    expect(fmtClock(3725)).toBe("1:02:05");
  });
});

describe("toPlainText", () => {
  test("uma linha por turn com nome e horário", () => {
    const out = toPlainText(segs, { A: "Vitor", B: "Marcelo" });
    expect(out).toBe(
      "[0:00] Vitor: Oi pessoal. Vamos começar.\n" +
        "[0:06] Marcelo: Bora.\n" +
        "[1:05] Vitor: Próximo ponto.",
    );
  });
  test("sem nome salvo, sai \"Voz X\"", () => {
    const out = toPlainText([{ speaker: "A", start: 0, end: 1, text: "oi" }], {});
    expect(out).toBe("[0:00] Voz A: oi");
  });
});

import { toSrt, toVtt } from "./transcript-format";

describe("toSrt", () => {
  test("um bloco por segmento com timestamp srt e nome", () => {
    const out = toSrt(
      [
        { speaker: "A", start: 0, end: 2.5, text: "Oi" },
        { speaker: "B", start: 3, end: 4.2, text: "Bora" },
      ],
      { A: "Vitor", B: "Marcelo" },
    );
    expect(out).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\nVitor: Oi\n\n" +
        "2\n00:00:03,000 --> 00:00:04,200\nMarcelo: Bora\n",
    );
  });
});

describe("toVtt", () => {
  test("cabeçalho WEBVTT + timestamps com ponto", () => {
    const out = toVtt([{ speaker: "A", start: 0, end: 2.5, text: "Oi" }], { A: "Vitor" });
    expect(out).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nVitor: Oi\n");
  });
});

import { toMarkdown, filterBySection, participantNames, type Section } from "./transcript-format";

describe("toMarkdown", () => {
  test("cabeçalho com título, data, participantes + corpo", () => {
    const out = toMarkdown(
      [
        { speaker: "A", start: 0, end: 3, text: "Oi" },
        { speaker: "B", start: 4, end: 6, text: "Bora" },
      ],
      { A: "Vitor", B: "Marcelo" },
      { title: "Reunião X", dateLabel: "23/06/2026", participants: ["Vitor", "Marcelo"] },
    );
    expect(out).toBe(
      "# Reunião X\n\n" +
        "**Data:** 23/06/2026  \n" +
        "**Participantes:** Vitor, Marcelo\n\n" +
        "---\n\n" +
        "**[0:00] Vitor:** Oi\n\n" +
        "**[0:04] Marcelo:** Bora\n",
    );
  });
});

describe("filterBySection", () => {
  const segs: Segment[] = [
    { speaker: "A", start: 0, end: 10, text: "intro" },
    { speaker: "A", start: 60, end: 70, text: "financeiro" },
    { speaker: "A", start: 130, end: 140, text: "contratação" },
  ];
  const sections: Section[] = [
    { start_seconds: 0, title: "Abertura" },
    { start_seconds: 60, title: "Financeiro" },
    { start_seconds: 120, title: "Contratação" },
  ];
  test("seção do meio pega só os segmentos do intervalo", () => {
    const out = filterBySection(segs, sections, 1, 200);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("financeiro");
  });
  test("última seção vai até a duração", () => {
    const out = filterBySection(segs, sections, 2, 200);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("contratação");
  });
});

describe("participantNames", () => {
  test("nomes distintos na ordem de aparição", () => {
    const out = participantNames(
      [
        { speaker: "B", start: 0, end: 1, text: "x" },
        { speaker: "A", start: 2, end: 3, text: "y" },
        { speaker: "B", start: 4, end: 5, text: "z" },
      ],
      { A: "Vitor", B: "Marcelo" },
    );
    expect(out).toEqual(["Marcelo", "Vitor"]);
  });
});

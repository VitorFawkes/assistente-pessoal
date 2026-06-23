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
  test("fallback Speaker X", () => {
    expect(speakerName("B", { A: "Vitor" })).toBe("Speaker B");
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
  test("fallback Speaker X sem labels", () => {
    const out = toPlainText([{ speaker: "A", start: 0, end: 1, text: "oi" }], {});
    expect(out).toBe("[0:00] Speaker A: oi");
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

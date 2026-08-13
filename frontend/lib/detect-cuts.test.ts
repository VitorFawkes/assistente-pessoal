import { expect, test, describe } from "bun:test";
import { detectCuts, validateManualCuts, DETECT_CONSTANTS, type Segment } from "./detect-cuts";

function makeSeg(speaker: string, start: number, end: number, text = ""): Segment {
  return { speaker, start, end, text };
}

describe("detectCuts", () => {
  test("retorna lista vazia para áudio sem silêncios longos", () => {
    const segs: Segment[] = [];
    for (let i = 0; i < 100; i++) {
      segs.push(makeSeg("A", i * 10, i * 10 + 8, "tudo seguido"));
    }
    const cuts = detectCuts(segs, 1000);
    expect(cuts).toHaveLength(0);
  });

  test("detecta silêncio HARD (>180s) como corte forte", () => {
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 900, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].at_seconds).toBe(800);
    expect(cuts[0].confidence).toBeGreaterThanOrEqual(1.0);
    expect(cuts[0].reasons.some((r) => r.includes("silêncio"))).toBe(true);
  });

  test("silêncio SOFT (entre SOFT e HARD) sozinho fica abaixo do floor e é filtrado", () => {
    // Gap de 12s — entre SOFT=10 e HARD=20. Peso 0.5, abaixo do CONFIDENCE_FLOOR=0.7.
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 712, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(0);
  });

  test("silêncio SOFT + speaker novo entra acima do floor", () => {
    const segs: Segment[] = [];
    for (let t = 0; t < 700; t += 10) segs.push(makeSeg("A", t, t + 8));
    // Gap de 14s + speakers totalmente novos (B,C) → 0.5 + 0.5 = 1.0
    for (let t = 714; t < 1500; t += 10) {
      const sp = t % 20 === 0 ? "B" : "C";
      segs.push(makeSeg(sp, t, t + 8));
    }
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].confidence).toBeGreaterThanOrEqual(1.0);
    expect(cuts[0].reasons.some((r) => r.includes("speakers"))).toBe(true);
  });

  test("descarta cortes que criariam segmento < MIN_SEGMENT_DURATION (600s)", () => {
    const segs: Segment[] = [
      makeSeg("A", 0, 300),
      makeSeg("A", 500, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(0);
  });

  test("merge: cortes a menos de MERGE_DISTANCE (300s) mantém o de maior confidence", () => {
    const segs: Segment[] = [];
    for (let t = 0; t < 700; t += 10) segs.push(makeSeg("A", t, t + 8));
    for (let t = 820; t < 900; t += 10) segs.push(makeSeg(t % 20 === 0 ? "B" : "C", t, t + 8));
    for (let t = 1100; t < 2000; t += 10) segs.push(makeSeg("D", t, t + 8));
    const cuts = detectCuts(segs, 2000);
    expect(cuts).toHaveLength(1);
  });

  test("input vazio retorna lista vazia", () => {
    expect(detectCuts([], 0)).toHaveLength(0);
    expect(detectCuts([], 1000)).toHaveLength(0);
  });

  test("um único segmento retorna lista vazia", () => {
    expect(detectCuts([makeSeg("A", 0, 1000)], 1000)).toHaveLength(0);
  });

  test("reasons inclui descrição legível", () => {
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 1000, 1700),
    ];
    const cuts = detectCuts(segs, 1700);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].reasons[0]).toMatch(/silêncio.*5min/);
  });
});

describe("validateManualCuts", () => {
  test("aceita cortes que respeitam o piso", () => {
    const r = validateManualCuts([60], 200, 30);
    expect(r.ok).toBe(true);
  });
  test("rejeita trecho menor que o piso", () => {
    const r = validateManualCuts([10], 200, 30); // primeiro trecho = 10s
    expect(r.ok).toBe(false);
    expect(r.tooShort).toBe(10);
  });
  test("rejeita corte fora do intervalo", () => {
    expect(validateManualCuts([0], 200, 30).ok).toBe(false);
    expect(validateManualCuts([200], 200, 30).ok).toBe(false);
  });
  test("piso automático de 10min ainda bloqueia trecho de 5min", () => {
    const r = validateManualCuts([300], 1200, DETECT_CONSTANTS.MIN_SEGMENT_DURATION);
    expect(r.ok).toBe(false);
  });

  test("pedaço descartado não precisa respeitar o piso", () => {
    // trecho 0 = 10s (curto demais), mas vai pro lixo
    expect(validateManualCuts([10], 200, 30, [0]).ok).toBe(true);
    // o trecho que fica continua sendo cobrado
    expect(validateManualCuts([10], 35, 30, [0]).ok).toBe(false);
  });

  test("descartar o índice errado não afrouxa o piso do que fica", () => {
    const r = validateManualCuts([10], 200, 30, [1]);
    expect(r.ok).toBe(false);
    expect(r.tooShort).toBe(10);
  });

  test("corte fora do intervalo continua barrado mesmo com descarte", () => {
    expect(validateManualCuts([0], 200, 30, [0, 1]).ok).toBe(false);
  });
});

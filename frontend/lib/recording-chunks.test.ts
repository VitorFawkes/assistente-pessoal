import { expect, test, describe } from "bun:test";

describe("chunk ordering", () => {
  test("sorts chunks correctly in numeric order", () => {
    const chunks = ["10.webm", "2.webm", "1.webm", "20.webm", "3.webm"];
    const sorted = chunks
      .sort((a, b) => {
        const numA = parseInt(a.split(".")[0]);
        const numB = parseInt(b.split(".")[0]);
        return numA - numB;
      });

    expect(sorted).toEqual(["1.webm", "2.webm", "3.webm", "10.webm", "20.webm"]);
  });

  test("handles single chunk", () => {
    const chunks = ["0.webm"];
    const sorted = chunks.sort((a, b) => {
      const numA = parseInt(a.split(".")[0]);
      const numB = parseInt(b.split(".")[0]);
      return numA - numB;
    });

    expect(sorted).toEqual(["0.webm"]);
  });

  test("filters out non-webm files", () => {
    const chunks = ["0.webm", "concat.txt", "1.webm", "2.webm"];
    const webmOnly = chunks.filter((f) => f.endsWith(".webm"));

    expect(webmOnly).toEqual(["0.webm", "1.webm", "2.webm"]);
  });

  test("generates concat content correctly", () => {
    const chunks = ["0.webm", "1.webm", "2.webm"];
    const baseDir = "/audios/tmp/user123/session456";
    const concatContent = chunks
      .map((chunk) => `file '${baseDir}/${chunk}'`)
      .join("\n");

    const expectedLines = [
      "file '/audios/tmp/user123/session456/0.webm'",
      "file '/audios/tmp/user123/session456/1.webm'",
      "file '/audios/tmp/user123/session456/2.webm'",
    ];

    expect(concatContent).toEqual(expectedLines.join("\n"));
  });

  test("handles large chunk counts", () => {
    const chunks = Array.from({ length: 1000 }, (_, i) => `${i}.webm`);
    const sorted = chunks.sort((a, b) => {
      const numA = parseInt(a.split(".")[0]);
      const numB = parseInt(b.split(".")[0]);
      return numA - numB;
    });

    expect(sorted[0]).toBe("0.webm");
    expect(sorted[999]).toBe("999.webm");
    expect(sorted.length).toBe(1000);
  });
});

describe("date directory formatting", () => {
  test("formats date correctly for storage", () => {
    const date = new Date("2026-09-24");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dateDir = `${year}/${month}`;

    expect(dateDir).toBe("2026/09");
  });

  test("pads month with leading zero", () => {
    const date = new Date("2026-01-15");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dateDir = `${year}/${month}`;

    expect(dateDir).toBe("2026/01");
  });
});

describe("session ID validation", () => {
  test("validates UUID format", () => {
    const uuid = crypto.randomUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    expect(uuidRegex.test(uuid)).toBe(true);
  });

  test("rejects invalid UUIDs", () => {
    const invalidIds = ["not-a-uuid", "12345", ""];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    invalidIds.forEach((id) => {
      expect(uuidRegex.test(id)).toBe(false);
    });
  });
});

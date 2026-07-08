import { describe, it, expect } from "bun:test";
import { anexoDownloadResponse } from "./anexo-serve";
import { EXT_CONTENT_TYPE, shouldInline } from "./anexos";

// Formatos "principais" que o Vitor quer baixar. Para cada um, a resposta de
// download precisa: content-type correto, disposição coerente (inline p/
// preview vs attachment), nosniff + CSP, e o corpo idêntico ao original.
const FORMATOS: { filename: string; ct: string }[] = [
  { filename: "doc.pdf", ct: EXT_CONTENT_TYPE.pdf },
  { filename: "foto.png", ct: EXT_CONTENT_TYPE.png },
  { filename: "foto.jpg", ct: EXT_CONTENT_TYPE.jpg },
  { filename: "planilha.xlsx", ct: EXT_CONTENT_TYPE.xlsx },
  { filename: "texto.docx", ct: EXT_CONTENT_TYPE.docx },
  { filename: "slides.pptx", ct: EXT_CONTENT_TYPE.pptx },
  { filename: "dados.csv", ct: EXT_CONTENT_TYPE.csv },
  { filename: "pacote.zip", ct: EXT_CONTENT_TYPE.zip },
  { filename: "video.mp4", ct: EXT_CONTENT_TYPE.mp4 },
  { filename: "vetor.svg", ct: EXT_CONTENT_TYPE.svg },
];

describe("anexoDownloadResponse — principais formatos baixam certo", () => {
  for (const f of FORMATOS) {
    it(`${f.filename} → ${f.ct}`, async () => {
      const original = new Uint8Array([1, 2, 3, 250, 0, 128, 255, 64]);
      const res = anexoDownloadResponse(
        { filename: f.filename, content_type: f.ct, size_bytes: original.length, conteudo: Buffer.from(original) },
        false,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(f.ct);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");

      const disp = res.headers.get("content-disposition") ?? "";
      const expectInline = shouldInline(f.ct);
      expect(disp.startsWith(expectInline ? "inline" : "attachment")).toBe(true);
      expect(disp).toContain('filename="');

      // corpo íntegro
      const got = new Uint8Array(await res.arrayBuffer());
      expect(got.length).toBe(original.length);
      expect(Array.from(got)).toEqual(Array.from(original));
    });
  }

  it("?dl=1 (forceAttachment) força download mesmo em imagem", async () => {
    const res = anexoDownloadResponse(
      { filename: "foto.png", content_type: "image/png", size_bytes: 3, conteudo: Buffer.from([1, 2, 3]) },
      true,
    );
    expect((res.headers.get("content-disposition") ?? "").startsWith("attachment")).toBe(true);
  });

  it("svg nunca faz preview inline (anti-XSS)", () => {
    expect(shouldInline("image/svg+xml")).toBe(false);
  });
});

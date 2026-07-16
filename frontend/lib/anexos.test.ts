import { describe, it, expect } from "bun:test";
import {
  extname,
  ensureNamed,
  isAllowedFile,
  resolveContentType,
  shouldInline,
  sanitizeFilename,
  formatBytes,
  normalizeUrl,
  isProbablyUrl,
  linkLabel,
  contentDisposition,
  downloadHeaders,
  MAX_FILE_BYTES,
} from "./anexos";

describe("extname / allowlist", () => {
  it("extrai extensão em minúsculo", () => {
    expect(extname("Relatório.PDF")).toBe("pdf");
    expect(extname("arquivo.tar.gz")).toBe("gz");
    expect(extname("semponto")).toBe("");
    expect(extname(".gitignore")).toBe("");
  });

  it("aceita os principais formatos e rejeita executáveis/scripts", () => {
    for (const ok of ["a.pdf", "b.png", "c.jpg", "d.docx", "e.xlsx", "f.pptx", "g.csv", "h.zip", "i.mp4", "j.txt", "k.json", "lp.html", "lp.htm"]) {
      expect(isAllowedFile(ok)).toBe(true);
    }
    for (const bad of ["x.js", "x.exe", "x.sh", "x.bat", "x.app", "noext"]) {
      expect(isAllowedFile(bad)).toBe(false);
    }
  });
});

describe("ensureNamed", () => {
  it("preserva arquivo que já tem nome com extensão (permitida ou não)", () => {
    const html = new File(["<!DOCTYPE html>"], "sugestao-lp.html", { type: "text/html" });
    expect(ensureNamed(html)).toBe(html); // NUNCA renomear pra colado-*.png
    const exe = new File(["MZ"], "setup.exe", { type: "application/x-msdownload" });
    expect(ensureNamed(exe)).toBe(exe); // segue pro isAllowedFile → toast de rejeição
  });
  it("sintetiza nome só pra blob colado sem nome/extensão", () => {
    const blob = new File(["x"], "", { type: "image/png" });
    expect(ensureNamed(blob).name).toMatch(/^colado-\d+\.png$/);
    const pdf = new File(["x"], "blob", { type: "application/pdf" });
    expect(ensureNamed(pdf).name).toMatch(/^colado-\d+\.pdf$/);
  });
});

describe("resolveContentType", () => {
  it("a extensão manda sobre o content-type do cliente (que pode mentir)", () => {
    expect(resolveContentType("foto.png", "text/html")).toBe("image/png");
    expect(resolveContentType("pagina.html", "image/png")).toBe("text/html");
    expect(resolveContentType("planilha.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
  it("cai no cliente e depois em octet-stream se extensão desconhecida", () => {
    expect(resolveContentType("x.desconhecido", "application/x-custom")).toBe("application/x-custom");
    expect(resolveContentType("x.desconhecido", "lixo sem barra")).toBe("application/octet-stream");
    expect(resolveContentType("x.desconhecido")).toBe("application/octet-stream");
  });
});

describe("shouldInline", () => {
  it("imagens comuns e pdf fazem preview; svg e o resto baixam", () => {
    expect(shouldInline("image/png")).toBe(true);
    expect(shouldInline("image/jpeg")).toBe(true);
    expect(shouldInline("application/pdf")).toBe(true);
    expect(shouldInline("image/svg+xml")).toBe(false);
    expect(shouldInline("application/zip")).toBe(false);
    expect(shouldInline("text/html")).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("tira path, controle e aspas; mantém acento e espaço; nunca vazio", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\Relatório final.xlsx")).toBe("Relatório final.xlsx");
    expect(sanitizeFilename('a"b.png')).toBe("ab.png");
    expect(sanitizeFilename("")).toBe("arquivo");
    expect(sanitizeFilename("   ")).toBe("arquivo");
  });
});

describe("formatBytes", () => {
  it("formata legível", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("normalizeUrl / isProbablyUrl", () => {
  it("promove domínio nu a https e preserva http(s)", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("example.com/a/b?x=1")).toBe("https://example.com/a/b?x=1");
    expect(normalizeUrl("http://a.com")).toBe("http://a.com/");
    expect(normalizeUrl("https://a.com/p")).toBe("https://a.com/p");
  });
  it("rejeita protocolos perigosos e texto que não é link", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,<script>")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("só um texto qualquer")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull(); // sem TLD
    expect(normalizeUrl("")).toBeNull();
    expect(isProbablyUrl("notion.so/pagina")).toBe(true);
    expect(isProbablyUrl("comprar leite")).toBe(false);
  });
});

describe("linkLabel", () => {
  it("usa título se houver, senão host+path sem www", () => {
    expect(linkLabel("https://www.notion.so/x/y", "Meu doc")).toBe("Meu doc");
    expect(linkLabel("https://www.notion.so/x/y")).toBe("notion.so/x/y");
    expect(linkLabel("https://drive.google.com/")).toBe("drive.google.com");
  });
});

describe("contentDisposition", () => {
  it("attachment/inline com filename ASCII + filename* RFC5987", () => {
    const att = contentDisposition("relatório.pdf", true);
    expect(att.startsWith("attachment;")).toBe(true);
    expect(att).toContain("filename*=UTF-8''relat%C3%B3rio.pdf");
    const inl = contentDisposition("a.png", false);
    expect(inl.startsWith("inline;")).toBe(true);
  });
});

describe("downloadHeaders", () => {
  it("seguros: nosniff + CSP sandbox sempre; inline p/ imagem, attachment p/ svg", () => {
    const png = downloadHeaders({ filename: "a.png", contentType: "image/png", size: 10 });
    expect(png["X-Content-Type-Options"]).toBe("nosniff");
    expect(png["Content-Security-Policy"]).toContain("sandbox");
    expect(png["Content-Disposition"].startsWith("inline")).toBe(true);
    expect(png["Content-Length"]).toBe("10");

    const svg = downloadHeaders({ filename: "x.svg", contentType: "image/svg+xml" });
    expect(svg["Content-Disposition"].startsWith("attachment")).toBe(true);

    const html = downloadHeaders({ filename: "lp.html", contentType: "text/html" });
    expect(html["Content-Disposition"].startsWith("attachment")).toBe(true);

    const forced = downloadHeaders({ filename: "a.png", contentType: "image/png", forceAttachment: true });
    expect(forced["Content-Disposition"].startsWith("attachment")).toBe(true);
  });
});

describe("cap de tamanho", () => {
  it("25 MB", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});

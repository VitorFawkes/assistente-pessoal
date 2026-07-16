// Anexos de tarefa — helpers PUROS (sem dependência de Next/pg), testáveis com
// `bun test`. Concentram a lógica que garante que "os principais formatos de
// arquivo funcionem para serem baixados": allowlist, content-type por extensão,
// cap de tamanho, sanitização de nome, detecção de URL e headers de download.

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// Allowlist extensão → content-type. É a fonte da verdade: arquivo cuja
// extensão não está aqui é REJEITADO (defesa contra .js/.exe servidos da
// nossa origem). Cobre os principais formatos de trabalho. Formatos que podem
// carregar script (html, svg) são permitidos mas NUNCA inline — só download
// (attachment + nosniff + CSP sandbox), então não executam na nossa origem.
export const EXT_CONTENT_TYPE: Record<string, string> = {
  // imagens
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  // documentos
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
  // texto / dados
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  log: "text/plain",
  // arquivos compactados
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
  // áudio / vídeo
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // design
  psd: "image/vnd.adobe.photoshop",
  ai: "application/pdf",
  sketch: "application/octet-stream",
  fig: "application/octet-stream",
};

// Content-types que é SEGURO servir inline (preview no navegador). Todo o resto
// vai como attachment. SVG fica FORA de propósito (pode carregar script) — é
// imagem mas só baixa, nunca inline.
const INLINE_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "application/pdf",
]);

/** Extensão em minúsculo, sem o ponto. "" se não houver. */
export function extname(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Arquivo é permitido? (extensão na allowlist) */
export function isAllowedFile(filename: string): boolean {
  return extname(filename) in EXT_CONTENT_TYPE;
}

// Screenshots colados vêm sem nome → sintetiza um com extensão pela mime.
function extFromType(t: string): string {
  const m: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return m[t] || "";
}

/**
 * Garante um nome utilizável pro upload. Só sintetiza nome pra blob colado
 * SEM nome/extensão; arquivo que já tem extensão passa intacto — se ela não
 * for permitida, a validação (isAllowedFile) rejeita com o nome verdadeiro,
 * em vez de renomear silenciosamente pra colado-*.png (bug do .html→png).
 */
export function ensureNamed(file: File): File {
  if (file.name && extname(file.name)) return file;
  const ext = extFromType(file.type) || "png";
  const name = `colado-${Date.now()}.${ext}`;
  const renamed = new File([file], name, { type: file.type || "image/png" });
  if (renamed.name !== name) {
    // Bun 1.3 (testes): o construtor mantém o nome antigo de um part File cujo
    // .name já foi lido, ignorando o fileName passado. No browser não acontece.
    Object.defineProperty(renamed, "name", { value: name });
  }
  return renamed;
}

/**
 * Content-type confiável para servir. A extensão manda (o content-type que o
 * cliente envia pode mentir); só cai no do cliente/octet-stream se a extensão
 * for desconhecida.
 */
export function resolveContentType(filename: string, clientType?: string | null): string {
  const ext = extname(filename);
  if (ext in EXT_CONTENT_TYPE) return EXT_CONTENT_TYPE[ext];
  const c = (clientType || "").trim().toLowerCase();
  if (c && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(c)) return c;
  return "application/octet-stream";
}

/** Serve inline (preview) ou força download? */
export function shouldInline(contentType: string): boolean {
  return INLINE_SAFE.has(contentType.split(";")[0].trim().toLowerCase());
}

/**
 * Nome de arquivo seguro: só o basename, sem separadores de path, controles ou
 * aspas; colapsa espaços e limita tamanho. Nunca vazio (fallback "arquivo").
 */
export function sanitizeFilename(name: string): string {
  const base = (name || "").split(/[\\/]/).pop() ?? "";
  let out = "";
  for (const ch of base) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) continue; // controles
    if (ch === '"') continue;
    out += ch;
  }
  const cleaned = out.replace(/\s+/g, " ").trim().slice(0, 200);
  return cleaned || "arquivo";
}

/** Tamanho legível: 1.2 MB, 340 KB, 12 B. */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

// ─── links ────────────────────────────────────────────────────────────

/**
 * Normaliza texto colado em uma URL http(s) válida, ou null se não for link.
 * - aceita "example.com/x" (assume https://)
 * - rejeita protocolos perigosos (javascript:, data:, file:, etc.)
 */
export function normalizeUrl(raw: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  // URL não tem espaço no meio; só aceita se já vier http(s):// sem espaço.
  if (/\s/.test(text) && !/^https?:\/\/\S+$/i.test(text)) return null;
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    // sem esquema: só promove a https:// se parecer domínio (tem ponto + TLD)
    if (!/^[^\s/]+\.[^\s/]{2,}/.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  return u.toString();
}

/** Heurística leve pra UI: o texto parece uma URL? */
export function isProbablyUrl(raw: string): boolean {
  return normalizeUrl(raw) !== null;
}

/** Rótulo curto pra um link: host sem www + começo do path. */
export function linkLabel(url: string, titulo?: string | null): string {
  if (titulo && titulo.trim()) return titulo.trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return url;
  }
}

// ─── headers de download ────────────────────────────────────────────────

/**
 * Content-Disposition com filename ASCII seguro + filename* (RFC 5987) pra
 * nomes com acento/unicode. attachment força salvar; inline permite preview.
 */
export function contentDisposition(filename: string, attachment: boolean): string {
  const safe = sanitizeFilename(filename);
  // troca qualquer não-ASCII-imprimível por "_" no fallback ASCII
  const ascii = safe.replace(/[^ -~]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  const type = attachment ? "attachment" : "inline";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Headers pra a resposta de download de um arquivo. Aplica:
 * - Content-Type confiável (por extensão)
 * - nosniff (o navegador respeita o Content-Type declarado)
 * - CSP sandbox (neutraliza script embutido — SVG/PDF/HTML)
 * - Content-Disposition inline (formatos seguros) ou attachment (o resto)
 */
export function downloadHeaders(opts: {
  filename: string;
  contentType: string;
  size?: number | null;
  forceAttachment?: boolean;
}): Record<string, string> {
  const inline = !opts.forceAttachment && shouldInline(opts.contentType);
  const h: Record<string, string> = {
    "Content-Type": opts.contentType,
    "Content-Disposition": contentDisposition(opts.filename, !inline),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox;",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  if (opts.size != null && Number.isFinite(opts.size)) {
    h["Content-Length"] = String(opts.size);
  }
  return h;
}

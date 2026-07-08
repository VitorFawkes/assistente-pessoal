import { NextResponse } from "next/server";
import { downloadHeaders } from "@/lib/anexos";

// Linha de anexo-arquivo vinda do Postgres (conteudo = bytea → Buffer no pg).
export type AnexoFileRow = {
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  conteudo: Buffer | Uint8Array;
};

/**
 * Monta a resposta de download de um anexo-arquivo. Compartilhado entre a rota
 * do dono e a do convidado — a única diferença entre elas é COMO a linha é
 * buscada (RLS do tenant vs. withGuest + membership); os headers são idênticos.
 * `forceAttachment` (?dl=1) força salvar mesmo em formatos que fariam preview.
 */
export function anexoDownloadResponse(row: AnexoFileRow, forceAttachment: boolean): NextResponse {
  const bytes = new Uint8Array(row.conteudo as Uint8Array);
  const headers = downloadHeaders({
    filename: row.filename || "arquivo",
    contentType: row.content_type || "application/octet-stream",
    size: bytes.byteLength,
    forceAttachment,
  });
  return new NextResponse(bytes, { status: 200, headers });
}

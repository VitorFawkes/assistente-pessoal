import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import {
  MAX_FILE_BYTES,
  isAllowedFile,
  resolveContentType,
  sanitizeFilename,
  normalizeUrl,
} from "@/lib/anexos";

type Ctx = { params: Promise<{ id: string }> };

// Colunas de metadado devolvidas ao cliente (NUNCA o bytea `conteudo`).
const ANEXO_META =
  "id, tipo, url, titulo, filename, content_type, size_bytes, created_at";

/**
 * GET /api/tarefas/[id]/anexos — lista os anexos (metadados) da tarefa.
 * (A UI normalmente recebe via TAREFA_SELECT; este GET é conveniência/fallback.)
 */
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const rows = await withTenant(user.id, async (c) => {
    const t = await c.query("SELECT id FROM tarefas WHERE id = $1", [id]);
    if (!t.rows.length) return null;
    const r = await c.query(
      `SELECT ${ANEXO_META} FROM tarefa_anexos WHERE tarefa_id = $1 ORDER BY ordem, created_at`,
      [id],
    );
    return r.rows;
  });
  if (rows === null) return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
  return NextResponse.json({ anexos: rows });
});

/**
 * POST /api/tarefas/[id]/anexos — adiciona um anexo.
 *  - JSON  { url, titulo? }        → link
 *  - multipart/form-data (file)    → arquivo (bytea)
 * RLS garante que só o dono da tarefa insere (WITH CHECK herdado do USING).
 */
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const contentType = (req as NextRequest).headers.get("content-type") || "";

  try {
    // ── arquivo (multipart) ────────────────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const form = await (req as NextRequest).formData().catch(() => null);
      if (!form) return NextResponse.json({ error: "form inválido" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "campo 'file' ausente" }, { status: 400 });
      }
      if (!isAllowedFile(file.name)) {
        return NextResponse.json(
          { error: "tipo de arquivo não permitido", filename: file.name },
          { status: 415 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "arquivo muito grande", max_bytes: MAX_FILE_BYTES, size: file.size },
          { status: 413 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length === 0) return NextResponse.json({ error: "arquivo vazio" }, { status: 400 });
      if (buf.length > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "arquivo muito grande" }, { status: 413 });
      }
      const filename = sanitizeFilename(file.name);
      const ct = resolveContentType(file.name, file.type);
      const tituloForm = String(form.get("titulo") || "").trim() || null;

      const created = await withTenant(user.id, async (c) => {
        const t = await c.query("SELECT id FROM tarefas WHERE id = $1", [id]);
        if (!t.rows.length) return null;
        const r = await c.query(
          `INSERT INTO tarefa_anexos
             (tarefa_id, tipo, filename, content_type, size_bytes, conteudo, titulo, ordem)
           VALUES ($1, 'arquivo', $2, $3, $4, $5, $6,
             COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
           RETURNING ${ANEXO_META}`,
          [id, filename, ct, buf.length, buf, tituloForm],
        );
        return r.rows[0];
      });
      if (!created) return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
      return NextResponse.json(created, { status: 201 });
    }

    // ── link (JSON) ─────────────────────────────────────────────────────
    const body = (await (req as NextRequest).json().catch(() => null)) as {
      url?: string;
      titulo?: string;
    } | null;
    if (!body) return NextResponse.json({ error: "json inválido" }, { status: 400 });
    const url = normalizeUrl(body.url || "");
    if (!url) {
      return NextResponse.json({ error: "url inválida" }, { status: 400 });
    }
    const titulo = (body.titulo || "").trim().slice(0, 300) || null;

    const created = await withTenant(user.id, async (c) => {
      const t = await c.query("SELECT id FROM tarefas WHERE id = $1", [id]);
      if (!t.rows.length) return null;
      const r = await c.query(
        `INSERT INTO tarefa_anexos (tarefa_id, tipo, url, titulo, ordem)
         VALUES ($1, 'link', $2, $3,
           COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0))
         RETURNING ${ANEXO_META}`,
        [id, url, titulo],
      );
      return r.rows[0];
    });
    if (!created) return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

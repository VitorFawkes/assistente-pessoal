import { type NextRequest, NextResponse } from "next/server";
import { withGuest, membershipDoQuadro, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import {
  MAX_FILE_BYTES,
  isAllowedFile,
  resolveContentType,
  sanitizeFilename,
  normalizeUrl,
} from "@/lib/anexos";

type Ctx = { params: Promise<{ token: string; id: string }> };

const ANEXO_META =
  "id, tipo, url, titulo, filename, content_type, size_bytes, created_at";

/**
 * POST /api/q/[token]/tarefas/[id]/anexos — convidado adiciona anexo.
 *  - JSON  { url, titulo? }      → link
 *  - multipart/form-data (file)  → arquivo
 * Valida membership em quadro_tarefas e registra quem adicionou (auditoria).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token, id } = await ctx.params;
  const ip = clientIp(req.headers);
  const contentType = req.headers.get("content-type") || "";

  try {
    // Parse do corpo ANTES de abrir a transação (evita segurar conexão à toa).
    let mode: "file" | "link";
    let fileBuf: Buffer | null = null;
    let filename = "";
    let ct = "";
    let tituloForm: string | null = null;
    let url: string | null = null;
    let tituloLink: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      mode = "file";
      const form = await req.formData().catch(() => null);
      if (!form) return NextResponse.json({ error: "form inválido" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "campo 'file' ausente" }, { status: 400 });
      }
      if (!isAllowedFile(file.name)) {
        return NextResponse.json({ error: "tipo não permitido" }, { status: 415 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "arquivo muito grande" }, { status: 413 });
      }
      fileBuf = Buffer.from(await file.arrayBuffer());
      if (fileBuf.length === 0) return NextResponse.json({ error: "arquivo vazio" }, { status: 400 });
      if (fileBuf.length > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "arquivo muito grande" }, { status: 413 });
      }
      filename = sanitizeFilename(file.name);
      ct = resolveContentType(file.name, file.type);
      tituloForm = String(form.get("titulo") || "").trim() || null;
    } else {
      mode = "link";
      const body = (await req.json().catch(() => null)) as {
        url?: string;
        titulo?: string;
      } | null;
      if (!body) return NextResponse.json({ error: "json inválido" }, { status: 400 });
      url = normalizeUrl(body.url || "");
      if (!url) return NextResponse.json({ error: "url inválida" }, { status: 400 });
      tituloLink = (body.titulo || "").trim().slice(0, 300) || null;
    }

    const created = await withGuest(token, ip, async ({ acesso, c }) => {
      const isMember = await membershipDoQuadro(c, acesso.quadroId, id);
      if (!isMember) throw new Error("tarefa_not_in_board");

      if (mode === "file") {
        const r = await c.query(
          `INSERT INTO tarefa_anexos
             (tarefa_id, tipo, filename, content_type, size_bytes, conteudo, titulo, ordem, quadro_convidado_id)
           VALUES ($1, 'arquivo', $2, $3, $4, $5, $6,
             COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0), $7)
           RETURNING ${ANEXO_META}`,
          [id, filename, ct, fileBuf!.length, fileBuf, tituloForm, acesso.convidadoId],
        );
        return r.rows[0];
      }
      const r = await c.query(
        `INSERT INTO tarefa_anexos (tarefa_id, tipo, url, titulo, ordem, quadro_convidado_id)
         VALUES ($1, 'link', $2, $3,
           COALESCE((SELECT max(ordem) + 1 FROM tarefa_anexos WHERE tarefa_id = $1), 0), $4)
         RETURNING ${ANEXO_META}`,
        [id, url, tituloLink, acesso.convidadoId],
      );
      return r.rows[0];
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "tarefa_not_in_board") {
      return NextResponse.json(
        { error: "not_found", message: "Tarefa não está neste quadro." },
        { status: 404 },
      );
    }
    return guestErrorResponse(e);
  }
}

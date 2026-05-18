import { type NextRequest, NextResponse } from "next/server";
import { readdirSync, unlinkSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { withClient } from "@/lib/db";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const ADMIN_TOKEN = process.env.ADMIN_CLEANUP_TOKEN;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || req.nextUrl.searchParams.get("token");
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};

  try {
    await withClient(async (c) => {
      const ev = await c.query("DELETE FROM tarefa_eventos RETURNING id");
      result.tarefa_eventos_deleted = ev.rowCount ?? 0;
      const tarefas = await c.query("DELETE FROM tarefas RETURNING id");
      result.tarefas_deleted = tarefas.rowCount ?? 0;
      const meetings = await c.query("DELETE FROM meetings RETURNING id");
      result.meetings_deleted = meetings.rowCount ?? 0;
    });
  } catch (e) {
    result.db_error = e instanceof Error ? e.message : String(e);
  }

  try {
    const filesDeleted: string[] = [];
    for (const name of readdirSync(AUDIO_ROOT)) {
      const p = resolve(AUDIO_ROOT, name);
      try {
        const st = statSync(p);
        if (st.isFile()) {
          unlinkSync(p);
          filesDeleted.push(name);
        }
      } catch (_) {
        /* ignore */
      }
    }
    result.files_deleted = filesDeleted;
  } catch (e) {
    result.fs_error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(result);
}

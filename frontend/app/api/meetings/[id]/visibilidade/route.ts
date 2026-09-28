import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { garantirColegaDoTtars } from "@/lib/equipe-compartilhado";
import { podeTime, timeIdValido } from "@/lib/hub";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

// Quem vê a reunião (só quem gravou muda). "escolhidos" = quem estava + quem foi marcado; "so_eu" fecha; "todos"
// abre para a Welcome. Quem estava (convite do Teams, voz, marcado como "estava") nunca sai por aqui: fechar e reabrir
// devolve as mesmas pessoas. `acessos`, quando vem, é a lista inteira de MARCADOS para ver (pessoas e times).
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: {
    visibilidade?: string;
    acessos?: Array<{ user_id?: string; time_id?: string; email?: string }>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.visibilidade || !["todos", "so_eu", "escolhidos"].includes(body.visibilidade)) {
    return NextResponse.json({ error: "visibilidade deve ser: todos, so_eu ou escolhidos" }, { status: 400 });
  }

  // Marcados: pessoa da Welcome (e-mail; ganha conta aqui se ainda não tem) ou time que quem gravou enxerga.
  const pessoas = new Set<string>();
  const times = new Set<string>();
  if (Array.isArray(body.acessos)) {
    for (const a of body.acessos) {
      if (a.time_id !== undefined) {
        if (!(timeIdValido(a.time_id) && (await podeTime(user.id, a.time_id)))) {
          return NextResponse.json({ error: "Você não enxerga esse time." }, { status: 400 });
        }
        times.add(a.time_id);
        continue;
      }
      let uid = typeof a.user_id === "string" && UUID_RE.test(a.user_id) ? a.user_id : null;
      if (!uid && typeof a.email === "string" && a.email.trim()) uid = (await garantirColegaDoTtars(a.email))?.id ?? null;
      if (uid && uid !== user.id) pessoas.add(uid);
    }
  }

  try {
    const result = await withTenant(user.id, async (db) => {
      const dono = await db.query<{ user_id: string }>("SELECT user_id FROM meetings WHERE id = $1", [id]);
      if (dono.rowCount === 0) return { ok: false, error: "reunião não encontrada", status: 404 };
      if (dono.rows[0].user_id !== user.id) return { ok: false, error: "sem permissão", status: 403 };

      await db.query("UPDATE meetings SET visibilidade = $1 WHERE id = $2", [body.visibilidade, id]);

      if (Array.isArray(body.acessos)) {
        await db.query(
          `DELETE FROM meeting_acessos
            WHERE meeting_id = $1 AND motivo = 'quem_ve'
              AND NOT (COALESCE(user_id::text, '') = ANY ($2::text[]) OR COALESCE(time_id, '') = ANY ($3::text[]))`,
          [id, [...pessoas], [...times]],
        );
        for (const uid of pessoas) {
          await db.query(
            `INSERT INTO meeting_acessos (meeting_id, user_id, created_by, motivo) VALUES ($1, $2, $3, 'quem_ve') ON CONFLICT DO NOTHING`,
            [id, uid, user.id],
          );
        }
        for (const t of times) {
          await db.query(
            `INSERT INTO meeting_acessos (meeting_id, time_id, created_by, motivo) VALUES ($1, $2, $3, 'quem_ve') ON CONFLICT DO NOTHING`,
            [id, t, user.id],
          );
        }
      }
      return { ok: true, status: 200 };
    });

    if (result.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: result.error }, { status: result.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

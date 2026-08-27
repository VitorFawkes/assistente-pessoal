import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

type Segmento = { start?: number; end?: number; text?: string };

/** Tira acento, pontuação e espaço duplo — pra casar fala com trecho. */
function limpar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quantas palavras de 4+ letras os dois textos têm em comum. */
function emComum(a: string, b: string): number {
  const grandes = (s: string) => new Set(s.split(" ").filter((p) => p.length >= 4));
  const A = grandes(a);
  if (!A.size) return 0;
  let n = 0;
  for (const p of grandes(b)) if (A.has(p)) n++;
  return n;
}

/**
 * Em que minuto da gravação essa tarefa foi dita.
 *
 * A tarefa guarda o TRECHO da transcrição (`evidencia`), e a reunião guarda os
 * pedaços com o tempo de cada um (`meetings.segments`, com `start` em
 * segundos). Aqui a gente casa um com o outro e devolve o segundo em que
 * começa — é o que faz o play da tela de escolher tarefas cair na hora certa
 * em vez de tocar do começo.
 *
 * Sem trecho, sem segmentos ou sem casar nada: devolve `inicio: null`, e a
 * tela toca desde o começo em vez de mentir um minuto qualquer.
 */
export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const tarefaId = new URL(req.url).searchParams.get("tarefa");
  if (!tarefaId) {
    return NextResponse.json({ error: "falta a tarefa" }, { status: 400 });
  }

  const achado = await withTenant(user.id, async (c) => {
    const t = await c.query<{ evidencia: string | null; titulo: string }>(
      "SELECT evidencia, titulo FROM tarefas WHERE id = $1",
      [tarefaId],
    );
    if (!t.rows.length) return null;

    const m = await c.query<{ segments: Segmento[] | null; duration_seconds: number | null }>(
      "SELECT segments, duration_seconds FROM meetings WHERE id = $1",
      [id],
    );
    const segs = Array.isArray(m.rows[0]?.segments) ? m.rows[0]!.segments! : [];
    const alvo = limpar(t.rows[0].evidencia ?? t.rows[0].titulo);
    if (!alvo || !segs.length) return null;

    let melhor: { inicio: number; pontos: number } | null = null;
    for (const s of segs) {
      if (typeof s?.start !== "number" || typeof s?.text !== "string") continue;
      const pontos = emComum(alvo, limpar(s.text));
      if (pontos >= 3 && (!melhor || pontos > melhor.pontos)) {
        melhor = { inicio: Math.max(0, Math.floor(s.start)), pontos };
      }
    }
    return melhor;
  });

  return NextResponse.json({ inicio: achado?.inicio ?? null });
});

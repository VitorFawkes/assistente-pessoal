import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { labelSpeakersByContent } from "@/lib/label-speakers";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONF_MIN = 0.7;

type Seg = { speaker?: string; text?: string };
type Ctx = { params: Promise<{ id: string }> };

// Rotula speakers em branco pelo CONTEÚDO (a IA infere quem é cada um, esp. o Vitor).
// Fallback pra quando a voz não bate. Só preenche letras que ainda estão sem nome;
// não toca nas que a voz já confirmou. Não enrola voz (palpite de conteúdo ≠ voz).
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  try {
    const result = await withTenant(user.id, async (c) => {
      const m = (
        await c.query<{
          segments: Seg[] | null;
          speaker_labels: Record<string, string> | null;
          speaker_pessoas: Record<string, string> | null;
          executive_summary: string | null;
        }>(
          `SELECT segments, speaker_labels, speaker_pessoas,
                  raw_ai_response->>'executive_summary' AS executive_summary
             FROM meetings WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!m) throw new Error("meeting não encontrada");

      const segments = Array.isArray(m.segments) ? m.segments : [];
      const labels = { ...(m.speaker_labels || {}) };
      const pessoas = { ...(m.speaker_pessoas || {}) };

      const letters = [...new Set(segments.map((s) => s.speaker).filter((x): x is string => !!x))];
      const blanks = letters.filter((l) => !labels[l]);
      if (blanks.length === 0) return { applied: {}, reason: "nada em branco" };
      // sem resumo = ainda não processou; não chuta
      if (!m.executive_summary) return { applied: {}, reason: "sem resumo ainda" };

      // transcript rotulado (Speaker X: …), agrupando turnos consecutivos
      const lines: string[] = [];
      let cur = "";
      let buf: string[] = [];
      for (const s of segments) {
        const who = s.speaker ? labels[s.speaker] || `Speaker ${s.speaker}` : "?";
        const t = (s.text || "").trim();
        if (!t) continue;
        if (who === cur) buf.push(t);
        else {
          if (cur) lines.push(`${cur}: ${buf.join(" ")}`);
          cur = who;
          buf = [t];
        }
      }
      if (cur) lines.push(`${cur}: ${buf.join(" ")}`);
      const transcript = lines.join("\n");

      const known = (
        await c.query<{ nome: string }>(`SELECT nome FROM pessoas ORDER BY is_vitor DESC, nome`)
      ).rows.map((r) => r.nome);

      const guesses = await labelSpeakersByContent(transcript, { letters: blanks, knownPeople: known });

      const applied: Record<string, string> = {};
      for (const letter of blanks) {
        const g = guesses[letter];
        if (!g || g.nome === "?" || g.confidence < CONF_MIN) continue;
        const pr = await c.query<{ id: string }>(
          `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
           ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
          [user.id, g.nome],
        );
        labels[letter] = g.nome;
        pessoas[letter] = pr.rows[0].id;
        applied[letter] = g.nome;
      }

      if (Object.keys(applied).length > 0) {
        await c.query(
          `UPDATE meetings SET speaker_labels = $1::jsonb, speaker_pessoas = $2::jsonb WHERE id = $3`,
          [JSON.stringify(labels), JSON.stringify(pessoas), id],
        );
      }
      return { applied };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg.includes("não encontrada") ? 404 : 500 });
  }
});

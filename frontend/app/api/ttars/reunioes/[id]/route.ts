import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { meetingsFor, tarefasFor, teamAccessFor, type Tarefa } from "@/lib/queries";
import { meetingSubject } from "@/lib/meeting-label";
import { buildSpeakerCards } from "@/lib/speakers";
import { comProjetos } from "@/lib/equipe-compartilhado";
import { notionDasAcoes } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

type Detalhe = {
  id: string;
  user_id: string;
  user_nome: string | null;
  nome?: string | null;
  meeting_type: string | null;
  recorded_at: string | null;
  created_at: string;
  status: string;
  status_error: string | null;
  summary: string | null;
  executive_summary: string | null;
  duration_seconds: number | null;
  segments: { speaker: string; start: number; end: number; text: string }[] | null;
  speaker_labels: Record<string, string> | null;
  sections: { start_seconds: number; title: string }[] | null;
  visibilidade: string | null;
};

// A reunião como a tela do TTARS mostra: resumo, ações e (só pra quem gravou) quem falou e
// quem vê. Reunião de colega aberta pra mim: só leitura, sem conversa e sem vozes.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const m = (await meetingsFor(user.id).byIdDetailed(id)) as Detalhe | null;
  if (!m) return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  const souDono = m.user_id === user.id;

  let tarefas = (await tarefasFor(user.id).byMeeting(id)) as Tarefa[];
  if (souDono) tarefas = await comProjetos(user.id, tarefas);
  else tarefas = tarefas.map(({ mencoes: _m, parece_com: _p, evidencia: _e, ...t }) => ({ ...t, evidencia: null }) as Tarefa);
  const notion = await notionDasAcoes(tarefas.map((t) => t.id));

  const falantes =
    souDono && m.segments?.length
      ? buildSpeakerCards(m.segments, m.speaker_labels || {}).map((c) => ({
          letra: c.letter,
          nome: c.current_label,
          segundos: Math.round(c.total_seconds),
          falas: c.total_turns,
          trechos: c.top_turns.slice(0, 2).map((t) => t.text.trim().slice(0, 180)),
        }))
      : [];

  const acessos = souDono && isTeamMode() ? await teamAccessFor(user.id).listAcessos(id) : [];

  return NextResponse.json({
    reuniao: {
      id: m.id,
      rotulo: meetingSubject(m.summary, m.nome) || "Reunião",
      nome: m.nome ?? null,
      recorded_at: m.recorded_at ?? m.created_at,
      duration_seconds: m.duration_seconds,
      meeting_type: m.meeting_type,
      status: m.status,
      status_error: souDono ? m.status_error : null,
      visibilidade: m.visibilidade ?? "so_eu",
      sou_dono: souDono,
      dono_nome: m.user_nome,
      resumo: m.executive_summary,
      secoes: m.sections ?? [],
    },
    falantes,
    acessos,
    tarefas: tarefas.map((t) => ({
      ...t,
      reuniao_rotulo: meetingSubject(m.summary, m.nome) || "Reunião",
      notion: notion.get(t.id) ?? null,
    })),
  });
});

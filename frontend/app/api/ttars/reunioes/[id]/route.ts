import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { meetingsFor, tarefasFor, teamAccessFor, type Tarefa } from "@/lib/queries";
import { withTenant } from "@/lib/db";
import { getOwnerSlug } from "@/lib/owner-slug";
import { paraQuemVe } from "@/lib/compartilhar";
import { meetingSubject } from "@/lib/meeting-label";
import { buildSpeakerCards } from "@/lib/speakers";
import { comProjetos, nomesDeUsuarios } from "@/lib/equipe-compartilhado";
import { notionDasAcoes } from "@/lib/notion-sync";
import { trocarFalantes } from "@/lib/falantes";
import { nomesDosObjetivos } from "@/lib/hub";
import { quemVeDaReuniao } from "@/lib/quem-ve";
import { genteQueTambemFaz, quemTambemFaz } from "@/lib/ttars-tela";

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
  source: string;
  tem_audio: boolean;
  transcription: string | null;
};

type TarefaNaReuniao = Tarefa & {
  pode_puxar?: boolean;
  com_voce?: boolean;
  objetivo?: { id: string; nome: string } | null;
  objetivo_escondido?: boolean;
};

// A reunião como a tela do TTARS mostra: resumo, ações e (só pra quem gravou) quem falou e
// quem vê. Reunião de colega aberta pra mim: só leitura, sem conversa e sem vozes; quem foi
// chamado para ela (quem estava: convite do Teams, voz em "Quem falou" ou marcado; ou escolhido) pode puxar uma ação.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const m = (await meetingsFor(user.id).byIdDetailed(id)) as Detalhe | null;
  if (!m) return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  const souDono = m.user_id === user.id;

  let tarefas = (await tarefasFor(user.id).byMeeting(id)) as TarefaNaReuniao[];
  if (souDono) tarefas = await comProjetos(user.id, tarefas);
  else {
    // Do ponto de vista de quem vê: o "eu" de quem gravou vira o nome dele, a puxada vira "eu".
    const chamado = isTeamMode()
      ? (await withTenant(user.id, (c) => c.query<{ ok: boolean }>(`SELECT equipe_chamado_na_reuniao($1) AS ok`, [id]))).rows[0]?.ok === true
      : false;
    const nomes = await nomesDeUsuarios([m.user_id, user.id, ...tarefas.map((t) => t.responsavel_user_id)]);
    tarefas = tarefas.map(({ mencoes: _m, parece_com: _p, evidencia: _e, ...t }) => {
      const vista = paraQuemVe({ ...t, evidencia: null } as Tarefa, { viewerId: user.id, slug: getOwnerSlug(), nomes });
      const aberta = t.status !== "concluida" && t.status !== "cancelada";
      return {
        ...vista,
        pode_puxar: chamado && aberta && !t.responsavel_user_id,
        com_voce: t.responsavel_user_id === user.id,
      };
    });
  }
  // Objetivo que quem vê não enxerga: nem o nome nem o id saem (o painel mostra o cadeado).
  const objetivos = await nomesDosObjetivos(user.id, tarefas.map((t) => t.objetivo_id ?? "").filter(Boolean));
  tarefas = tarefas.map((t) => {
    const nome = t.objetivo_id ? objetivos.get(t.objetivo_id) : undefined;
    return { ...t, objetivo_id: nome ? t.objetivo_id : null, objetivo: nome ? { id: t.objetivo_id!, nome } : null, objetivo_escondido: !!t.objetivo_id && !nome };
  });
  const [notion, tambem] = await Promise.all([notionDasAcoes(tarefas.map((t) => t.id)), genteQueTambemFaz(tarefas as Tarefa[])]);

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

  const [acessos, quemVe] = souDono && isTeamMode()
    ? await Promise.all([teamAccessFor(user.id).listAcessos(id), quemVeDaReuniao(user.id, id)])
    : [[], null];
  const rotulo = trocarFalantes(meetingSubject(m.summary, m.nome), m.speaker_labels) || "Reunião";

  return NextResponse.json({
    reuniao: {
      id: m.id,
      rotulo,
      nome: m.nome ?? null,
      recorded_at: m.recorded_at ?? m.created_at,
      duration_seconds: m.duration_seconds,
      meeting_type: m.meeting_type,
      status: m.status,
      status_error: souDono ? m.status_error : null,
      visibilidade: m.visibilidade ?? "so_eu",
      sou_dono: souDono,
      dono_nome: m.user_nome,
      origem: m.source,
      tem_audio: m.tem_audio,
      // "Conversa inteira" só faz sentido com a conversa escrita pronta (colega não vê a conversa).
      tem_transcricao: souDono && !!m.transcription?.trim(),
      resumo: trocarFalantes(m.executive_summary, m.speaker_labels),
      secoes: m.sections ?? [],
    },
    falantes,
    acessos,
    // Só para quem gravou: quem estava (convite, voz ou marcado) e quem mais foi marcado para ver.
    quem_ve: quemVe,
    tarefas: tarefas.map((t) => ({
      ...t,
      ...quemTambemFaz(t as Tarefa, user.id, tambem),
      reuniao_rotulo: rotulo,
      notion: notion.get(t.id) ?? null,
    })),
  });
});

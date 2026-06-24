import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { frentesFor, tarefasFor } from "@/lib/queries";
import { parseCapture, precisaRevisao, type CaptureDraft } from "@/lib/capture";
import { ownersFor } from "@/lib/owners";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

async function transcrever(audio: File): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente");
  const form = new FormData();
  form.append("file", audio, audio.name || "captura.webm");
  form.append("model", process.env.TRANSCRIBE_MODEL || "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`transcrição ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export const POST = withAuth(async (user, req) => {
  const r = req as NextRequest;
  const contentType = r.headers.get("content-type") || "";

  let texto = "";
  let origem: "captura_texto" | "captura_voz" = "captura_texto";
  let meetingId: string | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await r.formData();
      const audio = form.get("audio");
      if (!(audio instanceof File)) {
        return NextResponse.json({ error: "áudio ausente" }, { status: 400 });
      }
      texto = await transcrever(audio);
      origem = "captura_voz";
    } else {
      const body = (await r.json()) as { texto?: string; meeting_id?: string };
      texto = (body.texto ?? "").trim();
      meetingId = body.meeting_id ?? null;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "entrada inválida" }, { status: 400 });
  }

  if (!texto) return NextResponse.json({ error: "nada pra capturar" }, { status: 400 });

  // Estrutura via GPT; se falhar, salva cru (captura nunca falha).
  let draft: CaptureDraft;
  let confidence: CaptureDraft["confidence"] | undefined;
  try {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
    const [frentes, owners] = await Promise.all([
      frentesFor(user.id).list(),
      ownersFor(user.id).list(),
    ]);
    draft = await parseCapture(texto, {
      hoje, tz: TZ,
      frentes: frentes.map((f) => ({ nome: f.nome })),
      owners: owners.map((o) => ({ name: o.name, is_me: o.is_me })),
    });
    confidence = draft.confidence;
  } catch (err) {
    console.error("[capturar] parseCapture falhou, salvando cru:", err);
    draft = {
      titulo: texto, descricao: null, owner: "vitor", acao: "executar",
      prazo: null, prazo_text: null, prioridade: "media", area_raw: null,
      pessoas: [], confidence: "low", confidence_rationale: "fallback: IA indisponível",
    };
  }

  const tarefa = await tarefasFor(user.id).criar(
    {
      titulo: draft.titulo || texto,
      descricao: draft.descricao,
      owner: draft.owner,
      acao: draft.acao,
      prazo: draft.prazo,
      prazo_text: draft.prazo_text,
      prioridade: draft.prioridade,
      area_raw: draft.area_raw,
      pessoas: draft.pessoas, // string[] → pessoas_raw → trigger
      precisa_revisao: precisaRevisao(draft),
      meeting_id: meetingId, // linka à reunião quando vier dos "próximos passos"
    },
    { origem, raw: texto, confidence },
  );

  // custo (best-effort, não bloqueia)
  void user; // usage_events opcional — ver nota
  return NextResponse.json(tarefa, { status: 201 });
});

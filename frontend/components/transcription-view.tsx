"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Check,
  X,
  UserRound,
  Sparkles,
  AudioLines,
  Scissors,
  BookmarkPlus,
  Split,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { groupTurns } from "@/lib/transcript-format";
import { CutBar } from "@/components/cut-bar";

// Nome canônico do dono do sistema (corresponde a pessoas.is_vitor=TRUE).
const SELF_NAME = "Vitor";

const HIGH_CONFIDENCE = 0.80;
const MIN_CONFIDENCE = 0.60;

export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type ProposedLabel = {
  pessoa_id: string;
  nome: string;
  confidence: number;
  sample_count: number;
  margin: number;
};

function speakerStyle(speaker: string): { bg: string; text: string } {
  const palette = [
    { bg: "bg-[color:var(--calm-bg)]", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]", text: "text-[color:var(--warm)]" },
    { bg: "bg-[color:var(--accent)]", text: "text-[color:var(--muted-strong)]" },
    { bg: "bg-[color:var(--urgent-bg)]", text: "text-[color:var(--urgent)]" },
    { bg: "bg-[color:var(--calm-bg)]/60", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]/60", text: "text-[color:var(--warm)]" },
  ];
  const idx = speaker.charCodeAt(0) - "A".charCodeAt(0);
  return palette[((idx % palette.length) + palette.length) % palette.length];
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const PESSOAS_DATALIST_ID = "speaker-pessoas-options";

function SpeakerChip({
  speaker,
  labels,
  proposed,
  onSave,
  saving,
}: {
  speaker: string;
  labels: Record<string, string>;
  proposed: ProposedLabel | null;
  onSave: (speaker: string, newName: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(labels[speaker] || "");
  const style = speakerStyle(speaker);

  const confirmedName = labels[speaker];
  const isSelf = (confirmedName || "").trim().toLowerCase() === SELF_NAME.toLowerCase();

  // Proposta só conta se não há confirmação ainda e confidence >= 0.60
  const hasProposal =
    !confirmedName && proposed && proposed.confidence >= MIN_CONFIDENCE;
  const isHighConfidence = hasProposal && proposed.confidence >= HIGH_CONFIDENCE;

  if (editing) {
    return (
      <div className="inline-flex flex-wrap items-center gap-1">
        <input
          type="text"
          autoFocus
          list={PESSOAS_DATALIST_ID}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(speaker, value.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
              setValue(labels[speaker] || "");
            }
          }}
          placeholder={`Speaker ${speaker}`}
          className="w-28 text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--card)] border border-[color:var(--foreground)] outline-none"
          disabled={saving}
        />
        {hasProposal && (
          <button
            type="button"
            onClick={() => {
              onSave(speaker, proposed.nome);
              setEditing(false);
            }}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--foreground)] hover:opacity-80"
            title={`Confirmar sugestão por voz (${Math.round(proposed.confidence * 100)}%)`}
          >
            <Sparkles size={10} />
            {proposed.nome} {Math.round(proposed.confidence * 100)}%
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onSave(speaker, SELF_NAME);
            setEditing(false);
          }}
          disabled={saving}
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80"
          title={`Marcar como ${SELF_NAME} (você)`}
        >
          <UserRound size={10} />
          Sou eu
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(speaker, value.trim());
            setEditing(false);
          }}
          className="text-[color:var(--calm)]"
          disabled={saving}
          aria-label="salvar"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(labels[speaker] || "");
          }}
          className="text-[color:var(--muted)]"
          aria-label="cancelar"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  // Conteúdo do chip
  const display = confirmedName || (hasProposal ? proposed.nome : `Speaker ${speaker}`);

  return (
    <button
      type="button"
      onClick={() => {
        setValue(labels[speaker] || "");
        setEditing(true);
      }}
      className={cn(
        "press-feedback inline-flex items-center gap-1 text-[11px] tracking-wide font-medium px-2 py-0.5 rounded-full",
        isSelf
          ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
          : hasProposal && !isHighConfidence
          ? "bg-[color:var(--card)] border border-dashed border-[color:var(--muted)] text-[color:var(--muted-strong)] italic"
          : `${style.bg} ${style.text}`,
        "hover:ring-1 hover:ring-[color:var(--foreground)]/30",
      )}
      title={
        confirmedName
          ? isSelf
            ? "Você. Clique para alterar."
            : "Clique para renomear (vai reprocessar tarefas)"
          : hasProposal
          ? `Sugestão por voz: ${proposed.nome} (${Math.round(proposed.confidence * 100)}%). Clique pra confirmar ou corrigir.`
          : "Clique para nomear"
      }
    >
      {isSelf && <UserRound size={10} />}
      {hasProposal && !confirmedName && <Sparkles size={9} className="opacity-70" />}
      {display}
      {hasProposal && !confirmedName && !isHighConfidence ? "?" : ""}
      <Pencil size={9} className="opacity-50" />
    </button>
  );
}

function MoveTurnMenu({
  meetingId,
  segmentIndices,
  sourceLetter,
  otherLetters,
  labels,
  onDone,
}: {
  meetingId: string;
  segmentIndices: number[];
  sourceLetter: string;
  otherLetters: string[];
  labels: Record<string, string>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(targetLetter: string | null, name?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment_indices: segmentIndices,
          target_letter: targetLetter || "_new_",
          new_name: name || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setOpen(false);
      setCreating(false);
      setNewName("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="mover este trecho pra outro speaker (a diarização errou)"
        className="opacity-30 hover:opacity-100 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition shrink-0 mt-0.5"
        aria-label="mover este trecho"
      >
        <Scissors size={12} />
      </button>
    );
  }

  return (
    <div className="absolute right-0 top-6 z-10 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-2 w-56 space-y-1">
      <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)] px-1 pb-1">
        mover trecho pra:
      </p>
      {otherLetters.length === 0 && !creating && (
        <p className="text-[11px] text-[color:var(--muted)] px-1 italic">
          nenhum outro speaker — crie um novo
        </p>
      )}
      {otherLetters.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => move(l)}
          disabled={busy}
          className="w-full text-left text-[12px] px-2 py-1 rounded-md hover:bg-[color:var(--accent)] disabled:opacity-50"
        >
          {labels[l] || `Speaker ${l}`}{" "}
          <span className="text-[color:var(--muted)]">({l})</span>
        </button>
      ))}
      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={busy}
          className="w-full text-left text-[12px] px-2 py-1 rounded-md hover:bg-[color:var(--accent)] text-[color:var(--calm)] disabled:opacity-50"
        >
          + novo speaker
        </button>
      ) : (
        <div className="space-y-1 px-1">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") move(null, newName.trim());
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="nome (opcional)"
            className="w-full text-[12px] px-2 py-1 rounded-md bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
            disabled={busy}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => move(null, newName.trim())}
              disabled={busy}
              className="flex-1 text-[11px] px-2 py-1 rounded-md bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
            >
              {busy ? "movendo…" : "criar e mover"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded-md text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              cancelar
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-[10px] text-[color:var(--urgent)] px-1">{error}</p>
      )}
      <div className="border-t border-[color:var(--border)]/50 pt-1 mt-1">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setCreating(false);
            setNewName("");
            setError(null);
          }}
          className="w-full text-[11px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-2 py-0.5"
        >
          fechar
        </button>
      </div>
      <p className="text-[10px] text-[color:var(--muted)] px-1 pt-1">
        movendo {segmentIndices.length}{" "}
        {segmentIndices.length === 1 ? "trecho" : "trechos"} do {sourceLetter}
      </p>
    </div>
  );
}

export function TranscriptionView({
  meetingId,
  segments,
  initialLabels,
  speakerLabelsProposed = {},
  pessoas = [],
  fallbackText,
  sections = [],
}: {
  meetingId: string;
  segments: Segment[] | null | undefined;
  initialLabels: Record<string, string>;
  speakerLabelsProposed?: Record<string, ProposedLabel | null>;
  pessoas?: Array<{ id: string; nome: string }>;
  fallbackText: string | null;
  sections?: { start_seconds: number; title: string }[];
}) {
  const router = useRouter();
  const [labels, setLabels] = useState<Record<string, string>>(initialLabels || {});
  const [isPending, startTransition] = useTransition();
  const [reprocessing, setReprocessing] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const [sectionList, setSectionList] = useState(
    [...sections].sort((a, b) => a.start_seconds - b.start_seconds),
  );
  const [pendingCuts, setPendingCuts] = useState<{ at_seconds: number; label: string }[]>([]);

  async function saveSections(next: { start_seconds: number; title: string }[]) {
    const sorted = [...next].sort((a, b) => a.start_seconds - b.start_seconds);
    setSectionList(sorted);
    try {
      await fetch(`/api/meetings/${meetingId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sorted }),
      });
    } catch {
      // mantém otimista; refresh corrige se falhar
    }
  }

  const handleSave = (speaker: string, newName: string) => {
    const next = { ...labels };
    if (newName) next[speaker] = newName;
    else delete next[speaker];
    setLabels(next);
    setReprocessing(true);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/speakers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labels: next }),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        // Espera ~3s pro reprocess do n8n terminar antes de refresh da página
        setTimeout(() => {
          router.refresh();
          setReprocessing(false);
        }, 3000);
      } catch (e) {
        console.error("falha ao salvar labels", e);
        setReprocessing(false);
      }
    });
  };

  const handleIdentify = () => {
    setIdentifyError(null);
    setIdentifying(true);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/identify`, {
          method: "POST",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.message || body.error || `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setIdentifyError(e instanceof Error ? e.message : String(e));
      } finally {
        setIdentifying(false);
      }
    });
  };

  if (!segments?.length) {
    if (!fallbackText) return null;
    return (
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[color:var(--foreground)]">
        {fallbackText}
      </p>
    );
  }

  const turns = groupTurns(segments);

  // Identificar por voz só faz sentido se há speakers sem label confirmado
  const distinctSpeakers = Array.from(new Set(turns.map((t) => t.speaker)));
  const unconfirmed = distinctSpeakers.filter((s) => !labels[s]);
  const showIdentifyButton = unconfirmed.length > 0;

  // Seção de assunto que NASCE neste turn (primeiro turn no/após a fronteira).
  function sectionStartingAt(turnIndex: number): { start_seconds: number; title: string } | null {
    const t = turns[turnIndex];
    const prevStart = turnIndex > 0 ? turns[turnIndex - 1].start : -1;
    return (
      sectionList.find((s) => s.start_seconds > prevStart && s.start_seconds <= t.start) ?? null
    );
  }

  function addSectionAt(turnStart: number) {
    const title = window.prompt("Título da seção (ex: Financeiro):", "")?.trim();
    if (!title) return;
    const at = Math.round(turnStart);
    const without = sectionList.filter((s) => Math.abs(s.start_seconds - at) > 1);
    saveSections([...without, { start_seconds: at, title }]);
  }

  function toggleCut(turnStart: number) {
    const at = Math.round(turnStart);
    if (at <= 0) return; // não dá pra cortar no começo
    setPendingCuts((prev) => {
      const exists = prev.some((c) => Math.abs(c.at_seconds - at) <= 1);
      if (exists) return prev.filter((c) => Math.abs(c.at_seconds - at) > 1);
      const label = `Parte a partir de ${fmtTime(turnStart)}`;
      return [...prev, { at_seconds: at, label }].sort((a, b) => a.at_seconds - b.at_seconds);
    });
  }

  function isCutHere(turnStart: number): boolean {
    const at = Math.round(turnStart);
    return pendingCuts.some((c) => Math.abs(c.at_seconds - at) <= 1);
  }

  return (
    <div className="space-y-4">
      <datalist id={PESSOAS_DATALIST_ID}>
        {pessoas.map((p) => (
          <option key={p.id} value={p.nome} />
        ))}
      </datalist>

      {showIdentifyButton && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleIdentify}
            disabled={identifying || isPending}
            className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:ring-1 hover:ring-[color:var(--foreground)]/30 disabled:opacity-50"
            title="Compara cada voz com a base de amostras e sugere mapeamento"
          >
            <AudioLines size={13} />
            {identifying ? "identificando…" : "identificar por voz"}
          </button>
          {identifyError && (
            <span className="text-[11px] text-[color:var(--urgent)]">
              {identifyError}
            </span>
          )}
        </div>
      )}

      {reprocessing && (
        <div className="text-[12px] text-[color:var(--muted-strong)] bg-[color:var(--accent)] px-3 py-2 rounded-lg">
          Reprocessando tarefas com os novos nomes…
        </div>
      )}
      {turns.map((t, i) => {
        const sec = sectionStartingAt(i);
        return (
          <div key={i}>
            {sec && (
              <div className="flex items-center gap-2 my-4 first:mt-0">
                <button
                  type="button"
                  onClick={() => {
                    const novo = window.prompt("Renomear seção:", sec.title)?.trim();
                    if (novo === undefined) return;
                    const next = sectionList.map((s) =>
                      s.start_seconds === sec.start_seconds
                        ? { ...s, title: novo || s.title }
                        : s,
                    );
                    saveSections(next);
                  }}
                  className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)] bg-[color:var(--accent)] px-2.5 py-1 rounded-full hover:ring-1 hover:ring-[color:var(--foreground)]/30"
                  title="renomear seção"
                >
                  {sec.title}
                </button>
                <button
                  type="button"
                  title="remover seção"
                  onClick={() =>
                    saveSections(
                      sectionList.filter((s) => s.start_seconds !== sec.start_seconds),
                    )
                  }
                  className="text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
                  aria-label="remover seção"
                >
                  <X size={12} />
                </button>
                <span className="flex-1 h-px bg-[color:var(--border)]" />
              </div>
            )}
            {isCutHere(t.start) && (
              <div className="flex items-center gap-2 my-3">
                <span className="flex-1 h-px bg-[color:var(--urgent)]/60" />
                <span className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--urgent)]">
                  corte — nova reunião
                </span>
                <span className="flex-1 h-px bg-[color:var(--urgent)]/60" />
              </div>
            )}
            <div className="flex gap-3 relative">
              <div className="shrink-0 w-24 sm:w-28 flex flex-col items-start gap-1">
                <SpeakerChip
                  speaker={t.speaker}
                  labels={labels}
                  proposed={speakerLabelsProposed[t.speaker] ?? null}
                  onSave={handleSave}
                  saving={isPending}
                />
                <span className="text-[10px] text-[color:var(--muted)] font-mono">
                  {fmtTime(t.start)}
                </span>
              </div>
              <p className="flex-1 text-[14px] leading-relaxed text-[color:var(--foreground)] pt-0.5">
                {t.text.trim()}
              </p>
              <div className="shrink-0 flex items-start gap-1">
                <div className="relative shrink-0">
                  <MoveTurnMenu
                    meetingId={meetingId}
                    segmentIndices={t.segmentIndices}
                    sourceLetter={t.speaker}
                    otherLetters={distinctSpeakers.filter((s) => s !== t.speaker)}
                    labels={labels}
                    onDone={() => router.refresh()}
                  />
                </div>
                <button
                  type="button"
                  title="marcar nova seção a partir daqui"
                  onClick={() => addSectionAt(t.start)}
                  className="opacity-30 hover:opacity-100 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition shrink-0 mt-0.5"
                  aria-label="nova seção aqui"
                >
                  <BookmarkPlus size={12} />
                </button>
                <button
                  type="button"
                  title={
                    isCutHere(t.start)
                      ? "desfazer corte"
                      : "separar: a partir daqui é outra reunião"
                  }
                  onClick={() => toggleCut(t.start)}
                  className={
                    isCutHere(t.start)
                      ? "text-[color:var(--urgent)] shrink-0 mt-0.5"
                      : "opacity-30 hover:opacity-100 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition shrink-0 mt-0.5"
                  }
                  aria-label="separar a partir daqui"
                >
                  <Split size={12} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <CutBar
        meetingId={meetingId}
        cuts={pendingCuts}
        onClear={() => setPendingCuts([])}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Mic, Video, Smartphone, ChevronRight, Search, X } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import { meetingSubject } from "@/lib/meeting-label";
import { DeleteMeetingButton } from "@/components/delete-meeting-button";

export type MeetingItem = {
  id: string;
  source: string;
  meeting_type: string | null;
  recorded_at: string | null;
  created_at: string;
  status: string;
  summary: string | null;
  duration_seconds: number | null;
  needs_segmentation: boolean;
  n_tarefas: number;
  n_minhas: number;
};

function MeetingIcon({ type, source }: { type: string | null; source: string | null }) {
  if (type === "online")
    return <Video size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  if (type === "presencial")
    return <Mic size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  if (source === "iphone")
    return <Smartphone size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  return <Mic size={16} strokeWidth={1.75} className="text-[color:var(--muted)]" />;
}

const STATUS: Record<string, { cls: string; label: string }> = {
  received: { cls: "bg-[color:var(--accent)] text-[color:var(--muted-strong)]", label: "recebida" },
  transcribing: { cls: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]", label: "transcrevendo" },
  analyzing: { cls: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]", label: "analisando" },
  done: { cls: "bg-[color:var(--calm-bg)] text-[color:var(--calm)]", label: "pronta" },
  error: { cls: "bg-[color:var(--urgent-bg)] text-[color:var(--urgent)]", label: "erro" },
};

function StatusPill({ status }: { status: string }) {
  // "pronta" é o estado de quase tudo — repetir em cada linha só faz ruído.
  if (status === "done") return null;
  const s = STATUS[status] ?? STATUS.received;
  return (
    <span
      className={`shrink-0 text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function MeetingsList({
  meetings,
  total = 0,
  limite = 0,
}: {
  meetings: MeetingItem[];
  /** Quantas existem no banco — a lista é um recorte das mais recentes. */
  total?: number;
  limite?: number;
}) {
  const [q, setQ] = useState("");

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return meetings;
    const termos = s.split(/\s+/);
    return meetings.filter((m) => {
      const hay = `${m.summary ?? ""} ${m.recorded_at ? fmtDate(m.recorded_at) : ""}`.toLowerCase();
      return termos.every((t) => hay.includes(t));
    });
  }, [meetings, q]);

  return (
    <div className="space-y-3">
      {/* Sem busca, achar uma reunião entre dezenas com nome parecido era rolar
          a lista inteira no olho. */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[color:var(--border)]">
        <Search size={14} className="text-[color:var(--muted)] shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por assunto, pessoa ou data…"
          className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Limpar busca"
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {q ? (
        <p className="text-[12px] text-[color:var(--muted)]">
          {lista.length === 0
            ? "Nenhuma reunião com esse texto."
            : `${lista.length} de ${meetings.length} reuniões carregadas`}
        </p>
      ) : total > limite && limite > 0 ? (
        <p className="text-[12px] text-[color:var(--muted)]">
          Mostrando as {limite} mais recentes — você tem {total} gravadas ao todo.
        </p>
      ) : null}

      <div className="space-y-2.5">
        {lista.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <div className="press-feedback group relative flex-1 min-w-0 paper-card rounded-2xl border border-[color:var(--border)] hover:border-[color:var(--muted)] p-4 sm:p-5">
              {/* Link cobrindo o cartão: deixa o aviso de segmentação ser um
                  link próprio dentro dele (link dentro de link é inválido). */}
              <Link
                href={`/reunioes/${m.id}`}
                aria-label={meetingSubject(m.summary) || "Abrir reunião"}
                className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-[color:var(--foreground)]"
              />
              <div className="relative flex items-start gap-3 pointer-events-none">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-[color:var(--accent)] flex items-center justify-center">
                  <MeetingIcon type={m.meeting_type} source={m.source} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    {/* Assunto primeiro: o resumo cru começa igual em toda
                        reunião e a lista virava um bloco de nomes iguais. */}
                    <p className="flex-1 text-[15px] leading-snug font-medium text-[color:var(--foreground)] line-clamp-2">
                      {meetingSubject(m.summary) || "Reunião sem resumo"}
                    </p>
                    <StatusPill status={m.status} />
                  </div>
                  {m.summary && (
                    <p className="mt-1 text-[12px] leading-snug text-[color:var(--muted)] line-clamp-1">
                      {m.summary}
                    </p>
                  )}
                  <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px] text-[color:var(--muted)]">
                    {m.recorded_at && <span>{fmtDate(m.recorded_at)}</span>}
                    {m.duration_seconds && m.duration_seconds > 0 ? (
                      <span>· {Math.max(1, Math.round(m.duration_seconds / 60))} min</span>
                    ) : null}
                    {m.n_tarefas > 0 && (
                      <span className="text-[color:var(--muted-strong)]">
                        ·{" "}
                        <span className="font-medium text-[color:var(--foreground)]">
                          {m.n_tarefas}
                        </span>{" "}
                        {m.n_tarefas === 1 ? "ação" : "ações"}
                        {m.n_minhas > 0 && (
                          <span className="text-[color:var(--muted)]">
                            {" "}
                            (
                            <span className="text-[color:var(--foreground)] font-medium">
                              {m.n_minhas}
                            </span>{" "}
                            minhas)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {/* Dentro do cartão: solto embaixo, o aviso ficava entre dois
                      cartões e não dava pra saber de qual reunião era. */}
                  {m.needs_segmentation && (
                    <Link
                      href={`/reunioes/${m.id}/segmentar`}
                      className="pointer-events-auto relative mt-2 inline-flex items-center gap-1.5 text-[11px] text-[color:var(--warm)] bg-[color:var(--warm-bg)] px-2.5 py-1 rounded-full w-fit hover:opacity-80 transition"
                    >
                      ⚠️ áudio longo · revisar segmentação
                    </Link>
                  )}
                </div>

                <div className="shrink-0 self-center text-[color:var(--muted)] group-hover:text-[color:var(--foreground)] transition">
                  <ChevronRight size={18} strokeWidth={1.75} />
                </div>
              </div>
            </div>
            <DeleteMeetingButton
              meetingId={m.id}
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl border border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--urgent)] hover:border-[color:var(--urgent)]/40 transition disabled:opacity-50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

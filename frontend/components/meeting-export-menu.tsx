"use client";

import { useState } from "react";
import { Download, Copy, Check, Printer, FileText, Captions, FileCode } from "lucide-react";
import { toPlainText, type Segment } from "@/lib/transcript-format";
import { summaryToPlainText } from "@/lib/summary-format";

const ITEM =
  "flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]";
const GROUP =
  "text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)] px-2 pb-1 pt-1.5";

export function MeetingExportMenu({
  meetingId,
  segments,
  labels,
  sections = [],
  summaryMd = null,
  label = "baixar / exportar",
}: {
  meetingId: string;
  segments: Segment[];
  labels: Record<string, string>;
  sections?: { start_seconds: number; title: string }[];
  summaryMd?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"resumo" | "transcricao" | null>(null);

  const base = `/api/meetings/${meetingId}/export`;
  const temTranscricao = segments.length > 0;

  async function copy(what: "resumo" | "transcricao") {
    const text =
      what === "resumo" ? summaryToPlainText(summaryMd || "") : toPlainText(segments, labels);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // clipboard indisponível — ignora
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
        title="Baixar o resumo ou a transcrição"
      >
        <Download size={13} /> {label}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-1.5 w-64 max-h-[70vh] overflow-y-auto space-y-0.5">
          {summaryMd && (
            <>
              <p className={GROUP}>resumo</p>
              <a href={`${base}?content=resumo&format=txt`} className={ITEM}>
                <FileText size={13} /> Texto (.txt)
              </a>
              <a href={`${base}?content=resumo&format=md`} className={ITEM}>
                <FileCode size={13} /> Markdown (.md)
              </a>
              <button type="button" onClick={() => copy("resumo")} className={`w-full ${ITEM}`}>
                {copied === "resumo" ? (
                  <Check size={13} className="text-[color:var(--calm)]" />
                ) : (
                  <Copy size={13} />
                )}
                {copied === "resumo" ? "Copiado!" : "Copiar resumo"}
              </button>
            </>
          )}

          {temTranscricao && (
            <>
              {summaryMd && <div className="border-t border-[color:var(--border)]/50 mt-1" />}
              <p className={GROUP}>transcrição</p>
              <a href={`${base}?format=txt`} className={ITEM}>
                <FileText size={13} /> Texto (.txt)
              </a>
              <a href={`${base}?format=md`} className={ITEM}>
                <FileCode size={13} /> Markdown (.md)
              </a>
              <a href={`${base}?format=srt`} className={ITEM}>
                <Captions size={13} /> Legenda (.srt)
              </a>
              <a href={`${base}?format=vtt`} className={ITEM}>
                <Captions size={13} /> Legenda (.vtt)
              </a>
              <button
                type="button"
                onClick={() => copy("transcricao")}
                className={`w-full ${ITEM}`}
              >
                {copied === "transcricao" ? (
                  <Check size={13} className="text-[color:var(--calm)]" />
                ) : (
                  <Copy size={13} />
                )}
                {copied === "transcricao" ? "Copiado!" : "Copiar tudo"}
              </button>
            </>
          )}

          {summaryMd && temTranscricao && (
            <>
              <div className="border-t border-[color:var(--border)]/50 mt-1" />
              <p className={GROUP}>resumo + transcrição</p>
              <a href={`${base}?content=completo&format=txt`} className={ITEM}>
                <FileText size={13} /> Texto (.txt)
              </a>
              <a href={`${base}?content=completo&format=md`} className={ITEM}>
                <FileCode size={13} /> Markdown (.md)
              </a>
            </>
          )}

          <div className="border-t border-[color:var(--border)]/50 mt-1 pt-1">
            <a
              href={`/reunioes/${meetingId}/imprimir`}
              target="_blank"
              rel="noopener noreferrer"
              className={ITEM}
            >
              <Printer size={13} /> Imprimir / PDF
            </a>
          </div>

          {temTranscricao && sections.length > 0 && (
            <div className="border-t border-[color:var(--border)]/50 mt-1 pt-1">
              <p className={GROUP}>baixar seção da transcrição</p>
              {sections.map((s, i) => (
                <a
                  key={i}
                  href={`${base}?format=txt&scope=section&section=${i}`}
                  className="block text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)] truncate"
                  title={s.title}
                >
                  {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

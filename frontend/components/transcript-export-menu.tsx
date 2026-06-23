"use client";

import { useState } from "react";
import { Download, Copy, Check, Printer, FileText, Captions, FileCode } from "lucide-react";
import { toPlainText, type Segment } from "@/lib/transcript-format";

export function TranscriptExportMenu({
  meetingId,
  segments,
  labels,
  sections = [],
}: {
  meetingId: string;
  segments: Segment[];
  labels: Record<string, string>;
  sections?: { start_seconds: number; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const base = `/api/meetings/${meetingId}/export`;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(toPlainText(segments, labels));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
        title="Baixar a transcrição"
      >
        <Download size={13} /> baixar / exportar
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-1.5 w-56 space-y-0.5">
          <a
            href={`${base}?format=txt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <FileText size={13} /> Texto (.txt)
          </a>
          <a
            href={`${base}?format=md`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <FileCode size={13} /> Markdown (.md)
          </a>
          <a
            href={`${base}?format=srt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Captions size={13} /> Legenda (.srt)
          </a>
          <a
            href={`${base}?format=vtt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Captions size={13} /> Legenda (.vtt)
          </a>
          <button
            type="button"
            onClick={copyAll}
            className="w-full flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            {copied ? <Check size={13} className="text-[color:var(--calm)]" /> : <Copy size={13} />}
            {copied ? "Copiado!" : "Copiar tudo"}
          </button>
          <a
            href={`/reunioes/${meetingId}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Printer size={13} /> Imprimir / PDF
          </a>

          {sections.length > 0 && (
            <div className="border-t border-[color:var(--border)]/50 mt-1 pt-1">
              <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)] px-2 pb-1">
                baixar seção
              </p>
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

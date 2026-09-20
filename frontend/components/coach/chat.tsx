"use client";

import { useEffect, useRef, useState } from "react";
import type { CoachMessage } from "@/lib/coach/types";
import { ArrowUp, MessageCircle } from "lucide-react";
import { Markdown } from "@/lib/md";
import { dateLabel, EvidenceList, fieldClass, primaryClass, type CoachMutation } from "./shared";

const suggestions = ["O que mais merece minha atenção agora?", "Quero me preparar para uma conversa difícil.", "Onde estou assumindo mais do que deveria?"];

export function ChatView({ messages, busy, enabled, available, draft, onDraft, mutate }: { messages: CoachMessage[]; busy: boolean; enabled: boolean; available: boolean; draft: string; onDraft: (value: string) => void; mutate: CoachMutation }) {
  const [pending, setPending] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const previousCount = useRef(messages.length);
  useEffect(() => { if (messages.length > previousCount.current) end.current?.scrollIntoView({ block: "nearest" }); previousCount.current = messages.length; }, [messages.length]);
  const canSend = enabled && available && !busy;
  return (
    <div className="space-y-5">
      <header><h2 className="font-display text-2xl">Pense em voz alta</h2><p className="mt-2 text-sm leading-relaxed text-muted-strong">Traga uma decisão, um conflito ou algo que não está claro. O coach usa o contexto disponível e registra esta conversa.</p></header>
      {messages.length >= 100 && <p className="text-xs leading-relaxed text-muted-strong">Exibindo as 100 mensagens mais recentes. O coach também pode recuperar conversas anteriores por relevância.</p>}
      <div className="max-h-[65vh] min-h-44 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card px-4 sm:px-5" aria-label="Histórico da conversa">
        {messages.length === 0 && !pending ? <div className="py-8"><MessageCircle size={23} className="mb-3 text-[var(--calm)]" aria-hidden="true" /><p className="font-display text-xl">Qual situação você quer entender melhor?</p><p className="mt-2 text-sm text-muted-strong">Você não precisa organizar tudo antes de começar.</p><div className="mt-5 flex flex-col items-start gap-1">{suggestions.map((text) => <button type="button" key={text} className="min-h-11 text-left text-xs text-[var(--calm)] underline underline-offset-4 disabled:opacity-50" disabled={!canSend} onClick={() => { onDraft(text); input.current?.focus(); }}>{text}</button>)}</div></div> : <div className="divide-y divide-border">{messages.map((message) => <article key={message.id} className="py-5"><div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-strong"><span className={`font-semibold ${message.role === "assistant" ? "text-[var(--calm)]" : ""}`}>{message.role === "user" ? "Você" : "Coach"}</span><span>{dateLabel(message.created_at, { year: undefined })}</span></div><div className="break-words text-sm"><Markdown text={message.content} /></div><EvidenceList evidence={message.evidence} /></article>)}</div>}
        {pending && <div className="border-t border-border py-5"><p className="mb-2 text-[11px] font-semibold text-muted-strong">Você · enviando</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{pending}</p><p className="mt-4 text-xs text-[var(--calm)]" role="status">O coach está consultando seu contexto…</p></div>}
        <div ref={end} />
      </div>
      <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); const message = draft.trim(); if (!canSend || !message) return; setPending(message); const ok = await mutate({ action: "chat", message }); setPending(""); if (ok) onDraft(""); }}>
        <label htmlFor="coach-message" className="sr-only">Mensagem para o coach</label><textarea ref={input} id="coach-message" className={`${fieldClass} min-h-28 resize-y`} value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={6000} placeholder={enabled ? "O que está passando pela sua cabeça?" : "Ative o coach para começar a conversar."} disabled={!canSend} />
        <div className="flex items-center justify-between gap-3"><p className="max-w-xs text-[11px] leading-relaxed text-muted-strong">As interpretações podem falhar. Acrescente contexto ou corrija o que não fizer sentido.</p><button type="submit" className={`${primaryClass} shrink-0`} disabled={!canSend || !draft.trim()}><ArrowUp size={16} aria-hidden="true" /> Enviar</button></div>
      </form>
    </div>
  );
}

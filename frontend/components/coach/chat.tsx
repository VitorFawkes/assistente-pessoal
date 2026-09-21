"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CoachMessage } from "@/lib/coach/types";
import { splitChatPresentation } from "@/lib/coach/chat-presentation";
import { ArrowUp } from "lucide-react";
import { Markdown } from "@/lib/md";
import { buttonClass, dateLabel, EvidenceList, fieldClass, primaryClass, type CoachMutation } from "./shared";

const suggestions = [
  { label: "Estou com muita coisa", prompt: "Estou com muita coisa na cabeça. Me ajude a encontrar o problema mais importante e escolher o que pode esperar. Considere o que você sabe sobre mim e pergunte o que estiver faltando." },
  { label: "Preciso decidir", prompt: "Preciso tomar uma decisão. Me ajude a enxergar o que importa, questione meus motivos quando fizer sentido e me guie para um próximo passo. A situação é: " },
  { label: "Como foi meu dia?", prompt: "Olhando as reuniões e os registros de hoje, onde avancei no que importa e onde posso ter me dispersado? Seja franco, diferencie o que você observou do que está supondo e me pergunte sobre o que não conseguiu ver." },
];

function Message({ message }: { message: CoachMessage }) {
  const content = message.role === "assistant" ? splitChatPresentation(message.content) : { answer: message.content, reading: "", scope: "" };
  return (
    <article className="py-5">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-strong"><span className={`font-semibold ${message.role === "assistant" ? "text-[var(--calm)]" : ""}`}>{message.role === "user" ? "Você" : "Coach"}</span><span>{dateLabel(message.created_at, { year: undefined })}</span></div>
      <div className="break-words text-sm"><Markdown text={content.answer} /></div>
      {(content.reading || content.scope) && <details className="mt-4 border-t border-border pt-2">
        <summary className="min-h-9 cursor-pointer rounded py-2 text-xs font-medium text-muted-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--calm)]">{content.reading ? "Entenda esta leitura" : "Contexto desta resposta"}</summary>
        <div className="space-y-3 break-words pb-1 pt-2 text-sm">{content.reading && <Markdown text={content.reading} />}{content.scope && <div className="text-xs leading-relaxed text-muted-strong"><Markdown text={content.scope} /></div>}</div>
      </details>}
      <EvidenceList evidence={message.evidence} />
    </article>
  );
}

export function ChatView({ messages, busy, replyPending, enabled, available, draft, onDraft, mutate }: { messages: CoachMessage[]; busy: boolean; replyPending: boolean; enabled: boolean; available: boolean; draft: string; onDraft: (value: string) => void; mutate: CoachMutation }) {
  const [pending, setPending] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const revealReply = useRef(false);
  useLayoutEffect(() => {
    if (followLatest.current && history.current) {
      history.current.scrollTop = history.current.scrollHeight;
      if (!pending && !replyPending && revealReply.current) history.current.scrollIntoView({ block: "nearest" });
    }
    if (!pending && !replyPending) { followLatest.current = false; revealReply.current = false; }
  }, [messages.length, pending, replyPending]);
  const canSend = enabled && available && !busy;
  return (
    <div className="space-y-5">
      {messages.length === 0 && <header><h2 className="font-display text-xl sm:text-2xl">Vamos olhar para o que está acontecendo?</h2><p className="mt-2 text-sm leading-relaxed text-muted-strong">Conte uma decisão, como foi seu dia ou o que está te sobrecarregando.</p></header>}
      <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const message = draft.trim(); if (!canSend || !message) return; followLatest.current = true; setPending(message); const ok = await mutate({ action: "chat", message }); revealReply.current = ok; setPending(""); if (ok) onDraft(""); }}>
        <div className="flex flex-wrap gap-2" aria-label="Sugestões para começar a conversar">{suggestions.map(({ label, prompt }) => <button type="button" key={label} className={`${buttonClass} !min-h-10 !px-3 !text-xs`} disabled={!canSend || draft.length + prompt.length + 2 > 6000} onClick={() => { onDraft(draft.trim() ? `${draft.trimEnd()}\n\n${prompt}` : prompt); input.current?.focus(); }}>{label}</button>)}</div>
        <label htmlFor="coach-message" className="sr-only">Mensagem para o coach</label><textarea ref={input} id="coach-message" className={`${fieldClass} min-h-28 resize-y`} value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={6000} placeholder={enabled ? "O que está passando pela sua cabeça?" : "Ative o coach para começar a conversar."} disabled={!canSend} />
        <div className="flex items-center justify-between gap-3"><p className="max-w-xs text-[11px] leading-relaxed text-muted-strong">Você pode discordar, acrescentar contexto e corrigir a leitura do coach.</p><button type="submit" className={`${primaryClass} shrink-0`} disabled={!canSend || !draft.trim()}><ArrowUp size={16} aria-hidden="true" /> Enviar</button></div>
      </form>
      {messages.length >= 100 && <p className="text-xs leading-relaxed text-muted-strong">Exibindo as 100 mensagens mais recentes. O coach também pode recuperar conversas anteriores por relevância.</p>}
      {(messages.length > 0 || pending) && <div ref={history} role="region" tabIndex={0} onScroll={() => { const element = history.current; if (element && element.scrollHeight - element.scrollTop - element.clientHeight > 48) followLatest.current = false; }} className="max-h-[55vh] min-h-44 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--calm)] sm:px-5" aria-label="Histórico da conversa">
        <div className="divide-y divide-border">{messages.map((message) => <Message key={message.id} message={message} />)}</div>
        {pending && <div className="border-t border-border py-5"><p className="mb-2 text-[11px] font-semibold text-muted-strong">Você · enviando</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{pending}</p><p className="mt-4 text-xs text-[var(--calm)]" role="status">O coach está consultando seu contexto…</p></div>}
      </div>}
    </div>
  );
}

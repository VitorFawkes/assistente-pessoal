"use client";

import { useState } from "react";
import type { CoachMemory } from "@/lib/coach/types";
import { Check, Pencil, Plus, X } from "lucide-react";
import { buttonClass, dateLabel, EvidenceList, fieldClass, primaryClass, type CoachMutation } from "./shared";

const kinds: Record<CoachMemory["kind"], string> = { goal: "Objetivo", context: "Contexto", pattern: "Padrão em observação", experiment: "Experimento" };
const statuses: Record<CoachMemory["status"], string> = { hypothesis: "Hipótese", confirmed: "Confirmada por você", rejected: "Descartada" };

function MemoryItem({ memory, busy, mutate }: { memory: CoachMemory; busy: boolean; mutate: CoachMutation }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [status, setStatus] = useState(memory.status);
  const updateStatus = (next: CoachMemory["status"]) => mutate({ action: "correct_memory", id: memory.id, content: memory.content, status: next }, next === "rejected" ? "Interpretação descartada." : "Memória confirmada por você.");
  return (
    <article className="border-b border-border py-5 first:pt-0 last:border-b-0">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{kinds[memory.kind]}</span><span className={`rounded-full px-2 py-1 ${memory.status === "confirmed" ? "bg-[var(--calm-bg)] text-[var(--calm)]" : "bg-accent text-muted-strong"}`}>{statuses[memory.status]}</span></div>
      {memory.stale && <p className="mb-3 rounded-lg bg-accent px-3 py-2 text-xs leading-relaxed text-muted-strong">A reunião de origem foi alterada ou removida. Esta memória está desatualizada e não sustenta novas interpretações. Revise o contexto e a evidência.</p>}
      {editing ? (
        <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); if (await mutate({ action: "correct_memory", id: memory.id, content: content.trim(), status }, "Correção salva. As próximas conversas usarão esta versão.")) setEditing(false); }}>
          <label className="block text-xs font-medium">Corrigir memória<textarea className={`${fieldClass} mt-1.5 min-h-28 resize-y`} value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} required disabled={busy} autoFocus /></label>
          <label className="block text-xs font-medium">Como considerar esta informação<select className={`${fieldClass} mt-1.5`} value={status} onChange={(event) => setStatus(event.target.value as CoachMemory["status"])} disabled={busy}><option value="hypothesis">Hipótese a investigar</option><option value="confirmed">Confirmada por mim</option><option value="rejected">Descartada</option></select></label>
          <div className="flex flex-wrap gap-2"><button type="submit" className={primaryClass} disabled={busy || !content.trim()}>Salvar correção</button><button type="button" className={buttonClass} onClick={() => setEditing(false)} disabled={busy}>Cancelar</button></div>
        </form>
      ) : (
        <><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{memory.content}</p><div className="mt-3 flex flex-wrap gap-1.5">
          <button className={buttonClass} type="button" disabled={busy} onClick={() => { setContent(memory.content); setStatus(memory.status); setEditing(true); }}><Pencil size={13} aria-hidden="true" /> Corrigir</button>
          {memory.status !== "confirmed" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void updateStatus("confirmed")}><Check size={14} aria-hidden="true" /> Confirmar</button>}
          {memory.status !== "rejected" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void updateStatus("rejected")}><X size={14} aria-hidden="true" /> Descartar</button>}
        </div></>
      )}
      <EvidenceList evidence={memory.evidence} />
      {memory.history.length > 0 && <details className="mt-3 text-xs text-muted-strong"><summary className="cursor-pointer py-2">Ver versões anteriores ({memory.history.length})</summary><ol className="mt-2 space-y-3 border-l border-border pl-3">{memory.history.map((version, index) => <li key={`${version.at}-${index}`}><p className="mb-1">{dateLabel(version.at)} · {statuses[version.status as CoachMemory["status"]] || version.status}</p><p className="whitespace-pre-wrap leading-relaxed">{version.content}</p></li>)}</ol></details>}
      <p className="mt-3 text-[11px] text-muted-strong">Atualizada em {dateLabel(memory.updated_at)}</p>
    </article>
  );
}

export function MemoryView({ memories, busy, mutate }: { memories: CoachMemory[]; busy: boolean; mutate: CoachMutation }) {
  const [adding, setAdding] = useState(false);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<CoachMemory["kind"]>("context");
  const [showRejected, setShowRejected] = useState(false);
  const active = memories.filter((item) => item.status !== "rejected");
  const rejected = memories.filter((item) => item.status === "rejected");
  return (
    <div className="space-y-6">
      <header><h2 className="font-display text-2xl">O que o coach está aprendendo</h2><p className="mt-2 text-sm leading-relaxed text-muted-strong">Você pode corrigir qualquer leitura. Hipóteses continuam sendo hipóteses até você revisá-las; confirmar registra sua perspectiva.</p></header>
      {!adding ? <button className={buttonClass} type="button" onClick={() => setAdding(true)} disabled={busy}><Plus size={16} aria-hidden="true" /> Acrescentar uma memória</button> : <form className="space-y-3 rounded-xl border border-border bg-accent/40 p-4" onSubmit={async (event) => { event.preventDefault(); if (await mutate({ action: "memory", content: content.trim(), kind }, "Memória adicionada.")) { setContent(""); setAdding(false); } }}>
        <label className="block text-xs font-medium">Tipo<select className={`${fieldClass} mt-1.5`} value={kind} onChange={(event) => setKind(event.target.value as CoachMemory["kind"])} disabled={busy}>{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="block text-xs font-medium">O que você quer que o coach considere<textarea className={`${fieldClass} mt-1.5 min-h-28 resize-y`} placeholder="Uma meta, dificuldade, contexto ou experimento que quero acompanhar…" value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} required disabled={busy} autoFocus /></label>
        <div className="flex flex-wrap gap-2"><button className={primaryClass} type="submit" disabled={busy || !content.trim()}>Salvar memória</button><button className={buttonClass} type="button" onClick={() => setAdding(false)} disabled={busy}>Cancelar</button></div>
      </form>}
      {active.length > 0 ? <div>{active.map((memory) => <MemoryItem key={memory.id} memory={memory} busy={busy} mutate={mutate} />)}</div> : <div className="rounded-xl border border-dashed border-border px-5 py-7"><p className="text-sm">Ainda não há memórias ativas.</p><p className="mt-1 text-sm text-muted-strong">Registre o que importa para seu desenvolvimento. As análises também podem propor padrões para sua revisão.</p></div>}
      {rejected.length > 0 && <div className="border-t border-border pt-4"><button type="button" className="min-h-10 text-sm text-muted-strong underline underline-offset-4" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>{showRejected ? "Ocultar" : "Ver"} {rejected.length} {rejected.length === 1 ? "memória descartada" : "memórias descartadas"}</button>{showRejected && <div className="mt-4">{rejected.map((memory) => <MemoryItem key={memory.id} memory={memory} busy={busy} mutate={mutate} />)}</div>}</div>}
    </div>
  );
}

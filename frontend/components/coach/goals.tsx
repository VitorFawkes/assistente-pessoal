"use client";

import { useState } from "react";
import type { CoachGoal } from "@/lib/coach/store";
import { buttonClass, fieldClass, primaryClass, type CoachMutation } from "./shared";

const AREAS = [
  { key: "work", label: "Trabalho", hint: "Aparecem no foco do dia, no fechamento e nas conversas." },
  { key: "life", label: "Vida", hint: "Só aparecem na revisão de sexta e quando você puxa o assunto." },
] as const;
const LIMIT = 3;
const brDate = (iso: string) => iso.split("-").reverse().join("/");

/** Up to 3 active goals per area, each with what it is, until when and how to know it was reached. */
export function GoalsEditor({ goals, busy, mutate }: { goals: CoachGoal[]; busy: boolean; mutate: CoachMutation }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ content: "", due: "", measure: "" });
  const open = (key: string, goal?: CoachGoal) => { setEditing(key); setDraft({ content: goal?.content ?? "", due: goal?.due ?? "", measure: goal?.measure ?? "" }); };
  const save = async (area: "work" | "life", id?: string) => {
    if (await mutate({ action: "goal_save", id, area, content: draft.content, due: draft.due || null, measure: draft.measure || null }, "Objetivo salvo.")) setEditing(null);
  };
  const status = (id: string, lifecycle: "active" | "paused" | "completed", message: string) => void mutate({ action: "goal_status", id, lifecycle }, message);
  const form = (area: "work" | "life", id?: string) => (
    <form className="space-y-2 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); void save(area, id); }}>
      <label className="block text-xs font-medium">O que é<input className={`${fieldClass} mt-1`} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} maxLength={500} required disabled={busy} placeholder={area === "life" ? "Ex.: voltar a correr três vezes por semana" : "Ex.: ter a produção de casamentos rodando no TARS"} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-medium">Até quando (opcional)<input type="date" className={`${fieldClass} mt-1`} value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} disabled={busy} /></label>
        <label className="block text-xs font-medium">Como vou saber que cheguei (opcional)<input className={`${fieldClass} mt-1`} value={draft.measure} onChange={event => setDraft({ ...draft, measure: event.target.value })} maxLength={500} disabled={busy} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><button type="submit" className={`${primaryClass} !text-xs`} disabled={busy || !draft.content.trim()}>Salvar</button><button type="button" className={`${buttonClass} !text-xs`} disabled={busy} onClick={() => setEditing(null)}>Cancelar</button></div>
    </form>
  );
  return (
    <div className="space-y-5">
      {AREAS.map(area => {
        const list = goals.filter(goal => goal.area === area.key);
        const active = list.filter(goal => goal.lifecycle === "active");
        const rest = list.filter(goal => goal.lifecycle !== "active");
        return (
          <div key={area.key} className="space-y-2">
            <h3 className="text-sm font-semibold">{area.label} <span className="font-normal text-muted-strong">({active.length} de {LIMIT})</span></h3>
            <p className="text-xs leading-relaxed text-muted-strong">{area.hint}</p>
            {active.map(goal => editing === goal.id ? <div key={goal.id}>{form(area.key, goal.id)}</div> : (
              <div key={goal.id} className="rounded-xl border border-border p-3">
                <p className="text-sm">{goal.content}</p>
                {(goal.due || goal.measure) && <p className="mt-1 text-xs text-muted-strong">{[goal.due ? `Até ${brDate(goal.due)}` : "", goal.measure ? `Como saber: ${goal.measure}` : ""].filter(Boolean).join(". ")}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={`${buttonClass} !min-h-8 !px-2.5 !text-xs`} disabled={busy} onClick={() => open(goal.id, goal)}>Editar</button>
                  <button type="button" className={`${buttonClass} !min-h-8 !px-2.5 !text-xs`} disabled={busy} onClick={() => status(goal.id, "paused", "Objetivo pausado.")}>Pausar</button>
                  <button type="button" className={`${buttonClass} !min-h-8 !px-2.5 !text-xs`} disabled={busy} onClick={() => status(goal.id, "completed", "Objetivo concluído.")}>Concluir</button>
                </div>
              </div>
            ))}
            {editing === `new:${area.key}` ? form(area.key) : active.length < LIMIT && <button type="button" className={`${buttonClass} !text-xs`} disabled={busy} onClick={() => open(`new:${area.key}`)}>Adicionar objetivo de {area.label.toLowerCase()}</button>}
            {rest.length > 0 && (
              <details className="text-xs text-muted-strong">
                <summary className="cursor-pointer">Pausados e concluídos ({rest.length})</summary>
                <ul className="mt-2 space-y-1.5">{rest.map(goal => (
                  <li key={goal.id} className="flex flex-wrap items-center gap-2"><span>{goal.lifecycle === "paused" ? "Pausado" : "Concluído"}: {goal.content}</span>
                    {goal.lifecycle === "paused" && active.length < LIMIT && <button type="button" className={`${buttonClass} !min-h-7 !px-2 !text-xs`} disabled={busy} onClick={() => status(goal.id, "active", "Objetivo reativado.")}>Reativar</button>}</li>
                ))}</ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

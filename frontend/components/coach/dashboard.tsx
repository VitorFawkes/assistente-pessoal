"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CoachProfile, CoachState } from "@/lib/coach/types";
import { ArrowRight, BookOpen, Check, CircleAlert, LoaderCircle, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { ChatView } from "./chat";
import { MemoryView } from "./memory";
import { ReferencesView } from "./references";
import { ReviewView } from "./review";
import { days, SettingsView } from "./settings";
import { buttonClass, dateLabel, primaryClass } from "./shared";

const tabs = [
  { id: "chat", label: "Conversa" },
  { id: "week", label: "Sua semana" },
  { id: "memory", label: "Memória" },
  { id: "references", label: "Referenciais" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function profilePayload(profile: CoachProfile) {
  return { enabled: profile.enabled, weekly_enabled: profile.weekly_enabled, goals: profile.goals, context: profile.context, timezone: profile.timezone, review_day: profile.review_day, review_hour: profile.review_hour };
}

async function readResponse(response: Response): Promise<CoachState> {
  if (response.redirected || response.status === 401 || response.status === 403) throw new Error("Sua sessão expirou. Entre novamente no Ações e recarregue esta página.");
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Não foi possível concluir a solicitação. Recarregue o coach e tente novamente.");
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "O coach não conseguiu concluir esta etapa. Tente novamente.");
  if (!data.profile || !data.coverage || !Array.isArray(data.messages)) throw new Error("O coach recebeu uma resposta incompleta. Recarregue a página.");
  return data as CoachState;
}

export function CoachDashboard() {
  const [state, setState] = useState<CoachState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState("");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const running = useRef(false);

  const load = useCallback((signal?: AbortSignal) => fetch("/api/coach", { cache: "no-store", signal })
    .then(readResponse)
    .then((next) => { if (!signal?.aborted) setState(next); })
    .catch((err: unknown) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Não foi possível carregar o coach."); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), []);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const mutate = useCallback(async (payload: Record<string, unknown>, successMessage?: string): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(String(payload.action));
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setState(await readResponse(response));
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente."); return false; }
    finally { running.current = false; setBusy(null); }
  }, []);

  const discuss = (text: string) => {
    setDraft((previous) => previous.trim() ? `${previous.trimEnd()}\n\n${text}` : text);
    setTab("chat");
    requestAnimationFrame(() => document.getElementById("coach-message")?.focus());
  };

  if (!state) return (
    <div className="space-y-6"><header><h1 className="font-display text-4xl">Seu coach de liderança</h1><p className="mt-3 text-sm text-muted-strong">Perspectiva sobre sua atuação. Um próximo passo de cada vez.</p></header>{loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-strong" role="status"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Carregando seu contexto…</div> : <div className="rounded-xl border border-border bg-card p-5"><p role="alert" className="text-sm text-[var(--urgent)]">{error}</p><button type="button" className={`${buttonClass} mt-4`} onClick={() => { setLoading(true); setError(null); void load(); }}><RefreshCw size={15} aria-hidden="true" /> Tentar novamente</button></div>}</div>
  );

  const { profile, coverage } = state;
  const reviews = [...state.reviews].sort((a, b) => b.week_start.localeCompare(a.week_start));
  const current = reviews[0];
  const operational = profile.enabled && state.model_available;
  const pendingMemories = state.memories.filter((item) => item.status === "hypothesis").length;
  return (
    <div className="min-w-0 space-y-6 sm:space-y-8">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-xs text-muted-strong"><ShieldCheck size={14} aria-hidden="true" /> Seu espaço privado</span><button type="button" className={`${buttonClass} !min-h-9 !px-2.5 !py-1.5 !text-xs`} aria-expanded={settings} aria-controls="coach-settings" onClick={() => setSettings(!settings)} disabled={!!busy}><Settings2 size={14} aria-hidden="true" /> Ajustes</button></div>
        <h1 className="font-display text-[2.25rem] sm:text-[2.75rem] leading-[1.1] tracking-tight">Seu coach de liderança</h1>
        <p className="max-w-lg text-sm leading-relaxed text-muted-strong">Um lugar para pensar com clareza, ouvir uma leitura franca e escolher seu próximo passo.</p>
      </header>

      {error && <div className="flex items-start gap-2 rounded-xl border border-[var(--urgent)]/30 bg-[var(--urgent-bg)] p-4" role="alert"><CircleAlert size={17} className="mt-0.5 shrink-0 text-[var(--urgent)]" aria-hidden="true" /><p className="break-words text-sm leading-relaxed">{error}</p></div>}
      {notice && <div className="flex items-start gap-2 rounded-xl bg-[var(--calm-bg)] p-3 text-sm text-[var(--calm)]" role="status"><Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{notice}</p></div>}
      {busy && <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4" role="status" aria-live="polite"><LoaderCircle size={17} className="mt-0.5 shrink-0 animate-spin text-[var(--calm)] motion-reduce:animate-none" aria-hidden="true" /><div><p className="text-sm font-medium">{busy === "analyze" ? "Analisando os próximos trechos…" : busy === "review" ? "Preparando sua revisão…" : busy === "chat" ? "O coach está consultando seu contexto…" : "Salvando sua escolha…"}</p>{["analyze", "review", "chat"].includes(busy) && <p className="mt-1 text-xs leading-relaxed text-muted-strong">Esta etapa pode levar alguns minutos. Aguarde para evitar repetir o pedido.</p>}</div></div>}
      {!state.model_available && <div className="rounded-xl border border-border bg-accent p-4"><p className="text-sm font-semibold">A IA está indisponível neste momento</p><p className="mt-1 text-xs leading-relaxed text-muted-strong">Você pode consultar seu histórico, editar objetivos e corrigir memórias. Novas análises e respostas dependem da configuração do provedor.</p></div>}

      {settings && <div id="coach-settings"><SettingsView key={profile.revision} profile={profile} busy={!!busy} mutate={mutate} onClose={() => setSettings(false)} /></div>}

      {!profile.enabled && <section className="rounded-2xl border border-border bg-card p-5 sm:p-7"><h2 className="font-display text-2xl">{state.messages.length || state.reviews.length ? "Seu acompanhamento está pausado" : "Comece pelo que acontece de verdade"}</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">Ao ativar, o coach pode analisar suas reuniões, considerar tarefas e guardar nossas conversas para acompanhar seu desenvolvimento. Você pode corrigir as leituras e pausar quando quiser.</p><p className="mt-2 text-xs leading-relaxed text-muted-strong">Trechos necessários são processados pelo provedor de IA. Revisões e memórias ficam na sua conta; a agenda externa não está conectada.</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" className={primaryClass} disabled={!!busy || !state.model_available} onClick={() => void mutate({ action: "settings", ...profilePayload(profile), enabled: true }, "Coach ativado. Você já pode conversar e iniciar a análise das reuniões.")}>{state.messages.length || state.reviews.length ? "Retomar meu coach" : "Ativar meu coach"}<ArrowRight size={16} aria-hidden="true" /></button><button type="button" className={buttonClass} disabled={!!busy} onClick={() => setSettings(true)}>Definir meus objetivos</button></div></section>}

      <div ref={panel} className="scroll-mt-20">
        <div role="tablist" aria-label="Áreas do coach" className="flex min-w-0 gap-0.5 border-b border-border">
          {tabs.map((item, index) => <button key={item.id} ref={(element) => { tabButtons.current[index] = element; }} id={`coach-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`coach-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => { let next = index; if (event.key === "ArrowRight") next = (index + 1) % tabs.length; else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = tabs.length - 1; else return; event.preventDefault(); setTab(tabs[next].id); tabButtons.current[next]?.focus(); }} className={`relative min-h-12 flex-1 px-1.5 text-xs sm:px-3 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--calm)] ${tab === item.id ? "font-semibold text-foreground after:absolute after:bottom-0 after:left-1.5 after:right-1.5 after:h-0.5 after:bg-[var(--calm)]" : "text-muted-strong hover:text-foreground"}`}>{item.label}{item.id === "memory" && pendingMemories > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px]" aria-label={`${pendingMemories} hipóteses para revisar`}>{pendingMemories}</span>}</button>)}
        </div>
        <div id={`coach-panel-${tab}`} role="tabpanel" aria-labelledby={`coach-tab-${tab}`} className="min-w-0 pt-6 sm:pt-8" tabIndex={0}>
          {tab === "week" && <div className="space-y-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-relaxed text-muted-strong">{profile.weekly_enabled ? `Preferência semanal: ${days[profile.review_day]?.toLowerCase()}, às ${String(profile.review_hour).padStart(2, "0")}:00 · ${profile.timezone.replace("America/", "").replaceAll("_", " ")}` : "Revisão automática desativada"}{!profile.enabled ? " · Coach pausado" : ""}</p><button className={`${buttonClass} !text-xs`} type="button" disabled={!!busy || !operational || coverage.analyzed_chunks === 0} onClick={() => void mutate({ action: "review" }, "Sua revisão está disponível.")}><RefreshCw size={13} aria-hidden="true" /> Preparar revisão</button></div>
            {current ? <ReviewView review={current} onDiscuss={discuss} /> : <section className="rounded-xl border border-dashed border-border px-5 py-7"><BookOpen size={23} className="mb-3 text-[var(--calm)]" aria-hidden="true" /><h2 className="font-display text-2xl">Sua primeira revisão começa com evidências</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">{coverage.total_meetings === 0 ? "Quando houver reuniões finalizadas, o coach poderá analisá-las. Enquanto isso, conte seus objetivos na conversa." : coverage.analyzed_chunks === 0 ? "Analise os primeiros trechos das reuniões. Depois, prepare uma revisão para escolher um ponto importante e uma ação concreta." : "Já há trechos analisados. Prepare a revisão para refletir sobre esse material; a cobertura abaixo mostra o que ainda falta."}</p>{coverage.total_meetings > 0 && coverage.analyzed_chunks === 0 && <button className={`${primaryClass} mt-5`} type="button" disabled={!!busy || !operational} onClick={() => void mutate({ action: "analyze" }, "Cobertura atualizada.")}>Analisar primeiras reuniões <ArrowRight size={15} aria-hidden="true" /></button>}</section>}
            {reviews.length > 1 && <section className="border-t border-border pt-5"><h2 className="mb-2 text-sm font-semibold">Revisões anteriores</h2>{reviews.slice(1).map((review) => <details key={review.id} className="border-b border-border py-3"><summary className="cursor-pointer text-sm leading-relaxed"><span className="text-xs text-muted-strong">Semana de {dateLabel(review.week_start)}</span><span className="mt-1 block font-medium">{review.content.headline}</span></summary><div className="pt-6"><ReviewView review={review} historical onDiscuss={discuss} /></div></details>)}</section>}
          </div>}
          {tab === "chat" && <div className="space-y-6">
            <ChatView messages={state.messages} busy={!!busy} enabled={profile.enabled} available={state.model_available} draft={draft} onDraft={setDraft} mutate={mutate} />
            {current && <button type="button" onClick={() => { setTab("week"); requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" })); }} className="flex w-full items-center gap-3 rounded-xl border border-border bg-accent p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--calm)]">
              <BookOpen size={20} className="shrink-0 text-[var(--calm)]" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-xs text-muted-strong">Sua revisão · semana de {dateLabel(current.week_start)}</span><span className="mt-1 block text-sm font-medium leading-relaxed">{current.content.headline}</span></span>
              <ArrowRight size={18} className="shrink-0" aria-hidden="true" />
            </button>}
          </div>}
          {tab === "memory" && <MemoryView memories={state.memories} busy={!!busy} mutate={mutate} />}
          {tab === "references" && <ReferencesView />}
        </div>
      </div>

      <section aria-label="Cobertura das análises" className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-medium">O que já foi analisado</h2><p className="mt-1 text-xs leading-relaxed text-muted-strong">{coverage.analyzed_meetings} de {coverage.total_meetings} {coverage.total_meetings === 1 ? "reunião" : "reuniões"} com análise completa · {coverage.analyzed_chunks} {coverage.analyzed_chunks === 1 ? "trecho" : "trechos"}</p></div><button type="button" className={`${buttonClass} !text-xs`} disabled={!!busy || !operational || coverage.total_meetings === 0} onClick={() => void mutate({ action: "analyze" }, "Cobertura atualizada.")}><RefreshCw size={13} aria-hidden="true" />{coverage.pending_meetings > 0 ? "Analisar próximos trechos" : "Verificar novas reuniões"}</button></div>
        {coverage.total_meetings > 0 && <div role="progressbar" aria-label="Reuniões completamente analisadas" aria-valuemin={0} aria-valuemax={coverage.total_meetings} aria-valuenow={Math.min(coverage.analyzed_meetings, coverage.total_meetings)} className="my-3 h-1.5 overflow-hidden rounded-full bg-accent"><div className="h-full rounded-full bg-[var(--calm)]" style={{ width: `${Math.min(100, (coverage.analyzed_meetings / coverage.total_meetings) * 100)}%` }} /></div>}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-strong">{coverage.pending_meetings > 0 ? `${coverage.pending_meetings} reuniões ainda têm trechos pendentes. A leitura atual é parcial; cada lote preserva o progresso.` : coverage.total_meetings > 0 ? "Cobertura completa do material elegível neste momento. Novas reuniões e correções podem criar pendências." : "Nenhuma reunião finalizada disponível para análise."}</p>
        {profile.last_run_at && <p className="mt-1 text-[11px] text-muted-strong">Última execução: {dateLabel(profile.last_run_at, { hour: "2-digit", minute: "2-digit" })}.</p>}
        {profile.last_error && <p className="mt-2 text-xs text-[var(--urgent)]">A última execução não terminou. O progresso salvo será retomado na próxima tentativa.</p>}
      </section>
    </div>
  );
}

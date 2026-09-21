"use client";

import { useState } from "react";
import type { CoachProfile } from "@/lib/coach/types";
import type { CalendarStatus } from "@/lib/coach/calendar-types";
import { ShieldCheck, Trash2 } from "lucide-react";
import { buttonClass, fieldClass, primaryClass, type CoachMutation } from "./shared";

export const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function SettingsView({ profile, calendar, busy, mutate, onClose }: { profile: CoachProfile; calendar?:CalendarStatus; busy: boolean; mutate: CoachMutation; onClose: () => void }) {
  const [goals, setGoals] = useState(profile.goals);
  const [context, setContext] = useState(profile.context);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [morning,setMorning]=useState(profile.morning_enabled??false);
  const [evening,setEvening]=useState(profile.evening_enabled??false);
  const [nudges,setNudges]=useState(profile.nudges_enabled??false);
  const [morningHour,setMorningHour]=useState(profile.morning_hour??8);
  const [eveningHour,setEveningHour]=useState(profile.evening_hour??18);
  const [weekly, setWeekly] = useState(profile.weekly_enabled);
  const [day, setDay] = useState(profile.review_day);
  const [hour, setHour] = useState(profile.review_hour);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  return (
    <section aria-label="Configurações do coach" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-display text-2xl">Seus objetivos e dificuldades</h2>
      <form className="mt-5 space-y-5" onSubmit={async (event) => { event.preventDefault(); if (await mutate({ action: "settings", enabled, weekly_enabled: weekly, morning_enabled:morning,evening_enabled:evening,nudges_enabled:nudges,morning_hour:morningHour,evening_hour:eveningHour, goals, context, review_day: day, review_hour: hour, timezone }, "Configurações salvas.")) onClose(); }}>
        <label className="block text-sm font-medium">Meus objetivos<textarea className={`${fieldClass} mt-2 min-h-28 resize-y`} placeholder="O que importa para mim agora? Em que quero avançar?" value={goals} onChange={(event) => setGoals(event.target.value)} maxLength={10000} disabled={busy} /></label>
        <label className="block text-sm font-medium">Meu contexto e minhas dificuldades<textarea className={`${fieldClass} mt-2 min-h-28 resize-y`} placeholder="O que está difícil, o que disputa meu tempo e o que o coach precisa considerar…" value={context} onChange={(event) => setContext(event.target.value)} maxLength={10000} disabled={busy} /></label>
        <fieldset className="space-y-3 border-t border-border pt-4"><legend className="pr-2 text-sm font-semibold">Acompanhamento</legend>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--calm)]" /><span>Coach ativo<span className="mt-1 block text-xs leading-relaxed text-muted-strong">Ao pausar, análises e novas conversas param. Seu histórico continua disponível.</span></span></label>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--calm)]" /><span>Revisão semanal automática<span className="mt-1 block text-xs leading-relaxed text-muted-strong">A revisão fica aqui no Ações, sem enviar seu contexto a outras pessoas.</span></span></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">Dia<select value={day} onChange={(event) => setDay(Number(event.target.value))} disabled={busy} className={`${fieldClass} mt-1.5`}>{days.map((label, value) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium">Horário<select value={hour} onChange={(event) => setHour(Number(event.target.value))} disabled={busy} className={`${fieldClass} mt-1.5`}>{Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}:00</option>)}</select></label></div>
          <div className="space-y-3 border-t border-border pt-3"><p className="text-xs leading-relaxed text-muted-strong">Os acompanhamentos aparecem aqui no Ações. Os horários indicam o início da preparação; você pode conversar a qualquer momento.</p>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={morning} onChange={event=>setMorning(event.target.checked)} disabled={busy} className="size-4 accent-[var(--calm)]"/>Foco no início do dia</label>
            {morning&&<label className="block text-xs">Preparar a partir de<select className={`${fieldClass} mt-1.5`} value={morningHour} onChange={event=>setMorningHour(Number(event.target.value))} disabled={busy}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></label>}
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={evening} onChange={event=>setEvening(event.target.checked)} disabled={busy} className="size-4 accent-[var(--calm)]"/>Fechamento do dia</label>
            {evening&&<label className="block text-xs">Preparar a partir de<select className={`${fieldClass} mt-1.5`} value={eveningHour} onChange={event=>setEveningHour(Number(event.target.value))} disabled={busy}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></label>}
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={nudges} onChange={event=>setNudges(event.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--calm)]"/><span>Retomar meus combinados no prazo<span className="mt-1 block text-xs leading-relaxed text-muted-strong">Quando um combinado chegar ao prazo e continuar em aberto, o coach pode perguntar como foi e ajudar a escolher o próximo passo. No máximo um lembrete por dia, sem presumir que você deixou de cumprir.</span></span></label>
          </div>
          <label className="block text-xs font-medium">Fuso horário<input className={`${fieldClass} mt-1.5`} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Sao_Paulo" required disabled={busy} /></label>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button className={primaryClass} type="submit" disabled={busy}>Salvar configurações</button><button className={buttonClass} type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
      </form>
      <CalendarSettings calendar={calendar} coachEnabled={profile.enabled} busy={busy} mutate={mutate} timezone={profile.timezone}/>
      <div className="mt-6 border-t border-border pt-5"><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} aria-hidden="true" /> Privacidade e contexto disponível</h3><p className="mt-2 text-xs leading-relaxed text-muted-strong">Seu histórico é privado na sua conta. O coach envia ao provedor de IA os trechos necessários para responder e analisar, conforme as condições do provedor configurado. Seu contexto não é publicado; isso não significa retenção zero pelo provedor.</p><p className="mt-2 text-xs leading-relaxed text-muted-strong">Usa seus objetivos, contexto, memórias, combinados e conversas neste coach. Relatórios de reuniões e tarefas acrescentam contexto; trechos da transcrição podem sustentar uma observação. A agenda, quando ativa acima, ajuda a comparar prioridades e tempo planejado. Conversas antigas do assistente no Mac não estão conectadas.</p></div>
      <div className="mt-5 border-t border-border pt-4">
        {!confirmDelete ? <button className="inline-flex min-h-10 items-center gap-2 text-xs text-[var(--urgent)] underline underline-offset-4" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={13} aria-hidden="true" /> Apagar dados do coach</button> : <div className="space-y-3"><p className="text-sm font-medium">Apagar perfil, memória, conversas e análises do coach?</p><p className="text-xs text-muted-strong">A cópia da agenda usada pelo coach também é apagada. Suas reuniões e tarefas permanecem no Ações; os eventos originais permanecem no Outlook. Esta exclusão não pode ser desfeita.</p><label className="block text-xs font-medium">Digite APAGAR COACH para confirmar<input className={`${fieldClass} mt-1.5`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label><div className="flex flex-wrap gap-2"><button className={`${buttonClass} text-[var(--urgent)]`} type="button" disabled={busy || confirmation !== "APAGAR COACH"} onClick={async () => { if (await mutate({ action: "delete", confirm: confirmation }, "Dados do coach apagados.")) onClose(); }}>Apagar definitivamente</button><button className={buttonClass} type="button" disabled={busy} onClick={() => { setConfirmation(""); setConfirmDelete(false); }}>Cancelar exclusão</button></div></div>}
      </div>
    </section>
  );
}

function CalendarSettings({calendar,coachEnabled,busy,mutate,timezone}:{calendar?:CalendarStatus;coachEnabled:boolean;busy:boolean;mutate:CoachMutation;timezone:string}){
 const labels={connected:"Agenda conectada pelo TTARS",not_configured:"Agenda ainda não conectada",not_synced:"Agenda pronta para a primeira leitura",paused:"Leitura da agenda pausada",stale:"Agenda precisa ser atualizada",needs_reconnect:"Reconecte sua conta Microsoft no TTARS",unavailable:"Agenda indisponível neste momento"};
 const status=calendar?.status??"not_configured";
 let updated:string|null=null;
 if(calendar?.updated_at){try{updated=new Intl.DateTimeFormat("pt-BR",{timeZone:timezone,dateStyle:"short",timeStyle:"short"}).format(new Date(calendar.updated_at));}catch{updated=null;}}
 return <section aria-label="Agenda do coach" className="mt-6 border-t border-border pt-5"><h3 className="text-sm font-semibold">Sua agenda, junto das suas prioridades</h3><p className="mt-2 text-sm" role="status">{labels[status]}</p><p className="mt-2 text-xs leading-relaxed text-muted-strong">Ajuda o coach a comparar suas prioridades com o tempo já reservado e propor um dia possível. Um evento mostra o que estava planejado; o coach precisa de registros ou da sua resposta para saber o que aconteceu.</p>{updated&&<p className="mt-2 text-xs text-muted-strong">Última leitura: {updated}.</p>}{calendar?.configured&&<><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={calendar.enabled} disabled={busy} onChange={event=>void mutate({action:"calendar_settings",enabled:event.target.checked},event.target.checked?"Leitura da agenda ativada.":"Leitura da agenda pausada; a cópia local foi removida.")} className="size-4 accent-[var(--calm)]"/>Usar minha agenda</label><button type="button" disabled={busy||!coachEnabled||!calendar.enabled} className={`${buttonClass} !text-xs`} onClick={()=>void mutate({action:"calendar_refresh"})}>Atualizar agenda</button></div><p className="mt-2 text-xs leading-relaxed text-muted-strong">A leitura usa o calendário principal da Microsoft já conectado ao TTARS e só fica disponível nesta conta. Calendários secundários e eventos apenas locais do Mac não estão incluídos. O coach não altera eventos. Ao conversar ou preparar um acompanhamento, atualiza a agenda quando a leitura tem mais de 15 minutos.</p></>}{(status==="unavailable"||status==="stale")&&<p className="mt-2 text-xs text-[var(--urgent)]">O coach vai informar essa limitação, sem tratar seu dia como livre.</p>}</section>;
}

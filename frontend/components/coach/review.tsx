import type { CoachReview, Observation } from "@/lib/coach/types";
import { ArrowRight, MessageCircle } from "lucide-react";
import { competencies, dateLabel, EvidenceList, buttonClass } from "./shared";

function ObservationView({ observation, onDiscuss }: { observation: Observation; onDiscuss: (text: string) => void }) {
  return (
    <article className="py-5 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-[var(--calm)]">{competencies[observation.competency] || "Observação"}</h3>
      <dl className="space-y-3 text-sm leading-relaxed">
        <div><dt className="font-semibold">O que aparece no registro</dt><dd className="mt-1 whitespace-pre-wrap">{observation.observation}</dd></div>
        {observation.hypothesis && <div><dt className="font-semibold">Minha hipótese</dt><dd className="mt-1 whitespace-pre-wrap">{observation.hypothesis}</dd></div>}
        {observation.alternative && <div className="text-muted-strong"><dt className="font-medium">Outra explicação possível</dt><dd className="mt-1 whitespace-pre-wrap">{observation.alternative}</dd></div>}
        {observation.experiment && <div><dt className="font-semibold">Uma ação para testar</dt><dd className="mt-1 whitespace-pre-wrap">{observation.experiment}</dd></div>}
      </dl>
      <EvidenceList evidence={observation.evidence} />
      <button type="button" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-strong underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => onDiscuss(`Quero revisar esta interpretação: “${observation.hypothesis || observation.observation}”. Meu contexto é: `)}>
        <MessageCircle size={13} aria-hidden="true" /> Corrigir ou contextualizar esta leitura
      </button>
    </article>
  );
}

export function ReviewView({ review, historical = false, onDiscuss }: { review: CoachReview; historical?: boolean; onDiscuss: (text: string) => void }) {
  const content = review.content;
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-xs text-muted-strong">Semana de {dateLabel(review.week_start)}{historical ? " · Registro histórico" : ""}</p>
        {review.stale && <p className="mb-4 rounded-lg bg-accent px-3 py-2 text-xs leading-relaxed text-muted-strong">Esta revisão precisa ser reavaliada: seu contexto ou as fontes mudaram. Ela permanece aqui como registro histórico.</p>}
        <h2 className="font-display text-[1.75rem] sm:text-[2.1rem] leading-tight">{content.headline}</h2>
        {content.focus && <div className="mt-5 border-l-[3px] border-[var(--calm)] pl-4"><p className="mb-1 text-xs font-semibold text-[var(--calm)]">Seu foco agora</p><p className="whitespace-pre-wrap text-base leading-relaxed">{content.focus}</p></div>}
      </div>
      {content.observations.length > 0 && <div className="divide-y divide-border">{content.observations.map((observation, index) => <ObservationView key={index} observation={observation} onDiscuss={onDiscuss} />)}</div>}
      {content.progress && <section><h3 className="mb-2 text-sm font-semibold">O que mudou</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-strong">{content.progress}</p></section>}
      {content.experiment && <section className="rounded-xl bg-accent p-4 sm:p-5"><div className="mb-2 flex items-center gap-2"><ArrowRight size={16} className="text-[var(--calm)]" aria-hidden="true" /><h3 className="text-sm font-semibold">Um experimento para a próxima semana</h3></div><p className="whitespace-pre-wrap text-sm leading-relaxed">{content.experiment}</p></section>}
      {content.question && <div><p className="font-display text-xl leading-relaxed">{content.question}</p><button className={`${buttonClass} mt-3`} type="button" onClick={() => onDiscuss(`Sobre sua pergunta: “${content.question}”\n\n`)}>Conversar sobre isso <MessageCircle size={15} aria-hidden="true" /></button></div>}
      {content.limitations.length > 0 && <details className="border-t border-border pt-3 text-xs text-muted-strong"><summary className="min-h-9 cursor-pointer py-2 font-medium">Limites desta leitura</summary><ul className="list-disc space-y-2 pl-4 leading-relaxed">{content.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
      <p className="text-[11px] text-muted-strong">Gerada em {dateLabel(review.created_at)}. Uma revisão representa o material disponível naquele momento.</p>
    </div>
  );
}

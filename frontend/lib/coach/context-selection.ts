import { fromZonedTime } from "date-fns-tz";

export type ContextPeriod = {kind:"today"|"yesterday"|"week"|"last_week"|"month"|"last_month"|"explicit";label:string;from:string;to:string;timezone:string};
export type ContextOptions = {now?:Date;timezone?:string;period?:{from:string;to:string;label?:string}};
/** Calendar dates belong to the profile's timezone, never the host's timezone. */
export function resolveContextPeriod(query: string, options: ContextOptions = {}): ContextPeriod | null {
  const timezone = options.timezone ?? "America/Sao_Paulo";
  if (options.period) {
    const from = new Date(options.period.from); const to = new Date(options.period.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("Período inválido");
    return {kind:"explicit",label:options.period.label ?? "período solicitado",from:from.toISOString(),to:to.toISOString(),timezone};
  }
  const normalized = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const kind = /\b(semana passada|ultima semana)\b/.test(normalized) ? "last_week" : /\b(mes passado|ultimo mes)\b/.test(normalized) ? "last_month" : /\b(este|esse|neste|nesse) mes\b/.test(normalized) ? "month" : /\bontem\b/.test(normalized) ? "yesterday" : /\b(esta|essa|nesta|nessa) semana\b/.test(normalized) ? "week"
    : /\bhoje\b|\b(meu|o meu) dia\b/.test(normalized) ? "today" : null;
  if (!kind) return null;
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(options.now ?? new Date());
  const part = (type:string) => parts.find(p => p.type === type)?.value;
  const local = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  if (kind === "yesterday") local.setUTCDate(local.getUTCDate()-1);
  if (kind === "week" || kind === "last_week") local.setUTCDate(local.getUTCDate() - (local.getUTCDay()+6)%7 - (kind === "last_week" ? 7 : 0));
  if (kind === "month" || kind === "last_month") {local.setUTCDate(1);if(kind==="last_month")local.setUTCMonth(local.getUTCMonth()-1);}
  const start = local.toISOString().slice(0,10);
  if(kind==="month"||kind==="last_month")local.setUTCMonth(local.getUTCMonth()+1);
  else local.setUTCDate(local.getUTCDate() + (kind === "week" || kind === "last_week" ? 7 : 1));
  const end = local.toISOString().slice(0,10);
  return {kind,label:`${kind === "today" ? "hoje" : kind === "yesterday" ? "ontem" : kind === "last_week" ? "semana passada" : kind === "month" ? "este mês" : kind === "last_month" ? "mês passado" : "esta semana"} (${start})`,
    from:fromZonedTime(`${start}T00:00:00`,timezone).toISOString(),to:fromZonedTime(`${end}T00:00:00`,timezone).toISOString(),timezone};
}

/** Avoid ranking generic coaching words as if they identified a specific project. */
export function contextSearchTerms(query:string):string {
  const filler = new Set(["como","posso","pode","poderia","quero","preciso","ajude","ajuda","ajudar","meu","meus","minha","minhas","hoje","ontem","esta","essa","nesta","nessa","semana","passada","passado","ultima","ultimo","mes","este","esse","neste","nesse","dia","coach","voce","para","sobre","com","foi","estou","fazer","revisar","revise","avaliar","avalie"]);
  return query.slice(0,5000).split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length > 2 && !filler.has(word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())).join(" ");
}

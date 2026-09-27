// Formato do que o TTARS manda (conferido antes de tocar no banco).
import type { Candidato, Legenda } from "./teams";

const texto = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const data = (v: unknown) => {
  const s = texto(v, 40);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
};

export function lerCandidato(v: unknown): Candidato | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const chave = texto(o.chave, 400);
  const organizador = texto(o.organizador, 200);
  const inicio = data(o.inicio);
  const fim = data(o.fim);
  if (!chave || !organizador?.includes("@") || !inicio || !fim) return null;
  const convidados = Array.isArray(o.convidados)
    ? o.convidados.filter((e): e is string => typeof e === "string" && e.length <= 200 && e.includes("@")).slice(0, 300)
    : [];
  const assunto = o.assunto == null ? null : texto(o.assunto, 500);
  return { chave, organizador, convidados, inicio, fim, assunto };
}

// Uma reunião de 3 h passa pouco de 200 mil letras; 4 MB cobre folgado sem abrir a porta.
const MAX_LEGENDA = 4 * 1024 * 1024;

export function lerLegendas(v: unknown): Legenda[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 30) return null;
  const out: Legenda[] = [];
  for (const l of v) {
    const o = (l ?? {}) as Record<string, unknown>;
    const criado = data(o.criado);
    const vtt = texto(o.vtt, MAX_LEGENDA);
    if (!criado || vtt == null) return null;
    out.push({ criado, vtt });
  }
  return out;
}

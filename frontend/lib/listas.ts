// Listas salvas do hub (28/09/2026): o filtro que a pessoa montou, com nome. Só dela.
import { ONDE_RE, ORDENS, VISTAS } from "./hub";

export type DadosDaLista = { nome?: string; onde?: string; filtro?: Record<string, unknown>; ordem?: string | null; vista?: string | null };

export function lerLista(b: Record<string, unknown>, criando: boolean): { ok: true; dados: DadosDaLista } | { ok: false; erro: string } {
  const d: DadosDaLista = {};
  if (b.nome !== undefined || criando) {
    const nome = typeof b.nome === "string" ? b.nome.replace(/\s+/g, " ").trim() : "";
    if (!nome || nome.length > 80) return { ok: false, erro: "Dê um nome à lista (até 80 letras)." };
    d.nome = nome;
  }
  if (criando) {
    if (typeof b.onde !== "string" || !ONDE_RE.test(b.onde)) return { ok: false, erro: "Lugar da lista inválido." };
    d.onde = b.onde;
  }
  if (b.filtro !== undefined || criando) {
    const f = b.filtro ?? {};
    if (typeof f !== "object" || Array.isArray(f) || f === null || JSON.stringify(f).length > 8000) return { ok: false, erro: "Filtro inválido." };
    d.filtro = f as Record<string, unknown>;
  }
  if (b.ordem !== undefined) {
    if (b.ordem !== null && !(typeof b.ordem === "string" && ORDENS.includes(b.ordem))) return { ok: false, erro: "Ordem inválida." };
    d.ordem = (b.ordem as string | null) ?? null;
  }
  if (b.vista !== undefined) {
    if (b.vista !== null && !(typeof b.vista === "string" && VISTAS.includes(b.vista))) return { ok: false, erro: "Visão inválida." };
    d.vista = (b.vista as string | null) ?? null;
  }
  return { ok: true, dados: d };
}

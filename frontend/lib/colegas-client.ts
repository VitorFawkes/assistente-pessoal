"use client";

// Equipe: lista de colegas (quem pode receber tarefa), buscada uma vez por página.
export type ColegaCliente = { id: string; nome: string };
type Resposta = { eu: string | null; colegas: ColegaCliente[] };

let cache: Promise<Resposta> | null = null;

export function carregarColegas(): Promise<Resposta> {
  if (!cache) {
    cache = fetch("/api/equipe/colegas")
      .then((r) => (r.ok ? r.json() : { eu: null, colegas: [] }))
      .then((d: Partial<Resposta>) => ({ eu: d.eu ?? null, colegas: d.colegas ?? [] }))
      .catch(() => {
        cache = null;
        return { eu: null, colegas: [] };
      });
  }
  return cache;
}

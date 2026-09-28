// Objetivos do hub (28/09/2026): conferir o que chega das telas antes de gravar.
import { DIA_RE, VISIBILIDADES, podeTime, timeIdValido, type Visibilidade } from "./hub";

export type DadosDoObjetivo = { nome: string; como_medir: string | null; prazo: string | null; visibilidade: Visibilidade; time_id: string | null };

/** Confere o corpo de criar/mudar objetivo. `parcial` aceita só parte dos campos. */
export async function lerObjetivo(
  userId: string,
  b: Record<string, unknown>,
  parcial: boolean,
): Promise<{ ok: true; dados: Partial<DadosDoObjetivo> } | { ok: false; erro: string }> {
  const d: Partial<DadosDoObjetivo> = {};
  if (b.nome !== undefined || !parcial) {
    const nome = typeof b.nome === "string" ? b.nome.replace(/\s+/g, " ").trim() : "";
    if (!nome || nome.length > 200) return { ok: false, erro: "Dê um nome ao objetivo (até 200 letras)." };
    d.nome = nome;
  }
  if (b.como_medir !== undefined) {
    const t = typeof b.como_medir === "string" ? b.como_medir.trim() : "";
    if (t.length > 2000) return { ok: false, erro: "Como medir: até 2.000 letras." };
    d.como_medir = t || null;
  }
  if (b.prazo !== undefined) {
    if (b.prazo !== null && !(typeof b.prazo === "string" && DIA_RE.test(b.prazo))) return { ok: false, erro: "Data inválida." };
    d.prazo = (b.prazo as string | null) ?? null;
  }
  if (b.visibilidade !== undefined || !parcial) {
    const v = (b.visibilidade ?? "so_eu") as Visibilidade;
    if (!VISIBILIDADES.includes(v)) return { ok: false, erro: "Quem vê: só eu, um time ou toda a Welcome." };
    d.visibilidade = v;
  }
  if (b.time_id !== undefined) {
    if (b.time_id !== null && !(timeIdValido(b.time_id) && (await podeTime(userId, b.time_id)))) {
      return { ok: false, erro: "Você não está nesse time." };
    }
    d.time_id = (b.time_id as string | null) ?? null;
  }
  return { ok: true, dados: d };
}


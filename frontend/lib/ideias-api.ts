"use client";

// Liga a tela de Ideias nas rotas certas: as do dono ou as do link do convidado.
import { toast } from "sonner";
import type { Ideia } from "./ideias";

export type IdeiasApi = {
  listar: () => Promise<Ideia[]>;
  guardar: (texto: string, tema: string) => Promise<Ideia[]>;
  apoiar: (id: string) => Promise<Ideia[]>;
  editar: (id: string, texto: string) => Promise<void>;
  excluir: (id: string) => Promise<void>;
  virarTarefa: (ideia: Ideia) => Promise<void>;
};

async function pega(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${r.status}`);
  return r;
}

/** Título da tarefa = as primeiras 70 letras; o texto inteiro vira o resumo. */
export function tituloDaIdeia(texto: string): string {
  const t = texto.trim();
  if (t.length <= 70) return t;
  return t.slice(0, 70).replace(/\s+\S*$/, "") + "…";
}

export function ideiasDoDono(quadroId: string, aoMudarTarefas: () => void): IdeiasApi {
  const base = `/api/quadros/${quadroId}/ideias`;
  const comErro = async <T>(f: () => Promise<T>, msg: string): Promise<T> => {
    try { return await f(); } catch (e) { toast.error(msg); throw e; }
  };
  return {
    listar: () => comErro(async () => (await (await pega(base)).json()).ideias as Ideia[], "Erro ao carregar ideias"),
    guardar: (texto, tema) =>
      comErro(async () => (await (await pega(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, tema }),
      })).json()).ideias as Ideia[], "Erro ao guardar a ideia"),
    apoiar: (id) =>
      comErro(async () => (await (await pega(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "apoiar", ideia_id: id }),
      })).json()).ideias as Ideia[], "Erro ao apoiar"),
    editar: async (id, texto) => {
      await comErro(() => pega(`${base}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      }), "Erro ao salvar a ideia");
    },
    excluir: async (id) => {
      await comErro(() => pega(`${base}/${id}`, { method: "DELETE" }), "Erro ao excluir a ideia");
    },
    virarTarefa: async (ideia) => {
      const nova = await comErro(async () => {
        const r = await pega("/api/tarefas", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titulo: tituloDaIdeia(ideia.texto),
            descricao: ideia.texto,
            frente_id: ideia.frente_id,
          }),
        });
        return (await r.json()) as { id?: string; tarefa?: { id: string } };
      }, "Erro ao virar tarefa");
      const tarefaId = nova.id ?? nova.tarefa?.id;
      if (!tarefaId) return;
      await pega(`/api/quadros/${quadroId}/tarefas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: [tarefaId] }),
      }).catch(() => null);
      await pega(`${base}/${ideia.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefa_id: tarefaId }),
      }).catch(() => null);
      toast.success("Virou tarefa no quadro");
      aoMudarTarefas();
    },
  };
}

export function ideiasDoConvidado(token: string, aoMudarTarefas: () => void): IdeiasApi {
  const base = `/api/q/${token}/ideias`;
  const comErro = async <T>(f: () => Promise<T>, msg: string): Promise<T> => {
    try { return await f(); } catch (e) { toast.error(msg); throw e; }
  };
  return {
    listar: () => comErro(async () => (await (await pega(base)).json()).ideias as Ideia[], "Erro ao carregar ideias"),
    guardar: (texto, tema) =>
      comErro(async () => (await (await pega(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, tema }),
      })).json()).ideias as Ideia[], "Erro ao guardar a ideia"),
    apoiar: (id) =>
      comErro(async () => (await (await pega(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "apoiar", ideia_id: id }),
      })).json()).ideias as Ideia[], "Erro ao apoiar"),
    editar: async (id, texto) => {
      await comErro(() => pega(`${base}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      }), "Erro ao salvar a ideia");
    },
    excluir: async (id) => {
      await comErro(() => pega(`${base}/${id}`, { method: "DELETE" }), "Erro ao excluir a ideia");
    },
    virarTarefa: async (ideia) => {
      const nova = await comErro(async () => {
        const r = await pega(`/api/q/${token}/tarefas`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titulo: tituloDaIdeia(ideia.texto),
            descricao: ideia.texto,
            frente_id: ideia.frente_id,
          }),
        });
        return (await r.json()) as { id?: string; tarefa?: { id: string } };
      }, "Erro ao virar tarefa");
      const tarefaId = nova.id ?? nova.tarefa?.id;
      if (tarefaId) {
        await pega(`${base}/${ideia.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tarefa_id: tarefaId }),
        }).catch(() => null);
      }
      toast.success("Virou tarefa no quadro");
      aoMudarTarefas();
    },
  };
}

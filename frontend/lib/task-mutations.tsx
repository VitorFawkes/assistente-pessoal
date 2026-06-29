"use client";

import { createContext, useContext, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Tarefa, Acao, TarefaPessoa } from "@/lib/queries";

// Tipos publicamente consumidos
export type TaskMutations = {
  // Editar tarefa existente (patch parcial)
  patch: (
    id: string,
    body: Partial<{
      titulo?: string;
      descricao?: string | null;
      owner?: string;
      acao?: Acao;
      prazo?: string | null;
      prazo_text?: string | null;
      prioridade?: Tarefa["prioridade"];
      status?: Tarefa["status"];
      no_plano?: boolean;
      frente_id?: string | null;
      inicio?: string | null;
      pessoas?: TarefaPessoa[];
    }>,
  ) => Promise<Tarefa | null>;

  // Deletar tarefa
  remove: (id: string, opts?: { motivo?: string }) => Promise<void>;

  // Criar tarefa nova
  create: (draft: {
    titulo: string;
    descricao?: string | null;
    owner?: string;
    acao?: Acao;
    prazo?: string | null;
    prazo_text?: string | null;
    prioridade?: Tarefa["prioridade"];
    frente_id?: string | null;
    inicio?: string | null;
    pessoas?: TarefaPessoa[];
    no_plano?: boolean;
  }) => Promise<Tarefa | null>;

  // Listar áreas (frentes) disponíveis
  listFrentes: () => Promise<{ id: string; nome: string }[]>;

  // Criar nova área (dono só)
  createFrente?: (nome: string) => Promise<{ id: string; nome: string } | null>;

  // Refresh: router.refresh() (dono) ou re-fetch local (convidado)
  refresh: () => void;

  // Escopo: indica se é dono ou convidado (UI, não segurança)
  scope: "owner" | "guest";
};

export const TaskMutationContext = createContext<TaskMutations | null>(null);

export function useTaskMutations(): TaskMutations {
  const ctx = useContext(TaskMutationContext);
  if (!ctx)
    throw new Error(
      "useTaskMutations deve estar dentro de TaskMutationProvider",
    );
  return ctx;
}

// OwnerTaskProvider — para donos (PATCH/DELETE/POST `/api/tarefas/*`)
export type OwnerTaskProviderProps = {
  children: ReactNode;
};

export function OwnerTaskProvider({ children }: OwnerTaskProviderProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const value: TaskMutations = {
    patch: async (id, body) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tarefas/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
        const data = await res.json();
        toast.success("Tarefa atualizada");
        router.refresh();
        return data;
      } catch (err) {
        toast.error(
          `Erro ao atualizar: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },

    remove: async (id, opts) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tarefas/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            motivo: opts?.motivo || "deletada pelo usuário",
          }),
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
        toast.success("Tarefa removida");
        router.refresh();
      } catch (err) {
        toast.error(
          `Erro ao remover: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
      } finally {
        setIsLoading(false);
      }
    },

    create: async (draft) => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tarefas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const data = await res.json();
        toast.success("Tarefa criada");
        router.refresh();
        return data;
      } catch (err) {
        toast.error(
          `Erro ao criar: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },

    listFrentes: async () => {
      try {
        const res = await fetch("/api/frentes");
        if (!res.ok) throw new Error(`GET frentes failed: ${res.status}`);
        const data = await res.json();
        return data.frentes || [];
      } catch (err) {
        toast.error("Erro ao carregar áreas");
        return [];
      }
    },

    refresh: () => {
      router.refresh();
    },

    scope: "owner",
  };

  return (
    <TaskMutationContext.Provider value={value}>
      {children}
    </TaskMutationContext.Provider>
  );
}

// GuestTaskProvider — para convidados (PATCH/DELETE/POST `/api/q/[token]/*`)
export type GuestTaskProviderProps = {
  token: string;
  children: ReactNode;
};

export function GuestTaskProvider({ token, children }: GuestTaskProviderProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);

  const value: TaskMutations = {
    patch: async (id, body) => {
      const old = tarefas.find((t) => t.id === id);
      setTarefas((t) => t.map((x) => (x.id === id ? { ...x, ...body } as Tarefa : x)));
      try {
        const res = await fetch(`/api/q/${token}/tarefas/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
        const data = await res.json();
        setTarefas((t) => t.map((x) => (x.id === id ? data : x)));
        toast.success("Tarefa atualizada");
        return data;
      } catch (err) {
        if (old) setTarefas((t) => t.map((x) => (x.id === id ? old : x)));
        toast.error(
          `Erro ao atualizar: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
        return null;
      }
    },

    remove: async (id) => {
      const old = tarefas.find((t) => t.id === id);
      setTarefas((t) => t.filter((x) => x.id !== id));
      try {
        const res = await fetch(`/api/q/${token}/tarefas/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
        toast.success("Tarefa removida");
      } catch (err) {
        if (old) setTarefas((t) => [...t, old]);
        toast.error(
          `Erro ao remover: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
      }
    },

    create: async (draft) => {
      try {
        const res = await fetch(`/api/q/${token}/tarefas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const data = await res.json();
        setTarefas((t) => [...t, data]);
        toast.success("Tarefa criada");
        return data;
      } catch (err) {
        toast.error(
          `Erro ao criar: ${err instanceof Error ? err.message : "desconhecido"}`,
        );
        return null;
      }
    },

    listFrentes: async () => {
      try {
        const res = await fetch(`/api/q/${token}/frentes`);
        if (!res.ok) throw new Error(`GET frentes failed: ${res.status}`);
        const data = await res.json();
        return data.frentes || [];
      } catch (err) {
        toast.error("Erro ao carregar áreas");
        return [];
      }
    },

    refresh: () => {
      // Re-fetch local das tarefas (sem router.refresh)
      fetch(`/api/q/${token}/tarefas`)
        .then((r) => r.json())
        .then((data) => setTarefas(data.tarefas || []))
        .catch(() =>
          toast.error("Erro ao recarregar tarefas"),
        );
    },

    scope: "guest",
  };

  return (
    <TaskMutationContext.Provider value={value}>
      {children}
    </TaskMutationContext.Provider>
  );
}

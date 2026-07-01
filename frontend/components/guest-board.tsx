"use client";

import { GuestTaskProvider, useGuestTasks } from "@/lib/task-mutations";
import type { AcessoConvidado } from "@/lib/quadros";
import { TaskBoardView } from "./task-board-view";
import { CaptureComposer } from "./capture-composer";

interface GuestBoardProps {
  token: string;
  acesso: AcessoConvidado;
}

interface GuestBoardContentProps {
  acesso: AcessoConvidado;
}

function GuestBoardContent({ acesso }: GuestBoardContentProps) {
  const { tarefas, loading } = useGuestTasks();

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Cabeçalho */}
        <header className="mb-8 pb-6 border-b border-[color:var(--border)]">
          <h1 className="font-display text-3xl sm:text-4xl font-light mb-2 text-[color:var(--foreground)]">
            {acesso.quadroNome}
          </h1>
          <p className="text-sm text-[color:var(--muted-strong)]">
            Você está como{" "}
            <span className="font-semibold text-[color:var(--calm)]">
              {acesso.convidadoNome}
            </span>
          </p>
        </header>

        {/* Criar nova tarefa — no topo */}
        <div className="mb-8">
          <CaptureComposer onOpenFull={() => {}} />
        </div>

        {/* Lista de tarefas com busca / filtros / agrupar / ordenar */}
        <main className="mb-12">
          {loading ? (
            <div className="flex justify-center py-16">
              <p className="text-[color:var(--muted)]">Carregando tarefas…</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                  Tarefas
                </h3>
                <span className="text-[color:var(--muted)] text-base">
                  {tarefas.length}
                </span>
              </div>
              <TaskBoardView tarefas={tarefas} />
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[color:var(--border)] text-center">
          <p className="text-xs text-[color:var(--muted)]">
            Quadro compartilhado — acesso seguro por link
          </p>
        </footer>
      </div>
    </div>
  );
}

export function GuestBoard({ token, acesso }: GuestBoardProps) {
  return (
    <GuestTaskProvider token={token}>
      <GuestBoardContent acesso={acesso} />
    </GuestTaskProvider>
  );
}

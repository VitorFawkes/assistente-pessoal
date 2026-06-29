"use client";

import { useState } from "react";
import { GuestTaskProvider, useGuestTasks } from "@/lib/task-mutations";
import type { AcessoConvidado } from "@/lib/quadros";
import { TaskRow } from "./task-row";
import { CaptureComposer } from "./capture-composer";
import { GuestBoardError } from "./guest-board-error";

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
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        {/* Cabeçalho */}
        <header className="mb-12 pb-8 border-b-2 border-[color:var(--border)]">
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-light mb-3 text-[color:var(--foreground)]">
            {acesso.quadroNome}
          </h1>
          <p className="text-sm sm:text-base text-[color:var(--muted-strong)]">
            Você está como <span className="font-semibold text-[color:var(--calm)]">{acesso.convidadoNome}</span>
          </p>
        </header>

        {/* Lista de tarefas */}
        <main className="mb-12">
          {loading ? (
            <div className="flex justify-center py-16">
              <p className="text-[color:var(--muted)]">Carregando tarefas...</p>
            </div>
          ) : tarefas.length === 0 ? (
            <GuestBoardError type="empty_board" />
          ) : (
            <div className="space-y-3">
              {tarefas.map((tarefa) => (
                <TaskRow key={tarefa.id} tarefa={tarefa} />
              ))}
            </div>
          )}
        </main>

        {/* Separador visual */}
        <div className="flex items-center gap-4 my-12">
          <div className="flex-1 h-px bg-[color:var(--border)]" />
          <span className="text-xs text-[color:var(--muted)]">Criar nova tarefa</span>
          <div className="flex-1 h-px bg-[color:var(--border)]" />
        </div>

        {/* Composer */}
        <section>
          <h2 className="font-display text-lg sm:text-xl mb-4 text-[color:var(--foreground)]">
            Contribuir
          </h2>
          <div className="bg-[color:var(--card)] rounded-lg border border-[color:var(--border)] p-4 sm:p-6">
            <CaptureComposer onOpenFull={() => {}} />
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[color:var(--border)] text-center">
          <p className="text-xs text-[color:var(--muted)]">
            Quadro compartilhado — Acesso seguro por link
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

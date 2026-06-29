"use client";

import { useState } from "react";
import { GuestTaskProvider, useGuestTasks } from "@/lib/task-mutations";
import type { AcessoConvidado } from "@/lib/quadros";
import { TaskRow } from "./task-row";
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
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Cabeçalho */}
      <div className="mb-8 pb-6 border-b-2 border-[color:var(--border)]">
        <h1 className="font-display text-3xl sm:text-4xl mb-2">{acesso.quadroNome}</h1>
        <p className="text-sm text-[color:var(--muted-strong)]">
          Você está como {acesso.convidadoNome}
        </p>
      </div>

      {/* Lista de tarefas */}
      <div className="mb-8">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-[color:var(--muted-foreground)]">Carregando...</p>
          </div>
        ) : tarefas.length === 0 ? (
          <div className="border-2 border-dashed border-[color:var(--accent)] rounded-lg p-8 text-center text-[color:var(--muted-foreground)]">
            <p className="mb-4">Nenhuma tarefa neste quadro ainda.</p>
            <p className="text-sm">Crie uma usando o composer abaixo!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tarefas.map((tarefa) => (
              <TaskRow key={tarefa.id} tarefa={tarefa} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="mt-8 pt-8 border-t-2 border-[color:var(--border)]">
        <h2 className="font-display text-lg mb-4">Criar tarefa</h2>
        <CaptureComposer onOpenFull={() => {}} />
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

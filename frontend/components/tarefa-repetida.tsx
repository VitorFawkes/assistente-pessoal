"use client";

// Tarefa falada de novo e tarefa que parece repetida.
//
// Quando uma reunião volta a falar de uma tarefa que já existe, ela não vira
// card novo: entra no card antigo como "falada de novo em DD/MM" (com o trecho
// e a reunião). Quando a comparação fica em dúvida, o card nasce com o aviso
// "Parece repetida de…" e dois botões. Os cliques viram exemplo pra próxima
// comparação. Tudo isso é só do dono — o convidado não vê.
import { isOwner } from "@/lib/owner-slug";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Mic, Quote, Repeat, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { diaMesBR, ehDataValida } from "@/lib/data-br";
import { meetingSubject } from "@/lib/meeting-label";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa, TarefaMencao } from "@/lib/queries";

const dia = (iso: string | null | undefined) => (iso && ehDataValida(iso) ? diaMesBR(iso) : "");

async function chamar(body: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("/api/tarefas/repetidas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return true;
  } catch (e) {
    toast.error(`Não consegui salvar: ${e instanceof Error ? e.message : "erro"}`);
    return false;
  }
}

/** Selo curto na linha do card: "falada de novo 12/08" ou "falada de novo 3×". */
export function FaladaDeNovoSelo({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const mencoes = tarefa.mencoes ?? [];
  if (mut.scope !== "owner" || !mencoes.length) return null;
  const ultima = mencoes[mencoes.length - 1];
  const texto = mencoes.length === 1 ? `falada de novo ${dia(ultima.meeting_recorded_at)}` : `falada de novo ${mencoes.length}×`;
  return (
    <span
      title={`Voltou a ser falada em ${mencoes.map((m) => dia(m.meeting_recorded_at)).filter(Boolean).join(", ")}. Abra o card pra ver.`}
      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0 rounded bg-[color:var(--calm-bg)] text-[color:var(--calm)] whitespace-nowrap"
    >
      <Repeat size={10} className="shrink-0" />
      {texto}
    </span>
  );
}

/** Faixa do card em dúvida: "Parece repetida de: …" + É a mesma / São diferentes. */
export function PareceRepetidaAviso({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [ocupado, setOcupado] = useState(false);
  const outra = tarefa.parece_com;
  const aberta = tarefa.status !== "concluida" && tarefa.status !== "cancelada";
  if (mut.scope !== "owner" || !outra || !aberta) return null;

  async function agir(e: React.MouseEvent, body: Record<string, string>, ok: string) {
    e.stopPropagation();
    if (ocupado) return;
    setOcupado(true);
    if (await chamar(body)) {
      toast.success(ok);
      mut.refresh();
    }
    setOcupado(false);
  }

  const quando = dia(outra.meeting_recorded_at);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-[color:var(--warm)]/40 bg-[color:var(--warm-bg)] px-2.5 py-1.5 text-[12px]"
    >
      <Copy size={12} className="shrink-0 text-[color:var(--warm)]" />
      <span className="min-w-0 flex-1 text-[color:var(--foreground)]">
        Parece repetida de: <span className="font-medium">&ldquo;{outra.titulo}&rdquo;</span>
        {quando && <span className="text-[color:var(--muted-strong)]">, de {quando}</span>}
        {outra.status === "concluida" && (
          <span className="text-[color:var(--muted-strong)]">
            {" "}(concluída{dia(outra.concluida_em) ? ` em ${dia(outra.concluida_em)}` : ""})
          </span>
        )}
      </span>
      <span className="flex gap-1.5">
        <button
          type="button"
          disabled={ocupado}
          onClick={(e) =>
            agir(e, { acao: "juntar", tarefa_id: tarefa.id, alvo_id: outra.id }, "Juntei no card que já existia")
          }
          className="press-feedback rounded-full bg-[color:var(--foreground)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--background)] disabled:opacity-50"
        >
          É a mesma, juntar
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={(e) => agir(e, { acao: "diferentes", tarefa_id: tarefa.id }, "Ok, ficam as duas")}
          className="press-feedback rounded-full border border-[color:var(--border)] px-2.5 py-1 text-[11px] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] disabled:opacity-50"
        >
          São diferentes
        </button>
      </span>
    </div>
  );
}

function Mencao({ m, podeSeparar }: { m: TarefaMencao; podeSeparar: boolean }) {
  const mut = useTaskMutations();
  const [ocupado, setOcupado] = useState(false);
  const [verTrecho, setVerTrecho] = useState(false);
  const assunto = meetingSubject(m.meeting_summary, m.meeting_nome) || "reunião";

  async function separar() {
    if (ocupado) return;
    setOcupado(true);
    if (await chamar({ acao: "separar", mencao_id: m.id })) {
      toast.success("Virou uma tarefa separada");
      mut.refresh();
    }
    setOcupado(false);
  }

  return (
    <li className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-[12px] space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium tabular-nums">{dia(m.meeting_recorded_at) || dia(m.created_at)}</span>
        {m.meeting_id ? (
          <Link
            href={`/reunioes/${m.meeting_id}`}
            className="inline-flex min-w-0 items-center gap-1 rounded bg-[color:var(--accent)] px-1.5 text-[11px] text-[color:var(--muted-strong)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)]"
          >
            <Mic size={10} className="shrink-0" />
            <span className="truncate max-w-[220px]">{assunto}</span>
          </Link>
        ) : (
          <span className="text-[color:var(--muted)]">juntada na mão</span>
        )}
        {m.evidencia && (
          <button
            type="button"
            onClick={() => setVerTrecho((v) => !v)}
            className="inline-flex items-center gap-0.5 text-[11px] text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            <Quote size={10} /> trecho
          </button>
        )}
        {podeSeparar && (
          <button
            type="button"
            disabled={ocupado}
            onClick={separar}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] disabled:opacity-50"
          >
            <Split size={11} /> Virar tarefa separada
          </button>
        )}
      </div>
      <p className="text-[color:var(--muted-strong)]">Dito assim: &ldquo;{m.titulo_falado}&rdquo;</p>
      {m.owner_falado && !isOwner(m.owner_falado) && (
        <p className="text-[11px] text-[color:var(--muted)]">Dono citado nesta reunião: {m.owner_falado}</p>
      )}
      {m.prazo_anterior && m.prazo_falado && (
        <p className="text-[11px] text-[color:var(--warm)]">
          Prazo mudou de {dia(m.prazo_anterior)} para {dia(m.prazo_falado)}
        </p>
      )}
      {verTrecho && m.evidencia && (
        <p className="border-l-2 border-[color:var(--border)] pl-3 italic text-[color:var(--muted)]">
          &ldquo;{m.evidencia}&rdquo;
        </p>
      )}
    </li>
  );
}

/** Lista "Falada de novo" dentro do card aberto. */
export function MencoesLista({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const mencoes = tarefa.mencoes ?? [];
  if (mut.scope !== "owner" || !mencoes.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[color:var(--muted)]">
        <Repeat size={11} /> Falada de novo ({mencoes.length})
      </p>
      <ul className={cn("space-y-1.5")}>
        {mencoes.map((m) => (
          <Mencao key={m.id} m={m} podeSeparar />
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Calendar, Trash2, UserRound } from "lucide-react";
import { cn, normalizeOwner, isOwnerMe } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import { TaskAnexos } from "./task-anexos";
import { OwnerPicker } from "./inline-edit-chips";
import type { Tarefa, TarefaPessoa } from "@/lib/queries";

// Campos que NÃO cabem na linha compacta (a linha já edita título, prazo,
// prioridade, ação/dono e área inline). Aqui fica o resto: descrição, pessoas,
// início+plano, status e remover. Tudo auto-salva via `mut`.
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function dateInputToIsoStart(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

const STATUS: { v: Tarefa["status"]; label: string }[] = [
  { v: "aberta", label: "Aberta" },
  { v: "em_andamento", label: "Em andamento" },
  { v: "concluida", label: "Concluída" },
  { v: "cancelada", label: "Cancelada" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--muted)] block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// Editor de dono dentro do expand: mostra o dono atual; clica → abre o mesmo
// seletor por nome do chip inline (OwnerPicker). Trocar o dono é só trocar o nome.
function OwnerField({ tarefa }: { tarefa: Tarefa }) {
  const [editing, setEditing] = useState(false);
  const me = isOwnerMe(tarefa.owner);
  if (editing) {
    return (
      <div className="rounded-lg border border-[color:var(--border)] p-1">
        <OwnerPicker tarefa={tarefa} close={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--border)] bg-transparent text-[13px] hover:border-[color:var(--muted)] transition text-left"
    >
      <UserRound
        size={14}
        className={me ? "text-[color:var(--calm)]" : "text-[color:var(--warm)]"}
      />
      <span className="flex-1">{normalizeOwner(tarefa.owner)}</span>
      <span className="text-[11px] text-[color:var(--muted)]">trocar</span>
    </button>
  );
}

export function TaskExpandFields({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();

  const [descricao, setDescricao] = useState(tarefa.descricao ?? "");
  const [inicio, setInicio] = useState(toDateInput(tarefa.inicio));
  const [noPlano, setNoPlano] = useState<boolean>(!!tarefa.no_plano);
  const [pessoas, setPessoas] = useState<TarefaPessoa[]>(
    (tarefa.pessoas ?? []).map((p) => ({ id: p.id, nome: p.nome, principal: p.principal })),
  );
  const [novaPessoa, setNovaPessoa] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveDescricao = () => {
    if ((descricao.trim() || null) !== (tarefa.descricao ?? null))
      mut.patch(tarefa.id, { descricao: descricao.trim() || null });
  };

  const savePessoas = (next: TarefaPessoa[]) => {
    const old = pessoas;
    setPessoas(next);
    mut.patch(tarefa.id, { pessoas: next }).then((ok) => {
      if (!ok) setPessoas(old);
    });
  };

  const addPessoa = (nome: string) => {
    const n = nome.trim();
    if (n && !pessoas.some((p) => p.nome.toLowerCase() === n.toLowerCase())) {
      savePessoas([...pessoas, { id: "", nome: n, principal: pessoas.length === 0 }]);
      setNovaPessoa("");
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Descrição">
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          onBlur={saveDescricao}
          rows={2}
          placeholder="Detalhes, contexto…"
          className="w-full px-3 py-2 rounded-lg border border-[color:var(--border)] bg-transparent text-[13px] focus:outline-none focus:border-[color:var(--muted)] resize-none"
        />
      </Field>

      <Field label="Dono da tarefa">
        <OwnerField tarefa={tarefa} />
      </Field>

      <Field label="Links e arquivos">
        <TaskAnexos tarefa={tarefa} />
      </Field>

      <Field label="Pessoas envolvidas">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pessoas.map((p, i) => (
            <span
              key={p.id || `${p.nome}-${i}`}
              className="inline-flex items-center gap-1 text-[12px] pl-1 pr-1.5 py-0.5 rounded-full border border-[color:var(--border)]"
            >
              <button
                type="button"
                title={p.principal ? "Principal (agrupa por esta)" : "Marcar como principal"}
                onClick={() =>
                  savePessoas(pessoas.map((x, j) => ({ ...x, principal: j === i })))
                }
                className={cn(
                  "leading-none",
                  p.principal ? "text-[color:var(--warm)]" : "text-[color:var(--muted)]",
                )}
              >
                {p.principal ? "★" : "☆"}
              </button>
              {p.nome}
              <button
                type="button"
                onClick={() => savePessoas(pessoas.filter((_, j) => j !== i))}
                className="text-[color:var(--muted)] hover:text-[color:var(--urgent)] leading-none"
                aria-label={`Remover ${p.nome}`}
              >
                ×
              </button>
            </span>
          ))}
          {pessoas.length === 0 && (
            <span className="text-[11px] text-[color:var(--muted)]">
              nenhuma — agrupa em “Você”
            </span>
          )}
        </div>
        <input
          type="text"
          value={novaPessoa}
          onChange={(e) => setNovaPessoa(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPessoa(novaPessoa);
            }
          }}
          placeholder="adicionar pessoa + Enter"
          className="w-full px-3 py-2 rounded-lg border border-[color:var(--border)] bg-transparent text-[13px] focus:outline-none focus:border-[color:var(--muted)]"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Início (desenha a barra no Plano)">
          <input
            type="date"
            value={inicio}
            onChange={(e) => {
              const v = e.target.value;
              setInicio(v);
              mut.patch(tarefa.id, { inicio: dateInputToIsoStart(v) });
            }}
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--border)] bg-transparent text-[13px] focus:outline-none focus:border-[color:var(--muted)]"
          />
        </Field>
        {/* "No plano de ação" mexe no /plano PRIVADO do dono — o convidado não
            controla isso (o endpoint do guest rejeita no_plano). Só o dono vê. */}
        {mut.scope === "owner" && (
          <label className="flex items-center gap-2.5 text-[13px] cursor-pointer select-none rounded-lg border border-[color:var(--border)] px-3 self-end h-[38px]">
            <input
              type="checkbox"
              checked={noPlano}
              onChange={(e) => {
                setNoPlano(e.target.checked);
                mut.patch(tarefa.id, { no_plano: e.target.checked });
              }}
              className="accent-[color:var(--calm)]"
            />
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={13} className="text-[color:var(--muted)]" />
              No plano de ação
            </span>
          </label>
        )}
      </div>

      <Field label="Status">
        <div className="flex flex-wrap gap-1.5">
          {STATUS.map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => mut.patch(tarefa.id, { status: s.v })}
              className={cn(
                "text-[12px] px-3 py-1.5 rounded-full border transition",
                tarefa.status === s.v
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
                  : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      {tarefa.prazo_text && (
        <p className="text-[11px] text-[color:var(--muted)]">
          Prazo dito na captura: &ldquo;{tarefa.prazo_text}&rdquo;
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          mut.remove(tarefa.id);
        }}
        onBlur={() => setConfirmDelete(false)}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition",
          confirmDelete
            ? "bg-[color:var(--urgent)] text-white border-[color:var(--urgent)] font-semibold"
            : "border-[color:var(--border)] text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10",
        )}
      >
        <Trash2 size={14} />
        {confirmDelete
          ? "Clique de novo pra confirmar"
          : mut.scope === "guest"
          ? "Remover do quadro"
          : "Deletar tarefa"}
      </button>
    </div>
  );
}

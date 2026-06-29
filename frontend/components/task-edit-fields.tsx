"use client";

import { useEffect, useState } from "react";
import { Calendar, Trash2 } from "lucide-react";
import { cn, type Prioridade } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa, Acao, TarefaPessoa } from "@/lib/queries";

type Props = {
  tarefa: Tarefa;
};

const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];
const STATUSES: Tarefa["status"][] = [
  "aberta",
  "em_andamento",
  "concluida",
  "cancelada",
];
const ACOES: { value: Acao; label: string; hint: string }[] = [
  { value: "executar", label: "executar", hint: "eu faço o trabalho" },
  { value: "cobrar", label: "cobrar", hint: "outro faz, eu cobro / acompanho" },
  {
    value: "aguardar",
    label: "aguardar",
    hint: "outro faz, não preciso cobrar",
  },
];

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, 23, 59, 0, 0);
  return date.toISOString();
}

function dateInputToIsoStart(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function nextWeekday(targetDay: number): Date {
  const d = new Date();
  const cur = d.getDay();
  const delta = (targetDay - cur + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function TaskEditFields({ tarefa }: Props) {
  const mut = useTaskMutations();

  const [titulo, setTitulo] = useState(tarefa.titulo);
  const [descricao, setDescricao] = useState(tarefa.descricao ?? "");
  const [owner, setOwner] = useState(tarefa.owner);
  const [acao, setAcao] = useState<Acao>(tarefa.acao);
  const [prazo, setPrazo] = useState(toDateInput(tarefa.prazo));
  const [inicio, setInicio] = useState(toDateInput(tarefa.inicio));
  const [noPlano, setNoPlano] = useState<boolean>(!!tarefa.no_plano);
  const [prazoText, setPrazoText] = useState(tarefa.prazo_text ?? "");
  const [prioridade, setPrioridade] = useState<Prioridade>(tarefa.prioridade);
  const [status, setStatus] = useState<Tarefa["status"]>(tarefa.status);
  const [frenteId, setFrenteId] = useState<string | null>(null);
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const [pessoas, setPessoas] = useState<TarefaPessoa[]>(
    (tarefa.pessoas ?? []).map((p) => ({ id: p.id, nome: p.nome, principal: p.principal })),
  );
  const [novaPessoa, setNovaPessoa] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    mut.listFrentes().then((list) => {
      setFrentes(list);
      const atual = list.find((f) => f.nome === tarefa.frente);
      if (atual) setFrenteId(atual.id);
    });
  }, [tarefa.frente, mut]);

  const handleTituloBlur = async () => {
    if (titulo.trim() && titulo !== tarefa.titulo) {
      const old = titulo;
      const ok = await mut.patch(tarefa.id, { titulo: titulo.trim() });
      if (!ok) setTitulo(old);
    }
  };

  const handleDescricaoBlur = async () => {
    if (descricao !== tarefa.descricao) {
      const old = descricao;
      const ok = await mut.patch(tarefa.id, {
        descricao: descricao.trim() || null,
      });
      if (!ok) setDescricao(old);
    }
  };

  const handleAcaoChange = async (newAcao: Acao) => {
    const old = acao;
    setAcao(newAcao);
    const ok = await mut.patch(tarefa.id, { acao: newAcao });
    if (!ok) setAcao(old);
  };

  const handleOwnerChange = async (newOwner: string) => {
    const old = owner;
    setOwner(newOwner);
    if (newOwner !== tarefa.owner) {
      const ok = await mut.patch(tarefa.id, { owner: newOwner.trim() || "vitor" });
      if (!ok) setOwner(old);
    }
  };

  const handlePriorityChange = async (newPriority: Prioridade) => {
    const old = prioridade;
    setPrioridade(newPriority);
    const ok = await mut.patch(tarefa.id, { prioridade: newPriority });
    if (!ok) setPrioridade(old);
  };

  const handleStatusChange = async (newStatus: Tarefa["status"]) => {
    const old = status;
    setStatus(newStatus);
    const ok = await mut.patch(tarefa.id, { status: newStatus });
    if (!ok) setStatus(old);
  };

  const handlePrazoChange = async (newPrazo: string) => {
    const old = prazo;
    setPrazo(newPrazo);
    if (newPrazo !== toDateInput(tarefa.prazo)) {
      const ok = await mut.patch(tarefa.id, { prazo: dateInputToIso(newPrazo) });
      if (!ok) setPrazo(old);
    }
  };

  const handleInicioChange = async (newInicio: string) => {
    const old = inicio;
    setInicio(newInicio);
    if (newInicio !== toDateInput(tarefa.inicio)) {
      const ok = await mut.patch(tarefa.id, { inicio: dateInputToIsoStart(newInicio) });
      if (!ok) setInicio(old);
    }
  };

  const handleQuickPrazo = async (
    when: "hoje" | "amanha" | "sexta" | "proxsemana",
  ) => {
    let date: Date;
    if (when === "hoje") {
      date = new Date();
    } else if (when === "amanha") {
      date = new Date();
      date.setDate(date.getDate() + 1);
    } else if (when === "sexta") {
      date = nextWeekday(5);
    } else {
      date = nextWeekday(1);
    }
    const newPrazo = toDateInput(date.toISOString());
    const old = prazo;
    setPrazo(newPrazo);
    const ok = await mut.patch(tarefa.id, { prazo: dateInputToIso(newPrazo) });
    if (!ok) setPrazo(old);
  };

  const handleNoPlanoChange = async (checked: boolean) => {
    const old = noPlano;
    setNoPlano(checked);
    const ok = await mut.patch(tarefa.id, { no_plano: checked });
    if (!ok) setNoPlano(old);
  };

  const handleFrente = async (newFrenteId: string | null) => {
    const old = frenteId;
    setFrenteId(newFrenteId);
    const ok = await mut.patch(tarefa.id, { frente_id: newFrenteId });
    if (!ok) setFrenteId(old);
  };

  const handleAddPessoa = async (nome: string) => {
    if (
      nome.trim() &&
      !pessoas.some((p) => p.nome.toLowerCase() === nome.toLowerCase())
    ) {
      const newPessoas = [
        ...pessoas,
        { nome, principal: pessoas.length === 0, id: "" },
      ];
      const old = pessoas;
      setPessoas(newPessoas);
      const ok = await mut.patch(tarefa.id, { pessoas: newPessoas });
      if (!ok) setPessoas(old);
      else setNovaPessoa("");
    }
  };

  const handleRemovePessoa = async (index: number) => {
    const newPessoas = pessoas.filter((_, i) => i !== index);
    const old = pessoas;
    setPessoas(newPessoas);
    const ok = await mut.patch(tarefa.id, { pessoas: newPessoas });
    if (!ok) setPessoas(old);
  };

  const handlePrincipalPessoa = async (index: number) => {
    const newPessoas = pessoas.map((p, i) => ({
      ...p,
      principal: i === index,
    }));
    const old = pessoas;
    setPessoas(newPessoas);
    const ok = await mut.patch(tarefa.id, { pessoas: newPessoas });
    if (!ok) setPessoas(old);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await mut.remove(tarefa.id, { motivo: "deletada pelo usuário" });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Título
        </label>
        <input
          type="text"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={handleTituloBlur}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Descrição
        </label>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          onBlur={handleDescricaoBlur}
          rows={3}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-none"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Ação
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ACOES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => handleAcaoChange(a.value)}
              title={a.hint}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition",
                acao === a.value
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-semibold"
                  : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[color:var(--muted)] mt-1.5">
          {ACOES.find((a) => a.value === acao)?.hint}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
            Responsável
          </label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={() => handleOwnerChange(owner)}
            placeholder="vitor"
            className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
            Prioridade
          </label>
          <select
            value={prioridade}
            onChange={(e) => handlePriorityChange(e.target.value as Prioridade)}
            className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          <Calendar size={12} className="inline mr-1 -mt-0.5" />
          Início
          <span className="font-normal text-[color:var(--muted)]">
            {" "}
            — opcional, desenha a barra no Plano
          </span>
        </label>
        <input
          type="date"
          value={inicio}
          onChange={(e) => handleInicioChange(e.target.value)}
          max={prazo || undefined}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          <Calendar size={12} className="inline mr-1 -mt-0.5" />
          Prazo
        </label>
        <input
          type="date"
          value={prazo}
          onChange={(e) => handlePrazoChange(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[
            { k: "hoje", label: "Hoje" },
            { k: "amanha", label: "Amanhã" },
            { k: "sexta", label: "Sexta" },
            { k: "proxsemana", label: "Próx semana" },
          ].map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() =>
                handleQuickPrazo(
                  opt.k as "hoje" | "amanha" | "sexta" | "proxsemana",
                )
              }
              className="text-xs px-2 py-1 rounded border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition"
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handlePrazoChange("")}
            className="text-xs px-2 py-1 rounded border border-dashed border-[color:var(--border)] hover:bg-[color:var(--accent)] transition text-[color:var(--muted)]"
          >
            limpar
          </button>
        </div>
        {tarefa.prazo_text && (
          <p className="text-[11px] text-[color:var(--muted)] mt-1">
            Texto original do prazo: &ldquo;{tarefa.prazo_text}&rdquo;
          </p>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none rounded-lg border border-[color:var(--border)] px-3 py-2.5">
        <input
          type="checkbox"
          checked={noPlano}
          onChange={(e) => handleNoPlanoChange(e.target.checked)}
          className="mt-0.5 accent-[color:var(--calm)]"
        />
        <span>
          <span className="font-medium">No plano de ação</span>
          <span className="block text-[11px] text-[color:var(--muted)]">
            mostra esta tarefa na linha do tempo (/plano)
          </span>
        </span>
      </label>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Área
        </label>
        <select
          value={frenteId ?? ""}
          onChange={(e) => handleFrente(e.target.value || null)}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        >
          <option value="">— sem área —</option>
          {frentes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Pessoas envolvidas
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pessoas.map((p, i) => (
            <span
              key={p.id || `${p.nome}-${i}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[color:var(--border)]"
            >
              <button
                type="button"
                title={
                  p.principal
                    ? "Principal (agrupa por esta)"
                    : "Marcar como principal"
                }
                onClick={() => handlePrincipalPessoa(i)}
                className={cn(
                  p.principal
                    ? "text-[color:var(--warm)]"
                    : "text-[color:var(--muted)]",
                )}
              >
                {p.principal ? "★" : "☆"}
              </button>
              {p.nome}
              <button
                type="button"
                onClick={() => handleRemovePessoa(i)}
                className="text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
              >
                ×
              </button>
            </span>
          ))}
          {pessoas.length === 0 && (
            <span className="text-[11px] text-[color:var(--muted)]">
              nenhuma — agrupa em &ldquo;Você&rdquo;
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
              handleAddPessoa(novaPessoa);
            }
          }}
          placeholder="adicionar pessoa + Enter"
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
          Status
        </label>
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value as Tarefa["status"])}
          className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-2 rounded border transition",
          confirmDelete
            ? "bg-[color:var(--urgent)] text-white border-[color:var(--urgent)] font-semibold"
            : "border-[color:var(--border)] text-[color:var(--urgent)] hover:bg-[color:var(--urgent-bg)]",
        )}
      >
        <Trash2 size={14} />
        {confirmDelete ? "Clique novamente para deletar" : "Deletar tarefa"}
      </button>
    </div>
  );
}

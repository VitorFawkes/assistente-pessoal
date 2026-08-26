"use client";

// A linha da tarefa DENTRO de um quadro. Mesmo DOM em Lista, Colunas e Tabela
// — quem muda a forma é o CSS (.q-tarefa em globals.css), como no rascunho.
//
// Fechada, a linha mostra exatamente as 6 informações combinadas com o Vitor:
// o quê · dono · vence em · situação · resumo · tema. O resto (relacionadas,
// começa em, depende de, veio de, arquivos, trecho) só aparece ao abrir.
//
// Regras de cor: a borda esquerda é o farol do prazo; a cor da pessoa vive só
// no avatar.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { areaLabel, cn, formatCreatedAt } from "@/lib/utils";
import { meetingDateShort, meetingSubject } from "@/lib/meeting-label";
import { useTaskMutations } from "@/lib/task-mutations";
import {
  SITUACOES,
  corDaPessoa,
  donoDe,
  faixaDoPrazo,
  iniciais,
  relacionadasDe,
  rotuloEntrouAqui,
  rotuloPrazo,
} from "@/lib/quadro-v2";
import { TaskAnexos } from "./task-anexos";
import type { Tarefa } from "@/lib/queries";

// ── pedacinhos de edição no lugar ──────────────────────────────────────

function TextoVivo({
  valor,
  onSalvar,
  placeholder,
  className,
  multilinha = false,
}: {
  valor: string;
  onSalvar: (novo: string) => void;
  placeholder?: string;
  className?: string;
  multilinha?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);
  const ref = useRef<HTMLTextAreaElement>(null);

  // O texto do rascunho nasce do valor salvo no instante em que se clica —
  // sem efeito sincronizando estado com prop.
  function abrir() {
    setTexto(valor);
    setEditando(true);
  }

  useEffect(() => {
    if (editando) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editando]);

  function salvar() {
    setEditando(false);
    const v = texto.trim();
    if (v !== valor) onSalvar(v);
  }

  if (editando) {
    return (
      <textarea
        ref={ref}
        rows={multilinha ? 2 : 1}
        value={texto}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            salvar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setTexto(valor);
            setEditando(false);
          }
        }}
        className={cn(
          "w-full resize-none bg-[color:var(--card)] rounded px-1 -mx-1 outline-none",
          "ring-2 ring-[color:var(--foreground)]/25",
          className,
        )}
      />
    );
  }

  return (
    <span
      role="textbox"
      tabIndex={0}
      title="Clique e escreva"
      onClick={(e) => {
        e.stopPropagation();
        abrir();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          abrir();
        }
      }}
      className={cn(
        "block cursor-text rounded px-1 -mx-1 hover:bg-[color:var(--accent)] transition",
        !valor && "text-[color:var(--muted)] italic",
        className,
      )}
    >
      {valor || placeholder}
    </span>
  );
}

/** Dono: avatar com as iniciais (única cor por pessoa) + nome que troca.
 *  A lista é a das pessoas DESTE quadro — a agenda inteira de pessoas do app
 *  tem centenas de nomes e não cabe num seletor de linha. Pra chamar alguém de
 *  fora, "outra pessoa…" abre um campo de escrever. */
function DonoVivo({ tarefa, pessoasDoQuadro }: { tarefa: Tarefa; pessoasDoQuadro: string[] }) {
  const mut = useTaskMutations();
  const [escrevendo, setEscrevendo] = useState(false);
  const dono = donoDe(tarefa);
  const outras = relacionadasDe(tarefa);

  // O dono do quadro é a pessoa PRINCIPAL da tarefa — a mesma que manda no
  // "Ver por: Pessoa". `owner` anda junto pra não brigar com o resto do app.
  function trocar(nome: string) {
    const novo = nome.trim() === "__sem__" ? "" : nome.trim();
    if ((dono ?? "") === novo) return;
    const lista = [
      ...(novo ? [{ nome: novo, principal: true }] : []),
      ...tarefa.pessoas
        .filter((p) => !p.principal && p.nome !== novo)
        .map((p) => ({ nome: p.nome })),
    ];
    mut.patch(
      tarefa.id,
      { pessoas: lista, owner: novo || "vitor", acao: novo ? "cobrar" : "executar" },
      { silent: true },
    );
  }

  const nomes = [...new Set([...(dono ? [dono] : []), ...pessoasDoQuadro])];

  return (
    <span className="flex items-center gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
      <span className={cn("q-ini", corDaPessoa(dono))} aria-hidden>
        {dono ? iniciais(dono) : "—"}
      </span>
      {escrevendo ? (
        <input
          autoFocus
          defaultValue={dono ?? ""}
          placeholder="nome de quem faz"
          aria-label="dono da tarefa"
          onBlur={(e) => {
            setEscrevendo(false);
            trocar(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEscrevendo(false);
          }}
          className="w-[120px] rounded-md border border-[color:var(--muted-strong)] bg-[color:var(--card)] px-1.5 py-0.5 text-[12.5px] outline-none"
        />
      ) : (
      <select
        value={dono ?? "__sem__"}
        onChange={(e) => {
          if (e.target.value === "__outra__") { setEscrevendo(true); return; }
          trocar(e.target.value);
        }}
        aria-label="dono da tarefa"
        title="Trocar o dono"
        className="min-w-0 max-w-[120px] truncate bg-transparent border border-transparent rounded-md px-1 py-0.5 text-[12.5px] font-medium text-[color:var(--muted-strong)] cursor-pointer hover:border-[color:var(--border)] focus:border-[color:var(--muted-strong)] outline-none appearance-none"
      >
        <option value="__sem__">sem dono</option>
        {nomes.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value="__outra__">outra pessoa…</option>
      </select>
      )}
      {outras.length > 0 && (
        <span
          title={`Também nesta tarefa: ${outras.join(", ")}`}
          className="shrink-0 text-[11.5px] font-bold text-[color:var(--muted)] bg-[color:var(--accent)] rounded-full px-1.5"
        >
          +{outras.length}
        </span>
      )}
    </span>
  );
}

const CORES_SELO: Record<string, string> = {
  vencida: "bg-[color:var(--urgent-bg)] text-[color:var(--urgent)]",
  hoje: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]",
  semana: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]",
  depois: "bg-[color:var(--accent)] text-[color:var(--muted-strong)]",
  semprazo: "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]",
  feito: "bg-[color:var(--done-bg)] text-[color:var(--done)]",
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fimDoDia(valor: string): string | null {
  if (!valor) return null;
  const [y, m, d] = valor.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 0, 0).toISOString();
}
function inicioDoDia(valor: string): string | null {
  if (!valor) return null;
  const [y, m, d] = valor.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** Prazo: o selo vira campo de data com um clique. */
function PrazoVivo({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [abrindo, setAbrindo] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const faixa = faixaDoPrazo(tarefa);

  useEffect(() => {
    if (!abrindo) return;
    ref.current?.focus();
    try {
      ref.current?.showPicker?.();
    } catch {
      /* navegador sem showPicker — o campo abre no clique mesmo */
    }
  }, [abrindo]);

  if (abrindo) {
    return (
      <input
        ref={ref}
        type="date"
        defaultValue={toDateInput(tarefa.prazo)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          mut.patch(tarefa.id, { prazo: fimDoDia(e.target.value), prazo_text: null }, { silent: true });
          setAbrindo(false);
        }}
        onBlur={() => setAbrindo(false)}
        className="rounded-full border border-[color:var(--muted-strong)] bg-[color:var(--card)] px-2 py-0.5 text-[12px] font-medium"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setAbrindo(true);
      }}
      title="Clique pra mudar a data"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap transition hover:ring-1 hover:ring-current",
        CORES_SELO[tarefa.status === "concluida" ? "feito" : faixa],
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />
      {rotuloPrazo(tarefa)}
    </button>
  );
}

const CORES_ETAPA: Record<string, string> = {
  aberta: "bg-[color:var(--accent)] text-[color:var(--muted-strong)]",
  em_andamento: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]",
  aguardando_aprovacao:
    "bg-[color:var(--calm-bg)] text-[color:var(--calm)] border border-dashed border-current",
  concluida: "bg-[color:var(--done-bg)] text-[color:var(--done)]",
  cancelada: "bg-[color:var(--accent)] text-[color:var(--muted)]",
};

/** Situação: as 4 etapas, num seletor que parece etiqueta. */
function EtapaViva({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  return (
    <select
      value={tarefa.status === "cancelada" ? "aberta" : tarefa.status}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        mut.patch(tarefa.id, { status: e.target.value as Tarefa["status"] }, { silent: true })
      }
      aria-label="situação da tarefa"
      className={cn(
        "w-full max-w-full truncate rounded-md px-2 py-0.5 text-[12px] font-medium cursor-pointer appearance-none outline-none border border-transparent hover:border-current transition",
        CORES_ETAPA[tarefa.status],
      )}
    >
      {SITUACOES.map((s) => (
        <option key={s.valor} value={s.valor}>
          {s.rotulo}
        </option>
      ))}
    </select>
  );
}

/** Tema aberto: escreveu um que não existe, ele passa a existir. */
function TemaVivo({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const atual = tarefa.frente ?? "";
  const listaId = `temas-${tarefa.id}`;
  // Sem tema definido, mostra o que a IA propôs com "?" — some no instante em
  // que alguém escreve o tema de verdade.
  const sugestao =
    !tarefa.frente && tarefa.frente_proposta ? `${areaLabel(tarefa.frente_proposta)}?` : "sem tema";

  async function carregar() {
    if (frentes.length) return;
    setFrentes(await mut.listFrentes());
  }

  async function salvar(valor: string) {
    const nome = valor.trim();
    if (nome === atual) return;
    if (!nome) {
      mut.patch(tarefa.id, { frente_id: null }, { silent: true });
      return;
    }
    const lista = frentes.length ? frentes : await mut.listFrentes();
    const achou = lista.find((f) => f.nome.toLowerCase() === nome.toLowerCase());
    if (achou) {
      mut.patch(tarefa.id, { frente_id: achou.id }, { silent: true });
      return;
    }
    const criada = await mut.createFrente?.(nome);
    if (criada) {
      setFrentes((antes) => [...antes, criada]);
      mut.patch(tarefa.id, { frente_id: criada.id }, { silent: true });
    }
  }

  return (
    <>
      <input
        list={listaId}
        defaultValue={atual}
        key={atual}
        placeholder={sugestao}
        aria-label="tema"
        onClick={(e) => e.stopPropagation()}
        onFocus={carregar}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => salvar(e.target.value)}
        className="w-full max-w-[132px] rounded-md border border-dashed border-[color:var(--border)] bg-transparent px-2 py-0.5 text-[12px] font-medium text-[color:var(--muted-strong)] cursor-pointer hover:bg-[color:var(--card)] focus:border-solid focus:border-[color:var(--muted-strong)] outline-none"
      />
      <datalist id={listaId}>
        {frentes.map((f) => (
          <option key={f.id} value={f.nome} />
        ))}
      </datalist>
    </>
  );
}

/** A bolinha: mostra a situação e conclui/reabre sem abrir a tarefa. */
function BolinhaSituacao({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const feito = tarefa.status === "concluida";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        mut.patch(tarefa.id, { status: feito ? "aberta" : "concluida" }, { silent: true });
      }}
      aria-label={feito ? "reabrir tarefa" : "marcar como feita"}
      title={feito ? "reabrir" : "marcar como feita"}
      className={cn(
        "w-4 h-4 rounded-full border-2 shrink-0 transition",
        feito
          ? "border-[color:var(--done)] bg-[color:var(--done)]"
          : tarefa.status === "em_andamento"
          ? "border-[color:var(--warm)] bg-gradient-to-r from-[color:var(--warm)] from-50% to-transparent to-50%"
          : tarefa.status === "aguardando_aprovacao"
          ? "border-[color:var(--calm)] bg-[color:var(--calm)]/40"
          : "border-[color:var(--border)] hover:border-[color:var(--done)]",
      )}
    />
  );
}

// ── a linha inteira ────────────────────────────────────────────────────

export function QuadroTarefa({
  tarefa,
  /** Nomes que já estão neste quadro — a lista do seletor de dono. */
  pessoasDoQuadro,
  /** Só o dono "tira do quadro" (desvincula sem apagar). */
  onTirarDoQuadro,
}: {
  tarefa: Tarefa;
  pessoasDoQuadro: string[];
  onTirarDoQuadro?: () => void;
}) {
  const mut = useTaskMutations();
  const [aberta, setAberta] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [novaPessoa, setNovaPessoa] = useState("");
  const feito = tarefa.status === "concluida";
  const faixa = faixaDoPrazo(tarefa);
  const farol = feito ? "feito" : faixa;
  const entrouAqui = rotuloEntrouAqui(tarefa);

  useEffect(() => {
    if (!confirmando) return;
    const t = setTimeout(() => setConfirmando(false), 3500);
    return () => clearTimeout(t);
  }, [confirmando]);

  const relacionadas = relacionadasDe(tarefa);

  const salvarPessoas = (lista: { nome: string; principal?: boolean }[]) =>
    mut.patch(tarefa.id, { pessoas: lista }, { silent: true });

  return (
    <article
      onClick={() => setAberta((v) => !v)}
      className={cn(
        "q-tarefa group relative paper-card rounded-xl border px-3.5 py-2.5 cursor-pointer transition",
        "border-[color:var(--border)] hover:border-[color:var(--muted)]",
        `q-farol-${farol}`,
        feito && "opacity-70",
        aberta && "ring-1 ring-[color:var(--foreground)]/15",
      )}
    >
      <button
        type="button"
        className="q-pun text-[color:var(--muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition cursor-grab active:cursor-grabbing text-[13px] leading-none"
        title="arrastar"
        aria-label="arrastar"
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </button>

      <span className="q-st flex items-center">
        <BolinhaSituacao tarefa={tarefa} />
      </span>

      <div className="q-tit flex items-center gap-2 flex-wrap">
        <TextoVivo
          valor={tarefa.titulo}
          onSalvar={(v) => v && mut.patch(tarefa.id, { titulo: v }, { silent: true })}
          className={cn(
            "q-titulo text-[14px] font-semibold text-[color:var(--foreground)]",
            feito && "line-through text-[color:var(--muted)]",
          )}
        />
        {(tarefa.anexos?.length ?? 0) > 0 && (
          <span
            className="shrink-0 text-[11.5px] font-semibold text-[color:var(--muted)]"
            title={`${tarefa.anexos.length} arquivo(s)`}
          >
            📎 {tarefa.anexos.length}
          </span>
        )}
      </div>

      <div className="q-quem">
        <DonoVivo tarefa={tarefa} pessoasDoQuadro={pessoasDoQuadro} />
      </div>

      <div className="q-prazo">
        <PrazoVivo tarefa={tarefa} />
      </div>

      <div className="q-etapa">
        <EtapaViva tarefa={tarefa} />
      </div>

      <span className="q-acoes flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirmando) {
              setConfirmando(true);
              return;
            }
            mut.remove(tarefa.id);
          }}
          title="excluir esta tarefa"
          aria-label="excluir"
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[13px] leading-none transition",
            confirmando
              ? "bg-[color:var(--urgent)] text-white text-[11px] font-bold px-2 py-1"
              : "text-[color:var(--muted)] hover:text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10",
          )}
        >
          {confirmando ? "excluir mesmo?" : "🗑"}
        </button>
        <span
          className={cn(
            "q-seta text-[color:var(--muted)] text-[15px] leading-none transition",
            aberta && "rotate-90 inline-block",
          )}
          aria-hidden
        >
          ›
        </span>
      </span>

      {entrouAqui && (
        <span
          className="q-aqui text-[11px] text-[color:var(--muted)]"
          title="Desde quando esta tarefa está nesta coluna"
        >
          nesta coluna: {entrouAqui}
        </span>
      )}

      <div className="q-sub flex items-center gap-2.5 text-[12.5px] text-[color:var(--muted-strong)]">
        <span className="q-resumo q-resumo-1linha flex-1">
          <TextoVivo
            multilinha
            valor={tarefa.descricao ?? ""}
            placeholder="sem resumo"
            onSalvar={(v) => mut.patch(tarefa.id, { descricao: v || null }, { silent: true })}
            className="text-[12.5px]"
          />
        </span>
        <span className="q-tema">
          <TemaVivo tarefa={tarefa} />
        </span>
      </div>

      {aberta && (
        <div
          className="q-det mt-2.5 pt-2.5 border-t border-dashed border-[color:var(--border)] animate-[expandIn_160ms_ease-out]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-[12.5px]">
            <span className="flex items-center gap-2 flex-wrap">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Relacionadas
              </b>
              {relacionadas.length === 0 && (
                <span className="text-[color:var(--muted)]">ninguém ainda</span>
              )}
              {relacionadas.map((n) => (
                <span
                  key={n}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full pl-0.5 pr-2 py-0.5 font-medium",
                    corDaPessoa(n),
                  )}
                  style={{ background: "var(--p-bg)", color: "var(--p-fg)" }}
                >
                  <span className="q-ini" style={{ background: "rgba(255,255,255,.6)" }}>
                    {iniciais(n)}
                  </span>
                  {n}
                  <button
                    type="button"
                    aria-label={`tirar ${n}`}
                    onClick={() =>
                      salvarPessoas(
                        tarefa.pessoas
                          .filter((p) => p.nome !== n)
                          .map((p) => ({ nome: p.nome, principal: p.principal })),
                      )
                    }
                    className="opacity-60 hover:opacity-100 text-[11px]"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                value={novaPessoa}
                onChange={(e) => setNovaPessoa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const nome = novaPessoa.trim();
                  if (!nome || tarefa.pessoas.some((p) => p.nome === nome)) return;
                  setNovaPessoa("");
                  salvarPessoas([
                    ...tarefa.pessoas.map((p) => ({ nome: p.nome, principal: p.principal })),
                    { nome },
                  ]);
                }}
                placeholder="+ juntar"
                className="w-24 bg-transparent border-b border-dashed border-[color:var(--border)] text-[12.5px] outline-none focus:border-[color:var(--muted-strong)]"
              />
            </span>

            <span className="flex items-center gap-2">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Começa em
              </b>
              <input
                type="date"
                defaultValue={toDateInput(tarefa.inicio)}
                onChange={(e) =>
                  mut.patch(tarefa.id, { inicio: inicioDoDia(e.target.value) }, { silent: true })
                }
                className="rounded-md border border-[color:var(--border)] bg-transparent px-2 py-0.5 text-[12.5px]"
              />
            </span>

            <span className="flex items-center gap-2">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Depende de
              </b>
              <input
                defaultValue={tarefa.depende_de ?? ""}
                placeholder="nada"
                onBlur={(e) =>
                  mut.patch(tarefa.id, { depende_de: e.target.value.trim() || null }, { silent: true })
                }
                className="min-w-[140px] rounded-md border border-[color:var(--border)] bg-transparent px-2 py-0.5 text-[12.5px]"
              />
            </span>

            <span className="flex items-center gap-2">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Nesta situação desde
              </b>
              <span className="text-[color:var(--muted-strong)]">
                {entrouAqui ?? (
                  <span className="text-[color:var(--muted)]">
                    não sei (nunca mudou de situação por aqui)
                  </span>
                )}
              </span>
            </span>

            <span className="flex items-center gap-2">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Criada em
              </b>
              <span className="text-[color:var(--muted-strong)]">
                {formatCreatedAt(tarefa.created_at) || "—"}
              </span>
            </span>

            <span className="flex items-center gap-2">
              <b className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Veio de
              </b>
              {tarefa.meeting_id ? (
                <Link
                  href={`/reunioes/${tarefa.meeting_id}`}
                  className="underline underline-offset-2 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]"
                >
                  {meetingDateShort(tarefa.meeting_recorded_at)}{" "}
                  {meetingSubject(tarefa.meeting_summary) || "reunião"}
                </Link>
              ) : (
                <span className="text-[color:var(--muted)]">criada na mão</span>
              )}
            </span>

            <span className="w-full">
              <b className="block mb-1.5 text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                Arquivos e links
              </b>
              <TaskAnexos tarefa={tarefa} />
            </span>

            {tarefa.evidencia && (
              <span className="w-full">
                <b className="block mb-1 text-[10.5px] uppercase tracking-wide text-[color:var(--muted)]">
                  Trecho da reunião
                </b>
                <p className="italic text-[color:var(--muted)] border-l-2 border-[color:var(--border)] pl-3">
                  &ldquo;{tarefa.evidencia}&rdquo;
                </p>
              </span>
            )}
          </div>

          {onTirarDoQuadro && (
            <div className="mt-3 pt-2.5 border-t border-dashed border-[color:var(--border)]">
              <button
                type="button"
                onClick={onTirarDoQuadro}
                className="text-[12px] text-[color:var(--muted-strong)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
              >
                Tirar do quadro (a tarefa continua existindo)
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

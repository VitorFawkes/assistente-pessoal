"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import { Mic, CornerDownLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { QuandoChip } from "./task-chips/quando-chip";
import { PraQuemChip, type PraQuem } from "./task-chips/pra-quem-chip";
import { PrioridadeChip } from "./task-chips/prioridade-chip";
import { AreaChip } from "./task-chips/area-chip";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa } from "@/lib/queries";
import type { Prioridade } from "@/lib/utils";

export function CaptureComposer({ onOpenFull }: { onOpenFull: () => void }) {
  const mut = useTaskMutations();
  const [isPending, startTransition] = useTransition();
  const [texto, setTexto] = useState("");
  const [criada, setCriada] = useState<Tarefa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [gravando, setGravando] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // atalho in-app: tecla "c" foca o campo (quando nada focado)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (e.key === "c" && tag !== "input" && tag !== "textarea") { e.preventDefault(); inputRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isGuest = mut.scope === "guest";

  function capturar() {
    const t = texto.trim();
    if (!t) { setErro("escreve algo primeiro"); return; }
    setErro(null);
    startTransition(async () => {
      try {
        // Convidado: cria direto (o parser /api/capturar é autenticado e não é
        // público — bater nele daria 405 atrás do proxy). Texto = título.
        if (isGuest) {
          const tarefa = await mut.create({ titulo: t });
          if (tarefa) setTexto("");
          return;
        }
        // Dono: parseia via /api/capturar + cria via mut, e abre os chips.
        const r = await fetch("/api/capturar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: t }),
        });
        if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? `erro ${r.status}`); return; }
        const parsed = (await r.json()) as Record<string, unknown>;
        // Chamar create com os dados parseados
        const tarefa = await mut.create(parsed as Parameters<typeof mut.create>[0]);
        if (tarefa) {
          setCriada(tarefa);
          setTexto("");
        }
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    });
  }

  // PATCH otimista de um campo da tarefa recém-criada
  function patch(body: Record<string, unknown>) {
    if (!criada) return;
    setCriada({ ...criada, ...body } as Tarefa);
    fetch(`/api/tarefas/${criada.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(() => mut.refresh()).catch((err) => {
        toast.error(`Erro ao atualizar: ${err instanceof Error ? err.message : "desconhecido"}`);
      });
  }

  async function toggleVoz() {
    if (gravando) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        enviarAudio(blob);
        setGravando(false);
      };
      recRef.current = rec; rec.start(); setGravando(true);
    } catch { setErro("microfone bloqueado neste navegador"); }
  }

  function enviarAudio(blob: Blob) {
    startTransition(async () => {
      try {
        const form = new FormData();
        form.append("audio", blob, "captura.webm");
        const r = await fetch("/api/capturar", { method: "POST", body: form });
        if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? `erro ${r.status}`); return; }
        const parsed = (await r.json()) as Record<string, unknown>;
        const tarefa = await mut.create(parsed as Parameters<typeof mut.create>[0]);
        if (tarefa) setCriada(tarefa);
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    });
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input ref={inputRef} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="O que precisa ser feito? (escreve e Enter)"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); capturar(); } }}
          className="flex-1 px-2 py-1.5 bg-transparent text-sm focus:outline-none" />
        {!isGuest && (
          <button type="button" onClick={toggleVoz} title="Capturar por voz"
            className={cn("text-[color:var(--muted)] hover:text-[color:var(--foreground)]", gravando && "text-[color:var(--urgent)] animate-pulse")}>
            <Mic size={18} />
          </button>
        )}
        <button type="button" onClick={capturar} disabled={isPending}
          className="inline-flex items-center gap-1 text-[13px] px-2.5 py-1 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50">
          <CornerDownLeft size={14} /> {isPending ? "…" : "criar"}
        </button>
        {!isGuest && (
          <button type="button" onClick={onOpenFull} title="Abrir formulário completo"
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"><Plus size={18} /></button>
        )}
      </div>

      {erro && <p className="text-xs text-[color:var(--urgent)] px-2">{erro}</p>}

      {!isGuest && criada && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1 border-t border-[color:var(--border)]">
          <span className="text-[12px] text-[color:var(--muted)]">criada:</span>
          <span className="text-[13px] font-medium">{criada.titulo}</span>
          <PraQuemChip value={{ owner: criada.owner, acao: criada.acao }}
            onChange={(v: PraQuem) => patch({ owner: v.owner, acao: v.acao })} />
          <QuandoChip value={criada.prazo} onChange={(iso) => patch({ prazo: iso, prazo_text: null })} />
          <PrioridadeChip value={criada.prioridade as Prioridade} onChange={(p) => patch({ prioridade: p })} />
          <AreaChip value={criada.frente} onChange={(f) => patch({ frente_id: f?.id ?? null, frente: f?.nome ?? null })} />
          <button type="button" onClick={() => setCriada(null)} className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] ml-auto">ok</button>
        </div>
      )}
    </div>
  );
}

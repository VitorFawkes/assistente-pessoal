"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Sparkles, Trash2, ArrowUp } from "lucide-react";
import { AgentWS, type AgentEvent } from "@/lib/agent-ws";
import { Markdown } from "@/lib/md";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  ts: number;
  error?: boolean;
};

const WS_URL = process.env.NEXT_PUBLIC_AGENT_WS_URL || "ws://127.0.0.1:8782/ws";
const WS_SECRET = process.env.NEXT_PUBLIC_AGENT_WS_SECRET || "";

const TOOL_LABEL: Record<string, string> = {
  criar_tarefa: "criou tarefa",
  editar_tarefa: "editou",
  concluir_tarefa: "concluiu",
  reabrir_tarefa: "reabriu",
  deletar_tarefa: "apagou",
  atrelar_pessoa: "atrelou pessoa",
  listar_tarefas: "leu tarefas",
  tarefas_faltando: "viu o que falta",
  listar_reunioes: "leu reuniões",
  ler_reuniao: "leu reunião",
  listar_pessoas: "leu pessoas",
  criar_pessoa: "criou pessoa",
  listar_frentes: "leu frentes",
  buscar: "buscou",
};

const SUGGESTIONS = [
  "O que falta eu fazer hoje?",
  "Quais tarefas estão atrasadas?",
  "Resuma minha última reunião e o que ficou pra mim",
  "O que estou aguardando de cada pessoa?",
];

let _seq = 0;
const newId = () => `m${Date.now()}_${_seq++}`;
const nowTs = () => Date.now() / 1000;

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel() {
  const wsRef = useRef<AgentWS | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  const patchLastAssistant = useCallback((fn: (m: Msg) => Msg) => {
    setMessages((prev) => {
      const i = [...prev].reverse().findIndex((m) => m.role === "assistant");
      if (i === -1) return prev;
      const idx = prev.length - 1 - i;
      const next = [...prev];
      next[idx] = fn(next[idx]);
      return next;
    });
  }, []);

  const onEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case "history":
          setMessages((prev) =>
            prev.length
              ? prev
              : e.messages.map((m) => ({
                  id: newId(),
                  role: m.role,
                  text: m.text || "",
                  tools: m.tools || [],
                  ts: m.ts || nowTs(),
                })),
          );
          break;
        case "message_start":
          setBusy(true);
          break;
        case "content_delta":
          patchLastAssistant((m) => ({ ...m, text: m.text + e.text }));
          break;
        case "tool_call":
          patchLastAssistant((m) => ({ ...m, tools: [...m.tools, e.tool] }));
          break;
        case "message_end":
          patchLastAssistant((m) => ({ ...m, text: (e.text || m.text || "").trim() }));
          setBusy(false);
          break;
        case "error":
          patchLastAssistant((m) => ({ ...m, text: e.text, error: true }));
          setBusy(false);
          break;
        case "cleared":
          setMessages([]);
          setBusy(false);
          break;
      }
    },
    [patchLastAssistant],
  );

  useEffect(() => {
    const ws = new AgentWS(WS_URL, WS_SECRET, { onEvent, onStatus: setOnline });
    wsRef.current = ws;
    ws.connect();
    return () => ws.close();
  }, [onEvent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || busy || !online) return;
      if (!wsRef.current?.send(t)) return;
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", text: t, tools: [], ts: nowTs() },
        { id: newId(), role: "assistant", text: "", tools: [], ts: nowTs() },
      ]);
      setInput("");
      setBusy(true);
      requestAnimationFrame(grow);
    },
    [busy, online, grow],
  );

  const clear = useCallback(() => {
    wsRef.current?.clear();
    setMessages([]);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] min-h-[440px] rounded-2xl border border-border paper-card overflow-hidden shadow-sm">
      {/* status bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border text-xs bg-background/40">
        <span className="flex items-center gap-2 text-muted-strong">
          <span
            className="w-2 h-2 rounded-full transition-colors"
            style={{ background: online ? "var(--done)" : "var(--muted)" }}
          />
          {online ? "Assistente online" : "Assistente offline — o Mac precisa estar ligado"}
        </span>
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="flex items-center gap-1 text-muted hover:text-foreground transition"
          >
            <Trash2 size={13} /> limpar
          </button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-4">
            <div className="flex flex-col items-center gap-2">
              <span
                className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: "var(--accent)" }}
              >
                <Sparkles size={20} style={{ color: "var(--warm)" }} />
              </span>
              <p className="font-display text-2xl">Seu assistente pessoal</p>
              <p className="text-sm text-muted-strong max-w-sm">
                Cria, edita, conclui e organiza suas tarefas e lê suas reuniões — é só pedir.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendText(s)}
                  disabled={!online}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-muted-strong hover:bg-accent transition press-feedback disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        {busy && <Typing />}
      </div>

      {/* input */}
      <div className="border-t border-border p-3 flex items-end gap-2 bg-background/40">
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText(input);
            }
          }}
          placeholder={online ? "Diga o que fazer…  (Enter envia, Shift+Enter quebra linha)" : "Conectando ao assistente…"}
          disabled={!online}
          className="flex-1 resize-none max-h-40 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-muted-strong disabled:opacity-60"
        />
        <button
          onClick={() => sendText(input)}
          disabled={!online || busy || !input.trim()}
          aria-label="Enviar"
          className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center press-feedback transition disabled:opacity-40"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {m.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-[88%]">
          {m.tools.map((t, i) => (
            <span
              key={i}
              className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-strong"
              style={{ background: "var(--accent)" }}
            >
              ⚙ {TOOL_LABEL[t] || t}
            </span>
          ))}
        </div>
      )}
      {(m.text || !isUser) && (
        <div
          className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm"
          style={
            isUser
              ? { background: "var(--foreground)", color: "var(--background)" }
              : m.error
              ? { background: "var(--urgent-bg)", color: "var(--urgent)", border: "1px solid var(--border)" }
              : { background: "var(--card)", border: "1px solid var(--border)" }
          }
        >
          {isUser ? (
            <span className="whitespace-pre-wrap leading-relaxed">{m.text}</span>
          ) : m.text ? (
            <Markdown text={m.text} />
          ) : (
            <span className="text-muted">…</span>
          )}
        </div>
      )}
      <span className="text-[10px] text-muted px-1">{fmtTime(m.ts)}</span>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl px-3.5 py-3 bg-card border border-border flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--muted)", animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

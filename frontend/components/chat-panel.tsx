"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AgentWS, type AgentEvent } from "@/lib/agent-ws";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  error?: boolean;
};

const WS_URL = process.env.NEXT_PUBLIC_AGENT_WS_URL || "ws://127.0.0.1:8782/ws";
const WS_SECRET = process.env.NEXT_PUBLIC_AGENT_WS_SECRET || "";

const TOOL_LABEL: Record<string, string> = {
  criar_tarefa: "criou tarefa",
  editar_tarefa: "editou tarefa",
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
};

let _seq = 0;
const newId = () => `m${Date.now()}_${_seq++}`;

export function ChatPanel() {
  const wsRef = useRef<AgentWS | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  // atualiza a última mensagem do assistente (alvo do streaming)
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
  }, [messages]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy || !online) return;
    const ok = wsRef.current?.send(text);
    if (!ok) return;
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", text, tools: [] },
      { id: newId(), role: "assistant", text: "", tools: [] },
    ]);
    setInput("");
    setBusy(true);
  }, [input, busy, online]);

  const clear = useCallback(() => {
    wsRef.current?.clear();
    setMessages([]);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] min-h-[420px] rounded-2xl border border-border paper-card overflow-hidden">
      {/* status */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border text-xs">
        <span className="flex items-center gap-2 text-muted-strong">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: online ? "var(--done)" : "var(--muted)" }}
          />
          {online ? "Assistente online" : "Assistente offline — o Mac precisa estar ligado"}
        </span>
        {messages.length > 0 && (
          <button onClick={clear} className="text-muted hover:text-foreground transition">
            limpar
          </button>
        )}
      </div>

      {/* mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-6">
            <p className="font-display text-2xl">Seu assistente pessoal</p>
            <p className="text-sm text-muted-strong max-w-sm">
              Peça em linguagem natural: “quais tarefas faltam?”, “cria uma tarefa pra falar com o
              Marcelo”, “marca a X como feita”, “resume a última reunião”.
            </p>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        {busy && <Typing />}
      </div>

      {/* input */}
      <div className="border-t border-border p-3 flex items-end gap-2">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={online ? "Diga o que fazer…" : "Conectando ao assistente…"}
          disabled={!online}
          className="flex-1 resize-none max-h-32 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-muted-strong disabled:opacity-60"
        />
        <button
          onClick={send}
          disabled={!online || busy || !input.trim()}
          className="shrink-0 h-10 px-4 rounded-xl text-sm font-medium press-feedback transition disabled:opacity-40"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {busy ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
        {m.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
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
            className="rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed"
            style={
              isUser
                ? { background: "var(--foreground)", color: "var(--background)" }
                : m.error
                ? { background: "var(--urgent-bg)", color: "var(--urgent)" }
                : { background: "var(--card)", border: "1px solid var(--border)" }
            }
          >
            {m.text || (m.tools.length > 0 ? "" : "…")}
          </div>
        )}
      </div>
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

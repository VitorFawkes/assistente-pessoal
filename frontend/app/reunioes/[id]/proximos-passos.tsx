"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check, Loader2 } from "lucide-react";

type Item = { text: string; children: Item[] };
type Status = "idle" | "loading" | "done" | "error";

function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[color:var(--foreground)]">
        {seg}
      </strong>
    ) : (
      seg
    ),
  );
}

// texto enviado pro /api/capturar: o passo + sub-itens como contexto.
function flatten(item: Item): string {
  const subs = item.children.map((c) => c.text).join("; ");
  return subs ? `${item.text} (${subs})` : item.text;
}

export function ProximosPassosList({
  items,
  meetingId,
}: {
  items: Item[];
  meetingId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<number, Status>>({});

  async function criar(i: number, item: Item) {
    if (status[i] === "loading" || status[i] === "done") return;
    setStatus((s) => ({ ...s, [i]: "loading" }));
    try {
      const res = await fetch("/api/capturar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: flatten(item), meeting_id: meetingId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((s) => ({ ...s, [i]: "done" }));
      router.refresh();
    } catch {
      setStatus((s) => ({ ...s, [i]: "error" }));
    }
  }

  return (
    <ul className="space-y-1.5 text-[14px] leading-relaxed text-[color:var(--foreground)]">
      {items.map((item, i) => {
        const st = status[i] ?? "idle";
        return (
          <li key={i} className="group flex items-start gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--muted-strong)]" />
            <span className="flex-1">
              {inline(item.text)}
              {item.children.length > 0 && (
                <ul className="list-[circle] pl-5 mt-1 space-y-0.5 text-[color:var(--muted-strong)]">
                  {item.children.map((c, ci) => (
                    <li key={ci}>{inline(c.text)}</li>
                  ))}
                </ul>
              )}
            </span>
            <button
              type="button"
              onClick={() => criar(i, item)}
              disabled={st === "loading" || st === "done"}
              title={st === "done" ? "Tarefa criada" : "Criar tarefa deste passo"}
              className={
                st === "done"
                  ? "shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium"
                  : st === "error"
                    ? "shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[color:var(--urgent-bg)] text-[color:var(--urgent)]"
                    : "shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] hover:ring-1 hover:ring-[color:var(--foreground)]/20 transition disabled:opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
              }
            >
              {st === "loading" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : st === "done" ? (
                <Check size={12} strokeWidth={2.5} />
              ) : (
                <Plus size={12} strokeWidth={2.5} />
              )}
              {st === "done" ? "tarefa criada" : st === "error" ? "erro, tentar de novo" : "tarefa"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

"use client";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";
import type { Acao } from "../task-row";

export type PraQuem = { owner: string; acao: Acao };

export function PraQuemChip({ value, onChange }: { value: PraQuem; onChange: (v: PraQuem) => void }) {
  const [owners, setOwners] = useState<{ name: string; is_me: boolean }[]>([]);
  const [txt, setTxt] = useState("");
  useEffect(() => { fetch("/api/owners").then((r) => r.json()).then((d) => setOwners(d.owners ?? [])).catch(() => {}); }, []);
  const isMe = value.owner === "vitor" && value.acao === "executar";
  const label = isMe ? "Vitor" : value.owner === "?" ? "alguém" : value.owner;
  const filtered = owners.filter((o) => !o.is_me && o.name.toLowerCase().includes(txt.toLowerCase()));
  return (
    <Popover ariaLabel="Mudar responsável"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          isMe ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)]" : "bg-[color:var(--warm-bg)] text-[color:var(--warm)]")}>
          <UserRound size={11} /> {isMe ? "Vitor" : label}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          <button type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)] font-medium"
            onClick={() => { onChange({ owner: "vitor", acao: "executar" }); close(); }}>eu (executar)</button>
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="delegar a…"
            onKeyDown={(e) => { if (e.key === "Enter" && txt.trim()) { onChange({ owner: txt.trim(), acao: "cobrar" }); close(); } }}
            className="mx-1 my-1 px-2 py-1 text-sm rounded border border-[color:var(--border)] bg-transparent" />
          {filtered.map((o) => (
            <button key={o.name} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange({ owner: o.name, acao: "cobrar" }); close(); }}>cobrar {o.name}</button>
          ))}
          {!isMe && (
            <button type="button" className="text-left text-[12px] px-2 py-1.5 rounded text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
              onClick={() => { onChange({ owner: value.owner, acao: value.acao === "cobrar" ? "aguardar" : "cobrar" }); close(); }}>
              alternar p/ {value.acao === "cobrar" ? "aguardar" : "cobrar"}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

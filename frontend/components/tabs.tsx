"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: string;
  count?: number;
  content: React.ReactNode;
};

export function Tabs({
  items,
  defaultKey,
  activeKey,
  onChange,
}: {
  items: TabItem[];
  defaultKey?: string;
  // Modo controlado opcional: quem chama mantém o estado da aba ativa.
  activeKey?: string;
  onChange?: (key: string) => void;
}) {
  const [internal, setInternal] = useState(defaultKey || items[0]?.key);
  const active = activeKey ?? internal;
  const setActive = (key: string) => {
    if (onChange) onChange(key);
    if (activeKey === undefined) setInternal(key);
  };
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <div>
      <div className="border-b border-[color:var(--border)] flex gap-0 -mx-5 sm:-mx-6 px-5 sm:px-6 overflow-x-auto scrollbar-none">
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setActive(it.key)}
              className={cn(
                "press-feedback relative shrink-0 inline-flex items-center gap-2 px-3 py-3 text-[14px] touch-manipulation",
                isActive
                  ? "text-[color:var(--foreground)]"
                  : "text-[color:var(--muted)] hover:text-[color:var(--muted-strong)]",
              )}
            >
              <span className={cn(isActive && "font-medium")}>{it.label}</span>
              {typeof it.count === "number" && (
                <span
                  className={cn(
                    "text-[11px] inline-flex items-center justify-center min-w-[18px] px-1.5 h-[18px] rounded-full",
                    isActive
                      ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                      : "bg-[color:var(--accent)] text-[color:var(--muted-strong)]",
                  )}
                >
                  {it.count}
                </span>
              )}
              {isActive && (
                <span
                  className="absolute left-0 right-0 -bottom-px h-[2px] bg-[color:var(--foreground)]"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-5">{current?.content}</div>
    </div>
  );
}

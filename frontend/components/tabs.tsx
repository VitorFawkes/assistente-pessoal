"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: string;
  count?: number;
  content: React.ReactNode;
};

export function Tabs({ items, defaultKey }: { items: TabItem[]; defaultKey?: string }) {
  const [active, setActive] = useState(defaultKey || items[0]?.key);
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <div>
      <div className="border-b border-[color:var(--border)] flex gap-1">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => setActive(it.key)}
            className={cn(
              "relative px-3 py-2 text-sm transition",
              it.key === active
                ? "text-[color:var(--foreground)]"
                : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]",
            )}
          >
            {it.label}
            {typeof it.count === "number" && (
              <span
                className={cn(
                  "ml-1.5 inline-flex items-center justify-center px-1.5 text-[10px] rounded font-medium",
                  it.key === active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                )}
              >
                {it.count}
              </span>
            )}
            {it.key === active && (
              <span className="absolute left-0 right-0 -bottom-px h-px bg-[color:var(--foreground)]" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-4">{current?.content}</div>
    </div>
  );
}

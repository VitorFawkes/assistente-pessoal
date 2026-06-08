"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Popover({ trigger, children, ariaLabel }: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {trigger(open)}
      </button>
      {open && (
        <div role="dialog" aria-label={ariaLabel}
          className={cn("absolute z-50 mt-1 min-w-[180px] rounded-xl border border-[color:var(--border)]",
            "bg-[color:var(--card)] shadow-xl p-1.5")}
          onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

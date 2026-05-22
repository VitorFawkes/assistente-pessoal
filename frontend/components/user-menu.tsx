"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type Props = { nome: string; isAdmin: boolean };

export function UserMenu({ nome, isAdmin }: Props) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const logout = () => {
    start(async () => {
      await fetch("/api/sessao", { method: "DELETE" });
      window.location.href = "/sem-acesso";
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[13px] px-2.5 py-1 rounded-full hover:bg-[color:var(--accent)] transition text-[color:var(--muted-strong)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-full bg-[color:var(--accent)] flex items-center justify-center text-[11px] font-medium uppercase">
          {nome.slice(0, 1)}
        </span>
        <span className="hidden sm:inline">{nome}</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            aria-label="fechar menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[color:var(--border)] bg-[color:var(--background)] shadow-lg z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-[color:var(--border)]">
              <div className="text-[13px] font-medium">{nome}</div>
              {isAdmin && (
                <div className="text-[10px] tracking-wider uppercase text-[color:var(--muted)] mt-0.5">
                  admin
                </div>
              )}
            </div>
            <nav className="py-1 text-[13px]">
              {isAdmin && (
                <Link
                  href="/admin/convites"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                >
                  Convites
                </Link>
              )}
              <Link
                href="/seguranca/sessoes"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
              >
                Sessões ativas
              </Link>
              <button
                type="button"
                onClick={logout}
                disabled={pending}
                className="block w-full text-left px-4 py-2 hover:bg-[color:var(--accent)] text-[color:var(--urgent)] disabled:opacity-50"
              >
                {pending ? "saindo..." : "Sair"}
              </button>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}

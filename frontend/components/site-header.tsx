"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

// Páginas full-bleed (conteúdo largo). O header acompanha a largura pra alinhar
// borda-a-borda com o conteúdo; nas demais páginas fica estreito (max-w-3xl).
const WIDE_PREFIXES = ["/plano", "/quadros"];

const NAV = [
  { href: "/", label: "Pendências" },
  { href: "/plano", label: "Plano" },
  { href: "/reunioes", label: "Reuniões" },
  { href: "/pessoas", label: "Pessoas" },
  { href: "/quadros", label: "Quadros" },
  { href: "/assistente", label: "Assistente" },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function SiteHeader({
  user,
}: {
  user: { nome: string; is_admin: boolean } | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const wide = WIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  // Casa com a largura/padding do conteúdo: wide = max-w-[1400px] px-8; estreito = max-w-3xl px-6.
  const inner = wide ? "max-w-[1400px] px-5 sm:px-8" : "max-w-3xl px-5 sm:px-6";

  return (
    <header className="border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur-md sticky top-0 z-40">
      <div className={`mx-auto ${inner} h-14 flex items-center justify-between`}>
        <Link
          href="/"
          className="font-display text-2xl leading-none tracking-tight"
          style={{ fontWeight: 500 }}
        >
          ações<span className="text-[color:var(--urgent)]">.</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {user && (
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              {NAV.map((item) => {
                const current = isCurrent(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "px-3 py-1.5 rounded-full transition",
                      current
                        ? "bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium"
                        : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)]",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
          {/* No celular a barra some — sem isto não havia como sair da tela atual. */}
          {user && (
            <div className="relative sm:hidden" ref={ref}>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={open ? "Fechar menu" : "Abrir menu"}
                aria-expanded={open}
                className="p-2 -mr-1 rounded-lg text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)] transition"
              >
                {open ? <X size={20} /> : <Menu size={20} />}
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5 z-50">
                  {NAV.map((item) => {
                    const current = isCurrent(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "block px-3 py-2 rounded-xl text-sm transition",
                          current
                            ? "bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium"
                            : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]/60",
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {user && <UserMenu nome={user.nome} isAdmin={user.is_admin} />}
        </div>
      </div>
    </header>
  );
}

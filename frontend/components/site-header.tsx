"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";

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

export function SiteHeader({
  user,
}: {
  user: { nome: string; is_admin: boolean } | null;
}) {
  const pathname = usePathname();
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
        <div className="flex items-center gap-3">
          {user && (
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          {user && <UserMenu nome={user.nome} isAdmin={user.is_admin} />}
        </div>
      </div>
    </header>
  );
}

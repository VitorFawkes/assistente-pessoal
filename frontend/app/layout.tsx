import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import Link from "next/link";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { UserMenu } from "@/components/user-menu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Ações — Assistente Pessoal",
  description: "Ações extraídas das suas reuniões",
};

// O layout renderiza pra páginas autenticadas E pra /sem-acesso. Pra não
// vazar query no caminho público, leitura de user é tolerante a "sem sessão".
async function getCurrentUser(): Promise<{ nome: string; is_admin: boolean } | null> {
  const sessionId = (await cookies()).get("session")?.value;
  if (!sessionId) return null;
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await query<{ nome: string; is_admin: boolean }>(
      `SELECT u.nome, u.is_admin
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.revoked_at IS NULL AND s.last_used_at > $2 AND u.deleted_at IS NULL`,
      [sessionId, cutoff],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur-md sticky top-0 z-40">
          <div className="mx-auto max-w-3xl px-5 sm:px-6 h-14 flex items-center justify-between">
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
                  <Link
                    href="/"
                    className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
                  >
                    Pendências
                  </Link>
                  <Link
                    href="/plano"
                    className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
                  >
                    Plano
                  </Link>
                  <Link
                    href="/reunioes"
                    className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
                  >
                    Reuniões
                  </Link>
                  <Link
                    href="/pessoas"
                    className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
                  >
                    Pessoas
                  </Link>
                </nav>
              )}
              {user && <UserMenu nome={user.nome} isAdmin={user.is_admin} />}
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto max-w-3xl w-full px-5 sm:px-6 py-6 sm:py-10">
          {children}
        </main>
        <footer className="border-t border-[color:var(--border)] py-5 text-center text-[11px] tracking-wider uppercase text-[color:var(--muted)]">
          Assistente Pessoal · {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}

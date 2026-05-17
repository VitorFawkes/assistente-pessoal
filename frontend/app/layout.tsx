import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ações — Assistente Pessoal",
  description: "Ações extraídas das suas reuniões",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-[color:var(--border)] bg-[color:var(--card)]/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight">
              Ações
            </Link>
            <nav className="flex items-center gap-6 text-sm text-[color:var(--muted)]">
              <Link href="/" className="hover:text-[color:var(--foreground)]">
                Pendências
              </Link>
              <Link href="/reunioes" className="hover:text-[color:var(--foreground)]">
                Reuniões
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 mx-auto max-w-5xl w-full px-6 py-8">{children}</main>
        <footer className="border-t border-[color:var(--border)] py-4 text-center text-xs text-[color:var(--muted)]">
          Assistente Pessoal · {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}

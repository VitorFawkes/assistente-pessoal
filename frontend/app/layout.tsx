import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import Link from "next/link";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
              >
                Pendências
              </Link>
              <Link
                href="/reunioes"
                className="px-3 py-1.5 rounded-full hover:bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
              >
                Reuniões
              </Link>
            </nav>
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

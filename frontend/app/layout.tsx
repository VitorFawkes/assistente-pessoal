import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "sonner";
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
      // O script abaixo carimba data-tema antes do React entrar: sem isto o
      // React reclama que o HTML do servidor está diferente do da tela.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Carimba a cor escolhida ANTES do primeiro desenho. Sem isto, quem
            escolheu Claro num computador escuro veria a tela piscar preta. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=localStorage.getItem("tema")||"sistema";var d=e==="escuro"||(e==="sistema"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-tema",d?"escuro":"claro");}catch(x){document.documentElement.setAttribute("data-tema","claro");}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <SiteHeader user={user} />
        <main className="flex-1 mx-auto max-w-3xl w-full px-5 sm:px-6 py-6 sm:py-10">
          {children}
        </main>
        <footer className="border-t border-[color:var(--border)] py-5 text-center text-[11px] tracking-wider uppercase text-[color:var(--muted)]">
          Assistente Pessoal · {new Date().getFullYear()}
        </footer>
        <Toaster />
      </body>
    </html>
  );
}

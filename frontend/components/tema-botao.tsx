"use client";

// A cor da tela é escolha da pessoa: Claro, Escuro ou Igual ao aparelho.
// Fica guardada neste navegador e vale em todas as telas.
//
// Quem carimba o <html> na primeira pintura é o script do topo da página
// (app/layout.tsx). Aqui só se troca a escolha depois que a tela já abriu.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Escolha = "claro" | "escuro" | "sistema";

// A escolha mora no navegador, não no React. Lemos ela como fonte de fora
// (useSyncExternalStore): no servidor não existe, e é por isso que o primeiro
// desenho não mostra ícone nenhum.
const AVISO = "tema:mudou";

function assinar(aoMudar: () => void) {
  window.addEventListener(AVISO, aoMudar);
  window.addEventListener("storage", aoMudar);
  return () => {
    window.removeEventListener(AVISO, aoMudar);
    window.removeEventListener("storage", aoMudar);
  };
}

function lerAqui(): Escolha {
  try {
    return (localStorage.getItem("tema") as Escolha | null) ?? "sistema";
  } catch {
    return "sistema";
  }
}

const lerNoServidor = (): Escolha | null => null;

const OPCOES: { valor: Escolha; rotulo: string; Icone: typeof Sun }[] = [
  { valor: "claro", rotulo: "Claro", Icone: Sun },
  { valor: "escuro", rotulo: "Escuro", Icone: Moon },
  { valor: "sistema", rotulo: "Igual ao aparelho", Icone: Monitor },
];

function aplicar(escolha: Escolha) {
  const escuro =
    escolha === "escuro" ||
    (escolha === "sistema" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-tema", escuro ? "escuro" : "claro");
}

export function TemaBotao() {
  const escolha = useSyncExternalStore(assinar, lerAqui, lerNoServidor);
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Em "Igual ao aparelho", seguir o aparelho quando ele troca de cor sozinho
  // (fim de tarde no macOS, por exemplo).
  useEffect(() => {
    if (escolha !== "sistema") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const ouvir = () => aplicar("sistema");
    mq.addEventListener("change", ouvir);
    return () => mq.removeEventListener("change", ouvir);
  }, [escolha]);

  useEffect(() => {
    if (!aberto) return;
    function noClique(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    }
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", noClique);
    document.addEventListener("keydown", naTecla);
    return () => {
      document.removeEventListener("mousedown", noClique);
      document.removeEventListener("keydown", naTecla);
    };
  }, [aberto]);

  const escolher = useCallback((v: Escolha) => {
    localStorage.setItem("tema", v);
    window.dispatchEvent(new Event(AVISO));
    aplicar(v);
    setAberto(false);
  }, []);

  const atual = OPCOES.find((o) => o.valor === escolha) ?? OPCOES[2];
  const Icone = atual.Icone;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Escolher a cor da tela"
        title={escolha ? `Cor da tela: ${atual.rotulo}` : "Cor da tela"}
        className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] px-2.5 py-1.5 text-[12.5px] font-medium text-[color:var(--muted-strong)] hover:border-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <Icone size={14} strokeWidth={2} />
        <span className="hidden sm:inline">Cor</span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5 z-50"
        >
          <span className="block px-3 pt-1 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
            Cor da tela
          </span>
          {OPCOES.map((o) => {
            const OpIcone = o.Icone;
            const ativa = o.valor === escolha;
            return (
              <button
                key={o.valor}
                type="button"
                role="menuitemradio"
                aria-checked={ativa}
                onClick={() => escolher(o.valor)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition text-left",
                  ativa
                    ? "bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium"
                    : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]/60",
                )}
              >
                <OpIcone size={14} strokeWidth={2} />
                {o.rotulo}
                {ativa && <span className="ml-auto text-[color:var(--done)]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

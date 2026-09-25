"use client";

import { useSyncExternalStore } from "react";

// Equipe: quando o Ações está dentro do TTARS e o navegador não guardou a entrada (cookie
// bloqueado), a tela de "sem acesso" aparece dentro do quadro. Aqui ela troca o convite
// "Abrir o TTARS" (a pessoa já está nele) por "abrir numa aba nova", pedido ao TTARS.
const nada = () => () => {};
const estaNumQuadro = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export function DentroDoTtars({ children }: { children: React.ReactNode }) {
  const dentro = useSyncExternalStore(nada, estaNumQuadro, () => false);
  if (!dentro) return <>{children}</>;
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        Este navegador não deixou o Ações abrir aqui dentro do TTARS.
      </p>
      <button
        type="button"
        onClick={() => window.parent.postMessage({ tipo: "acoes:abrir-fora" }, "*")}
        className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[color:var(--foreground)] text-[color:var(--background)] font-medium"
      >
        Abrir o Ações numa aba nova
      </button>
    </div>
  );
}

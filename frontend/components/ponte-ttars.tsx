"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Ações dentro do TTARS: conversa com a página do TTARS que o mostra.
//  - a cada troca de tela, avisa o TTARS (o endereço do TTARS acompanha e o voltar funciona);
//  - quando a pessoa clica no menu do TTARS, recebe pra onde ir e troca de tela sem recarregar.
// Só fala com os endereços do TTARS (os mesmos que podem embutir o Ações).
export function PonteTtars({ origens }: { origens: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const busca = useSearchParams();
  const ultimo = useRef<string | null>(null);

  useEffect(() => {
    if (window.parent === window) return;
    const qs = busca.toString();
    const caminho = qs ? `${pathname}?${qs}` : pathname;
    if (ultimo.current === caminho) return;
    ultimo.current = caminho;
    for (const o of origens) {
      try {
        window.parent.postMessage({ tipo: "acoes:rota", caminho }, o);
      } catch {
        // origem que não é a do pai: o navegador descarta
      }
    }
  }, [pathname, busca, origens]);

  useEffect(() => {
    function aoReceber(e: MessageEvent) {
      if (!origens.includes(e.origin)) return;
      const d = e.data as { tipo?: string; caminho?: string } | null;
      if (d?.tipo !== "acoes:ir" || typeof d.caminho !== "string") return;
      // Só caminho interno do Ações.
      if (!/^\/(?!\/)[A-Za-z0-9/_?=&%.-]*$/.test(d.caminho)) return;
      if (d.caminho === ultimo.current) return;
      ultimo.current = d.caminho;
      router.replace(d.caminho);
    }
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [origens, router]);

  return null;
}

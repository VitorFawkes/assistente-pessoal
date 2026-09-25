import Link from "next/link";
import { isTeamMode } from "@/lib/team-mode";

// Equipe: quem saiu do projeto (ou nunca foi chamado) cai aqui, não na tela preta do 404.
export default function ProjetoNaoEncontrado() {
  const equipe = isTeamMode();
  return (
    <div className="mx-auto max-w-md py-16 text-center space-y-4">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        {equipe ? "Projetos" : "Quadros"}
      </p>
      <h1 className="font-display text-3xl leading-tight">
        {equipe ? "Você não está neste projeto." : "Quadro não encontrado."}
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        {equipe
          ? "Ele foi arquivado ou você não está mais nele. Peça para alguém do projeto te chamar."
          : "Ele foi arquivado ou o endereço está errado."}
      </p>
      <Link
        href="/quadros"
        className="inline-flex rounded-full bg-[color:var(--foreground)] px-4 py-2 text-sm font-medium text-[color:var(--background)] hover:opacity-90 transition"
      >
        {equipe ? "Ver meus projetos" : "Ver meus quadros"}
      </Link>
    </div>
  );
}

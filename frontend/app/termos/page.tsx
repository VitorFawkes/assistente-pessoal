import { requireUserOrRedirect } from "@/lib/auth";
import { redirect } from "next/navigation";
import { aceitarTermos } from "./actions";

export const dynamic = "force-dynamic";

export default async function TermosPage() {
  const user = await requireUserOrRedirect();
  if (user.consent_terms_at) redirect("/");

  return (
    <div className="mx-auto max-w-2xl pt-8 sm:pt-12 space-y-6">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Antes de começar
      </p>
      <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
        Como esse assistente{" "}
        <span className="italic font-[450] text-[color:var(--muted-strong)]">
          funciona.
        </span>
      </h1>

      <div className="space-y-4 text-[14px] leading-relaxed text-[color:var(--muted-strong)]">
        <p>
          Você manda áudios de reuniões e voice notes. A gente transcreve via{" "}
          <strong>OpenAI Whisper</strong> e extrai ações pendentes via{" "}
          <strong>OpenAI GPT</strong>.
        </p>
        <p>
          <strong>Sobre os áudios:</strong> você é a pessoa responsável pelos
          áudios que envia. Se outras pessoas estão na gravação, garanta que
          elas consentiram em ter a fala delas transcrita e processada por IA.
          Se não tiver certeza, evita mandar.
        </p>
        <p>
          A gente armazena os áudios e transcrições enquanto a sua conta existir.
          Você pode pedir pra deletar tudo a qualquer momento (manda mensagem
          pro Vitor).
        </p>
        <p className="text-[12px] text-[color:var(--muted)] italic">
          Esse é um beta — uso pessoal, custos da OpenAI bancados pelo Vitor
          (ele te avisa se você passar de um volume razoável e combina como
          dividir).
        </p>
      </div>

      <form action={aceitarTermos}>
        <button
          type="submit"
          className="rounded-xl bg-[color:var(--foreground)] text-[color:var(--background)] px-6 py-3 font-medium hover:opacity-90 transition"
        >
          Entendi e concordo
        </button>
      </form>
    </div>
  );
}

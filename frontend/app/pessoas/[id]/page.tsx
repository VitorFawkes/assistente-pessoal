import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { pessoasFor, voiceSamplesFor } from "@/lib/queries";
import { ArrowLeft, UserRound } from "lucide-react";
import {
  PessoaSamplesList,
  type VoiceSample,
  type PessoaOption,
} from "@/components/pessoa-samples";

export const dynamic = "force-dynamic";

type Pessoa = {
  id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  sample_count: number;
};

export default async function PessoaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const pessoa = (await pessoasFor(user.id).byIdWithSampleCount(id)) as Pessoa | null;
  if (!pessoa) notFound();

  const [samples, pessoasOptions] = await Promise.all([
    voiceSamplesFor(user.id).byPessoaWithMeeting(id) as Promise<VoiceSample[]>,
    pessoasFor(user.id).listMinimal() as Promise<PessoaOption[]>,
  ]);

  return (
    <div className="space-y-7 sm:space-y-9">
      <Link
        href="/pessoas"
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ArrowLeft size={14} /> pessoas
      </Link>

      <header className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {pessoa.is_vitor && (
            <span className="inline-flex items-center gap-1 text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)]">
              <UserRound size={10} /> Você
            </span>
          )}
        </div>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          {pessoa.nome}
        </h1>
        {pessoa.aliases.length > 0 && (
          <p className="text-[13px] text-[color:var(--muted)]">
            também: {pessoa.aliases.join(", ")}
          </p>
        )}
        {pessoa.notas && (
          <p className="text-[14px] text-[color:var(--muted-strong)]">
            {pessoa.notas}
          </p>
        )}
        <p className="text-[12px] text-[color:var(--muted)]">
          {pessoa.sample_count}{" "}
          {pessoa.sample_count === 1 ? "amostra de voz" : "amostras de voz"} ativas
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Amostras
        </h2>
        <p className="text-[13px] text-[color:var(--muted-strong)] max-w-md">
          Cada amostra é um trecho real de áudio que o sistema vinculou a essa
          pessoa. Toca pra confirmar se é mesmo ela; se não for, deleta — o
          aprendizado fica mais preciso.
        </p>
        <PessoaSamplesList
          samples={samples}
          currentPessoaId={pessoa.id}
          pessoas={pessoasOptions}
        />
      </section>
    </div>
  );
}

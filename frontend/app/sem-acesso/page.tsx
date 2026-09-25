import { isTeamMode } from "@/lib/team-mode";
import { DentroDoTtars } from "@/components/dentro-do-ttars";

export const metadata = {
  title: "Sem acesso — Assistente Pessoal",
};

export default async function SemAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const teamMode = isTeamMode();
  const expirou = (await searchParams).motivo === "link-expirado";
  const ttars = (process.env.TTARS_ORIGENS || "").split(",")[0]?.trim();

  return (
    <div className="mx-auto max-w-md space-y-6 pt-16 sm:pt-24 text-center">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Acesso restrito
      </p>
      <h1 className="font-display text-4xl leading-[1.05]">
        {teamMode ? (
          <>
            {expirou ? "Entre" : "Entre pelo"}{" "}
            <span className="italic font-[450] text-[color:var(--muted-strong)]">
              {expirou ? "de novo." : "TTARS."}
            </span>
          </>
        ) : (
          <>
            Você precisa de um{" "}
            <span className="italic font-[450] text-[color:var(--muted-strong)]">
              convite.
            </span>
          </>
        )}
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        {teamMode ? (
          expirou
            ? "O acesso pela aba vale 2 minutos. Volte ao TTARS e clique em Ações de novo."
            : "Abra o TTARS e clique em Ações no menu. Se a aba não aparecer, peça ao Vitor para liberar seu acesso."
        ) : (
          "Esse assistente é por enquanto um beta fechado. Se o Vitor te enviou um link, abra ele aqui — você ficará logado nesse celular pelos próximos 30 dias automaticamente."
        )}
      </p>
      {teamMode && ttars && (
        <DentroDoTtars>
          <a
            href={ttars}
            target="_top"
            className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[color:var(--foreground)] text-[color:var(--background)] font-medium"
          >
            Abrir o TTARS
          </a>
        </DentroDoTtars>
      )}
    </div>
  );
}

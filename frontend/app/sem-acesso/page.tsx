export const dynamic = "force-static";

export const metadata = {
  title: "Sem acesso — Assistente Pessoal",
};

export default function SemAcessoPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 pt-16 sm:pt-24 text-center">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Acesso restrito
      </p>
      <h1 className="font-display text-4xl leading-[1.05]">
        Você precisa de um{" "}
        <span className="italic font-[450] text-[color:var(--muted-strong)]">
          convite.
        </span>
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        Esse assistente é por enquanto um beta fechado. Se o Vitor te enviou um
        link, abra ele aqui — você ficará logado nesse celular pelos próximos 30
        dias automaticamente.
      </p>
    </div>
  );
}

import { requireUserOrRedirect } from "@/lib/auth";
import { RecordingScreen } from "@/components/recording-screen";

export const dynamic = "force-dynamic";

export default async function GravarPage() {
  const user = await requireUserOrRedirect();

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Gravação
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Grave sua{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            reunião.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Escolha se é uma reunião na sala ou online, e começar a grabar.
        </p>
      </header>

      <RecordingScreen userId={user.id} />
    </div>
  );
}

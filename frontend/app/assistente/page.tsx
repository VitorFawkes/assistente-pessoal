import { requireUserOrRedirect } from "@/lib/auth";
import { ChatPanel } from "@/components/chat-panel";

export const dynamic = "force-dynamic";

export default async function AssistentePage() {
  await requireUserOrRedirect();
  return (
    <div className="space-y-5">
      <header className="space-y-1.5">
        <p className="text-[11px] tracking-widest uppercase text-muted">Assistente</p>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          Converse com seu assistente
        </h1>
        <p className="text-sm text-muted-strong">
          Ele cria, edita, conclui e organiza suas tarefas e lê suas reuniões — por conversa.
        </p>
      </header>
      <ChatPanel />
    </div>
  );
}

"use client";

// Equipe: quem está no projeto. Mesmo desenho do menu "Convidados" do quadro
// (quadro-painel.tsx): botão que abre por cima, fecha no Esc e no clique fora, vira
// gaveta no celular. Aqui se chama colega, tira gente, sai do projeto e vê o histórico.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, X, Search, LogOut, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { corDaPessoa, iniciais } from "@/lib/quadro-v2";
import type { PessoaProjeto } from "@/lib/projetos";
import type { AtividadeItem } from "@/lib/quadros";
import { ActivityFeed } from "./activity-feed";

type Colega = { id: string; nome: string };

export function ProjetoPessoas({
  quadroId,
  pessoasIniciais,
  souDono,
  eu,
  atividade,
}: {
  quadroId: string;
  pessoasIniciais: PessoaProjeto[];
  souDono: boolean;
  eu: string;
  atividade: AtividadeItem[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"pessoas" | "historico">("pessoas");
  const [pessoas, setPessoas] = useState(pessoasIniciais);
  const [colegas, setColegas] = useState<Colega[] | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<"sair" | "arquivar" | null>(null);

  useEffect(() => {
    if (!aberto) return;
    document.body.style.overflow = "hidden";
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    window.addEventListener("keydown", naTecla);
    if (colegas === null) {
      fetch("/api/equipe/colegas")
        .then((r) => r.json())
        .then((d: { colegas?: Colega[] }) => setColegas(d.colegas ?? []))
        .catch(() => setColegas([]));
    }
    return () => {
      window.removeEventListener("keydown", naTecla);
      document.body.style.overflow = "";
    };
  }, [aberto, colegas]);

  const noProjeto = useMemo(() => new Set(pessoas.map((p) => p.user_id)), [pessoas]);
  const q = busca.trim().toLowerCase();
  const paraChamar = (colegas ?? []).filter(
    (c) => !noProjeto.has(c.id) && (!q || c.nome.toLowerCase().includes(q)),
  );

  async function chamar(c: Colega) {
    setOcupado(c.id);
    try {
      const r = await fetch(`/api/quadros/${quadroId}/pessoas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: c.id }),
      });
      const d = (await r.json().catch(() => ({}))) as { pessoas?: PessoaProjeto[]; error?: string };
      if (!r.ok) throw new Error(d.error || "Não deu para chamar.");
      setPessoas(d.pessoas ?? pessoas);
      setBusca("");
      toast.success(`${c.nome} entrou no projeto`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para chamar.");
    } finally {
      setOcupado(null);
    }
  }

  async function tirar(p: PessoaProjeto) {
    setOcupado(p.user_id);
    try {
      const r = await fetch(`/api/quadros/${quadroId}/pessoas/${p.user_id}`, { method: "DELETE" });
      const d = (await r.json().catch(() => ({}))) as { pessoas?: PessoaProjeto[]; saiu?: boolean; error?: string };
      if (!r.ok) throw new Error(d.error || "Não deu para tirar.");
      if (d.saiu) {
        toast.success("Você saiu do projeto");
        router.push("/quadros");
        return;
      }
      setPessoas(d.pessoas ?? pessoas.filter((x) => x.user_id !== p.user_id));
      toast.success(`${p.nome} saiu do projeto`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para tirar.");
    } finally {
      setOcupado(null);
      setConfirmar(null);
    }
  }

  async function arquivar() {
    setOcupado("arquivar");
    try {
      const r = await fetch(`/api/quadros/${quadroId}`, { method: "DELETE" });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Não deu para arquivar.");
      }
      toast.success("Projeto arquivado");
      router.push("/quadros");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para arquivar.");
      setOcupado(null);
      setConfirmar(null);
    }
  }

  const eu_ = pessoas.find((p) => p.user_id === eu);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] pl-2 pr-3 py-1.5 text-[12.5px] font-medium text-[color:var(--muted-strong)] hover:border-[color:var(--muted)] hover:text-[color:var(--foreground)] transition whitespace-nowrap"
      >
        <span className="flex -space-x-1.5" aria-hidden>
          {pessoas.slice(0, 3).map((p) => (
            <span key={p.user_id} className={cn("q-ini ring-2 ring-[color:var(--card)]", corDaPessoa(p.nome))}>
              {iniciais(p.nome)}
            </span>
          ))}
        </span>
        <Users size={13} strokeWidth={2} className={pessoas.length ? "hidden" : ""} />
        Pessoas
        <span className="text-[11px] font-bold text-[color:var(--muted)]">{pessoas.length}</span>
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAberto(false);
          }}
        >
          <div className="w-full sm:max-w-lg bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="font-display text-xl">Pessoas do projeto</h2>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-3 flex gap-1">
              {(["pessoas", "historico"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAba(v)}
                  aria-pressed={aba === v}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12.5px] font-medium transition",
                    aba === v
                      ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                      : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
                  )}
                >
                  {v === "pessoas" ? "Pessoas" : "Histórico"}
                </button>
              ))}
            </div>

            <div className="px-5 pb-5 overflow-y-auto space-y-5">
              {aba === "historico" ? (
                <ActivityFeed items={atividade} />
              ) : (
                <>
                  <p className="text-[13px] text-[color:var(--muted-strong)]">
                    Todo mundo aqui vê e mexe nas tarefas do projeto. Só quem criou uma tarefa
                    pode apagá-la.
                  </p>

                  <ul className="space-y-1.5">
                    {pessoas.map((p) => {
                      const podeTirar = !p.e_dono && souDono && p.user_id !== eu;
                      return (
                        <li key={p.user_id} className="flex items-center gap-2.5 py-1">
                          <span className={cn("q-ini", corDaPessoa(p.nome))} aria-hidden>
                            {iniciais(p.nome)}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-[14px]">
                            {p.nome}
                            {p.user_id === eu && <span className="text-[color:var(--muted)]"> (você)</span>}
                          </span>
                          {p.e_dono && (
                            <span className="text-[11px] text-[color:var(--muted)]">criou o projeto</span>
                          )}
                          {podeTirar && (
                            <button
                              type="button"
                              disabled={ocupado === p.user_id}
                              onClick={() => tirar(p)}
                              className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] disabled:opacity-50"
                            >
                              tirar
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--muted)]">
                      Chamar alguém
                    </p>
                    <label className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 py-2 focus-within:border-[color:var(--muted)]">
                      <Search size={14} className="text-[color:var(--muted)]" />
                      <input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Nome da pessoa"
                        className="flex-1 bg-transparent text-[14px] outline-none"
                      />
                    </label>
                    {colegas === null ? (
                      <p className="text-[13px] text-[color:var(--muted)]">Carregando…</p>
                    ) : paraChamar.length === 0 ? (
                      <p className="text-[13px] text-[color:var(--muted)]">
                        {q
                          ? "Ninguém da equipe com esse nome."
                          : "Todo mundo que já entrou no Ações está aqui. Quem ainda não entrou aparece depois do primeiro acesso."}
                      </p>
                    ) : (
                      <ul className="max-h-56 overflow-y-auto divide-y divide-[color:var(--border)] rounded-lg border border-[color:var(--border)]">
                        {paraChamar.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              disabled={ocupado === c.id}
                              onClick={() => chamar(c)}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[14px] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                            >
                              <span className={cn("q-ini", corDaPessoa(c.nome))} aria-hidden>
                                {iniciais(c.nome)}
                              </span>
                              <span className="flex-1 min-w-0 truncate">{c.nome}</span>
                              <span className="text-[12px] text-[color:var(--muted)]">
                                {ocupado === c.id ? "chamando…" : "+ chamar"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[color:var(--border)]">
                    {souDono ? (
                      <button
                        type="button"
                        disabled={ocupado === "arquivar"}
                        onClick={() => (confirmar === "arquivar" ? arquivar() : setConfirmar("arquivar"))}
                        onBlur={() => setConfirmar(null)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition",
                          confirmar === "arquivar"
                            ? "bg-[color:var(--urgent)] text-white font-semibold"
                            : "text-[color:var(--muted-strong)] hover:text-[color:var(--urgent)]",
                        )}
                      >
                        <Archive size={14} />
                        {confirmar === "arquivar"
                          ? "Toque de novo: o projeto some pra todos (as tarefas continuam)"
                          : "Arquivar projeto"}
                      </button>
                    ) : eu_ ? (
                      <button
                        type="button"
                        disabled={ocupado === eu}
                        onClick={() => (confirmar === "sair" ? tirar(eu_) : setConfirmar("sair"))}
                        onBlur={() => setConfirmar(null)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition",
                          confirmar === "sair"
                            ? "bg-[color:var(--urgent)] text-white font-semibold"
                            : "text-[color:var(--muted-strong)] hover:text-[color:var(--urgent)]",
                        )}
                      >
                        <LogOut size={14} />
                        {confirmar === "sair" ? "Toque de novo para sair" : "Sair do projeto"}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

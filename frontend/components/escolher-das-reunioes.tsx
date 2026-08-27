"use client";

// Escolher tarefas das reuniões.
//
// Antes isto era uma lista corrida de 500 tarefas soltas com 11 filtros em
// cima. O Vitor reclamou, com razão: "são muitos botões até achar as últimas
// reuniões", "não dá pra saber a reunião que era direito", "não dá pra escutar
// ou ver trecho", "muitas vezes podem ser repetidas".
//
// A virada: a lista é de REUNIÕES, da mais nova pra mais velha. Abre uma e vê
// o que saiu dela. As duas últimas já abrem abertas, então não se caça nada.
// Cada tarefa mostra o trecho da transcrição e um play que cai no minuto exato.
// E o que parece com o que já está no quadro avisa antes de você marcar.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Pause, Play, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataCurtaBR, horaBR } from "@/lib/data-br";
import { meetingSubject } from "@/lib/meeting-label";
import { corDaPessoa, donoDe, iniciais } from "@/lib/quadro-v2";
import type { Tarefa } from "@/lib/queries";

type Props = {
  quadroId: string;
  /** O que já está no quadro — é com isto que se avisa "parece repetida". */
  tarefasNoQuadro: Tarefa[];
  onClose: () => void;
  onAdded: () => void;
};

type Reuniao = {
  id: string | null; // null = criadas na mão
  nome: string;
  quando: string | null;
  duracao: number | null;
  tarefas: Tarefa[];
};

// ── parecidas ─────────────────────────────────────────────────────────

const PARADAS = new Set([
  "para", "com", "dos", "das", "que", "uma", "por", "nos", "nas", "sobre",
  "pelo", "pela", "este", "esta", "esse", "essa", "mais", "como", "sem",
]);

function palavras(t: string): Set<string> {
  return new Set(
    t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((p) => p.length >= 4 && !PARADAS.has(p)),
  );
}

/** Acha, entre as que JÁ estão no quadro, uma que diga quase a mesma coisa. */
function pareceCom(t: Tarefa, noQuadro: Tarefa[]): Tarefa | null {
  const a = palavras(t.titulo);
  if (a.size < 3) return null;
  let melhor: { t: Tarefa; nota: number } | null = null;
  for (const outra of noQuadro) {
    const b = palavras(outra.titulo);
    if (!b.size) continue;
    let comuns = 0;
    for (const p of a) if (b.has(p)) comuns++;
    const nota = comuns / Math.min(a.size, b.size);
    if (nota >= 0.6 && (!melhor || nota > melhor.nota)) melhor = { t: outra, nota };
  }
  return melhor?.t ?? null;
}

function minutos(seg: number | null | undefined): string {
  if (!seg) return "";
  const m = Math.round(seg / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}min`;
}

function relogio(seg: number): string {
  const m = Math.floor(seg / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(seg % 60)).padStart(2, "0")}`;
}

// ── o trecho, com o play que cai no minuto certo ──────────────────────

function Trecho({ tarefa }: { tarefa: Tarefa }) {
  const [inicio, setInicio] = useState<number | null>(null);
  const [tocando, setTocando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function tocar() {
    if (!tarefa.meeting_id) return;
    if (tocando) {
      audioRef.current?.pause();
      setTocando(false);
      return;
    }
    setBuscando(true);
    try {
      let em = inicio;
      if (em === null) {
        const r = await fetch(
          `/api/meetings/${tarefa.meeting_id}/momento?tarefa=${tarefa.id}`,
        );
        em = r.ok ? ((await r.json()) as { inicio: number | null }).inicio : null;
        setInicio(em);
      }
      if (!audioRef.current) {
        audioRef.current = new Audio(`/api/audio/${tarefa.meeting_id}`);
        audioRef.current.addEventListener("ended", () => setTocando(false));
        audioRef.current.addEventListener("error", () => {
          setTocando(false);
          toast.error("Não consegui tocar esta gravação");
        });
      }
      audioRef.current.currentTime = em ?? 0;
      await audioRef.current.play();
      setTocando(true);
    } catch {
      toast.error("Não consegui tocar esta gravação");
    } finally {
      setBuscando(false);
    }
  }

  if (!tarefa.evidencia && !tarefa.meeting_id) return null;

  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-[color:var(--accent)]/60 px-2 py-1.5">
      {tarefa.meeting_id && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void tocar();
          }}
          disabled={buscando}
          title={
            inicio !== null
              ? `Ouvir a partir de ${relogio(inicio)}`
              : "Ouvir este pedaço da reunião"
          }
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold transition",
            tocando
              ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
              : "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-strong)] hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)]",
          )}
        >
          {tocando ? <Pause size={10} /> : <Play size={10} />}
          {inicio !== null ? relogio(inicio) : buscando ? "…" : "ouvir"}
        </button>
      )}
      {tarefa.evidencia && (
        <span className="text-[11.5px] italic leading-snug text-[color:var(--muted-strong)] line-clamp-3">
          &ldquo;{tarefa.evidencia}&rdquo;
        </span>
      )}
    </div>
  );
}

// ── a tela ────────────────────────────────────────────────────────────

export function EscolherDasReunioes({ quadroId, tarefasNoQuadro, onClose, onAdded }: Props) {
  const [candidatas, setCandidatas] = useState<Tarefa[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const iniciouRef = useRef(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", naTecla);
    fetch(`/api/quadros/${quadroId}/tarefas`)
      .then((r) => r.json())
      .then((d: { candidatas?: Tarefa[]; truncado?: boolean }) => {
        setCandidatas(d.candidatas ?? []);
        setTruncado(Boolean(d.truncado));
      })
      .catch(() => toast.error("Erro ao carregar as tarefas das reuniões"))
      .finally(() => setCarregando(false));
    return () => {
      window.removeEventListener("keydown", naTecla);
      document.body.style.overflow = "";
    };
  }, [quadroId, onClose]);

  const reunioes: Reuniao[] = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const mapa = new Map<string, Reuniao>();
    for (const t of candidatas) {
      if (
        q &&
        !`${t.titulo} ${t.descricao ?? ""} ${t.owner} ${t.frente ?? ""} ${t.evidencia ?? ""} ${t.meeting_summary ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        continue;
      const chave = t.meeting_id ?? "__mao__";
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          id: t.meeting_id ?? null,
          nome: t.meeting_id
            ? nomes[t.meeting_id] ??
              meetingSubject(t.meeting_summary, t.meeting_nome) ??
              "Reunião"
            : "Criadas na mão",
          quando: t.meeting_recorded_at ?? null,
          duracao: t.meeting_duracao ?? null,
          tarefas: [],
        });
      }
      mapa.get(chave)!.tarefas.push(t);
    }
    const lista = [...mapa.values()];
    lista.sort((a, b) => {
      if (!a.quando) return 1;
      if (!b.quando) return -1;
      return b.quando.localeCompare(a.quando);
    });
    return lista;
  }, [candidatas, busca, nomes]);

  // As duas últimas reuniões já abrem abertas — é onde ele quase sempre vai.
  useEffect(() => {
    if (iniciouRef.current || !reunioes.length) return;
    iniciouRef.current = true;
    setAbertas(new Set(reunioes.slice(0, 2).map((r) => r.id ?? "__mao__")));
  }, [reunioes]);

  const parecidas = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const t of candidatas) {
      const p = pareceCom(t, tarefasNoQuadro);
      if (p) m.set(t.id, p);
    }
    return m;
  }, [candidatas, tarefasNoQuadro]);

  const total = candidatas.length;
  const aVista = reunioes.reduce((n, r) => n + r.tarefas.length, 0);

  function alternar(id: string) {
    setMarcadas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  async function renomear(reuniaoId: string, novo: string) {
    setRenomeando(null);
    const nome = novo.trim();
    if (!nome) return;
    setNomes((n) => ({ ...n, [reuniaoId]: nome }));
    try {
      const r = await fetch(`/api/meetings/${reuniaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      if (!r.ok) throw new Error();
      toast.success("Reunião renomeada");
    } catch {
      setNomes((n) => {
        const c = { ...n };
        delete c[reuniaoId];
        return c;
      });
      toast.error("Não consegui salvar o nome");
    }
  }

  async function adicionar() {
    const ids = [...marcadas];
    if (!ids.length || salvando) return;
    setSalvando(true);
    try {
      const r = await fetch(`/api/quadros/${quadroId}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: ids }),
      });
      if (!r.ok) throw new Error();
      toast.success(
        `${ids.length} ${ids.length === 1 ? "tarefa foi" : "tarefas foram"} pro quadro`,
      );
      onAdded();
      onClose();
    } catch {
      toast.error("Erro ao adicionar");
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-3xl bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-display text-xl">Escolher tarefas das reuniões</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
            />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar em todas as reuniões: título, pessoa, tema, fala…"
              className="w-full rounded-full border border-[color:var(--border)] bg-[color:var(--background)] pl-9 pr-8 py-2 text-[13.5px] outline-none focus:border-[color:var(--muted-strong)]"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[color:var(--muted)]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--muted)]">
            Só aparece o que ainda NÃO está neste quadro.{" "}
            {busca ? `${aVista} de ${total} à vista.` : `${reunioes.length} reuniões · ${total} tarefas.`}
            {truncado && " Lista limitada às mais recentes — use a busca pra achar as antigas."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-2">
          {carregando ? (
            <p className="py-10 text-center text-[13px] text-[color:var(--muted)]">carregando…</p>
          ) : !reunioes.length ? (
            <div className="py-12 text-center text-[color:var(--muted)]">
              <p className="font-display text-[20px] text-[color:var(--foreground)] mb-1">
                {busca ? "Nada com essa busca." : "Nada sobrando pra escolher."}
              </p>
              <p className="text-[13px]">
                {busca
                  ? "Tente o nome de quem falou, o tema, ou uma palavra da fala."
                  : "Tudo que saiu das suas reuniões já está neste quadro."}
              </p>
            </div>
          ) : (
            reunioes.map((r) => {
              const chave = r.id ?? "__mao__";
              const aberta = abertas.has(chave) || !!busca;
              const todasMarcadas =
                r.tarefas.length > 0 && r.tarefas.every((t) => marcadas.has(t.id));
              const quem = [...new Set(r.tarefas.map((t) => donoDe(t)).filter(Boolean))] as string[];

              return (
                <section
                  key={chave}
                  className={cn(
                    // shrink-0: sem isto o flex da rolagem espreme as reuniões
                    // até virarem um risco de 1px.
                    "shrink-0 rounded-xl border bg-[color:var(--background)] overflow-hidden transition",
                    aberta ? "border-[color:var(--muted)]" : "border-[color:var(--border)]",
                  )}
                >
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setAbertas((s) => {
                          const n = new Set(s);
                          if (n.has(chave)) n.delete(chave); else n.add(chave);
                          return n;
                        })
                      }
                      className="flex-1 min-w-0 flex items-start gap-2 text-left"
                    >
                      <ChevronRight
                        size={14}
                        className={cn(
                          "mt-1 shrink-0 text-[color:var(--muted)] transition",
                          aberta && "rotate-90",
                        )}
                      />
                      <span className="min-w-0">
                        {renomeando === chave ? (
                          <input
                            autoFocus
                            defaultValue={r.nome}
                            aria-label="nome da reunião"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => r.id && renomear(r.id, e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setRenomeando(null);
                            }}
                            className="w-full rounded-md border border-[color:var(--muted-strong)] bg-[color:var(--card)] px-2 py-0.5 text-[14.5px] font-semibold outline-none"
                          />
                        ) : (
                          <span
                            title={r.nome}
                            className="block text-[14.5px] font-semibold leading-snug line-clamp-2"
                          >
                            {r.nome}
                          </span>
                        )}
                        <span className="mt-0.5 flex items-center gap-2 flex-wrap text-[12px] text-[color:var(--muted)]">
                          {r.quando && (
                            <b className="font-semibold text-[color:var(--muted-strong)]">
                              {dataCurtaBR(r.quando)} · {horaBR(r.quando)}
                            </b>
                          )}
                          {r.duracao ? <span>{minutos(r.duracao)}</span> : null}
                          {quem.slice(0, 4).map((p) => (
                            <span key={p} className={cn("inline-flex items-center gap-1", corDaPessoa(p))}>
                              <span className="q-ini">{iniciais(p)}</span>
                              {p}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>

                    <span className="shrink-0 flex items-center gap-1.5">
                      {r.id && renomeando !== chave && (
                        <button
                          type="button"
                          onClick={() => setRenomeando(chave)}
                          title="dar outro nome a esta reunião"
                          className="rounded-md px-1.5 py-0.5 text-[11px] text-[color:var(--muted)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)]"
                        >
                          ✎ nome
                        </button>
                      )}
                      <span className="rounded-full bg-[color:var(--accent)] px-2.5 py-1 text-[11.5px] font-bold text-[color:var(--muted-strong)] whitespace-nowrap">
                        {r.tarefas.length} pra escolher
                      </span>
                    </span>
                  </div>

                  {aberta && (
                    <div className="border-t border-dashed border-[color:var(--border)] px-3 pb-3">
                      <button
                        type="button"
                        onClick={() =>
                          setMarcadas((s) => {
                            const n = new Set(s);
                            r.tarefas.forEach((t) =>
                              todasMarcadas ? n.delete(t.id) : n.add(t.id),
                            );
                            return n;
                          })
                        }
                        className="my-2 rounded-lg border border-dashed border-[color:var(--border)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--muted-strong)] hover:border-solid hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)] transition"
                      >
                        {todasMarcadas ? "Desmarcar todas desta reunião" : "Marcar todas desta reunião"}
                      </button>

                      <div className="flex flex-col gap-1">
                        {r.tarefas.map((t) => {
                          const marcada = marcadas.has(t.id);
                          const parecida = parecidas.get(t.id);
                          const dono = donoDe(t) ?? t.owner;
                          return (
                            <div
                              key={t.id}
                              onClick={() => alternar(t.id)}
                              className={cn(
                                "flex items-start gap-2.5 rounded-lg border px-2.5 py-2 cursor-pointer transition",
                                marcada
                                  ? "border-[color:var(--calm)]/45 bg-[color:var(--calm-bg)]"
                                  : "border-transparent hover:bg-[color:var(--accent)]/60",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={marcada}
                                onChange={() => alternar(t.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5 w-4 h-4 shrink-0 accent-[color:var(--calm)]"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13.5px] font-semibold leading-snug">
                                  {t.titulo}
                                </p>
                                <div className="mt-1 flex items-center gap-2 flex-wrap text-[11.5px] text-[color:var(--muted)]">
                                  {dono && (
                                    <span className={cn("inline-flex items-center gap-1", corDaPessoa(dono))}>
                                      <span className="q-ini">{iniciais(dono)}</span>
                                      {dono}
                                    </span>
                                  )}
                                  {t.frente && (
                                    <span className="rounded bg-[color:var(--accent)] px-1.5 py-0.5 font-semibold text-[color:var(--muted-strong)]">
                                      {t.frente}
                                    </span>
                                  )}
                                </div>

                                <Trecho tarefa={t} />

                                {parecida && (
                                  <p className="mt-1.5 rounded-lg border border-[color:var(--warm)]/40 bg-[color:var(--warm-bg)] px-2 py-1.5 text-[11.5px] font-semibold leading-snug text-[color:var(--warm)]">
                                    ⚠ Parece com &ldquo;{parecida.titulo}&rdquo;, que já está no quadro.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[color:var(--border)] px-5 py-3.5 flex-wrap">
          <span className="text-[13px] font-semibold text-[color:var(--muted-strong)]">
            {marcadas.size === 0
              ? "Nenhuma marcada"
              : `${marcadas.size} ${marcadas.size === 1 ? "tarefa marcada" : "tarefas marcadas"}`}
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-[13px] font-semibold text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={adicionar}
              disabled={!marcadas.size || salvando}
              className="rounded-lg bg-[color:var(--foreground)] px-4 py-2 text-[13px] font-semibold text-[color:var(--background)] disabled:opacity-40"
            >
              {salvando
                ? "Adicionando…"
                : marcadas.size
                ? `Adicionar ${marcadas.size} ao quadro`
                : "Adicionar ao quadro"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { ChevronDown, Users } from "lucide-react";

type Pessoa = { id: string; nome: string; is_vitor: boolean };
type TimeMember = { id: string; nome: string };

export function MeetingVisibilitySelector({
  meetingId,
  currentVisibilidade,
  pessoas,
  times,
  acessosIniciais,
  isOwner,
}: {
  meetingId: string;
  currentVisibilidade: "todos" | "so_eu" | "escolhidos";
  pessoas: Pessoa[];
  times: TimeMember[];
  acessosIniciais: Array<{ user_id?: string; time_id?: string }>;
  isOwner: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [visibilidade, setVisibilidade] = useState(currentVisibilidade);
  const [escolhidos, setEscolhidos] = useState<Array<{ user_id?: string; time_id?: string }>>(acessosIniciais);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredPessoas = pessoas.filter((p) => !p.is_vitor &&
    p.nome.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredTimes = times.filter((t) =>
    t.nome.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleVisibilidadeChange = (newVis: "todos" | "so_eu" | "escolhidos") => {
    setVisibilidade(newVis);
  };

  const togglePessoa = (pessoaId: string) => {
    setEscolhidos((prev) => {
      const exists = prev.some((e) => e.user_id === pessoaId);
      if (exists) {
        return prev.filter((e) => e.user_id !== pessoaId);
      } else {
        return [...prev, { user_id: pessoaId }];
      }
    });
  };

  const toggleTime = (timeId: string) => {
    setEscolhidos((prev) => {
      const exists = prev.some((e) => e.time_id === timeId);
      if (exists) {
        return prev.filter((e) => e.time_id !== timeId);
      } else {
        return [...prev, { time_id: timeId }];
      }
    });
  };

  const handleSave = () => {
    if (visibilidade === "escolhidos" && escolhidos.length === 0) {
      alert("Escolha pelo menos uma pessoa ou um time.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/visibilidade`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visibilidade,
            acessos: visibilidade === "escolhidos" ? escolhidos : [],
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          alert(body.error || "falha ao salvar visibilidade");
          return;
        }

        setIsOpen(false);
      } catch (e) {
        alert("Erro: " + (e instanceof Error ? e.message : String(e)));
      }
    });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isOwner) {
    return null;
  }

  const visibilidadeTexto =
    visibilidade === "todos"
      ? "Toda a Welcome pode ver"
      : visibilidade === "so_eu"
        ? "Só eu vejo"
        : escolhidos.length === 1
          ? "1 escolhido"
          : `${escolhidos.length} escolhidos`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className="inline-flex items-center gap-2 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition disabled:opacity-50 px-2 py-1.5 rounded hover:bg-[color:var(--accent)]/10"
      >
        <Users size={14} strokeWidth={1.75} />
        Quem vê: {visibilidadeTexto}
        <ChevronDown size={14} strokeWidth={1.75} className={isOpen ? "rotate-180" : ""} />
      </button>

      {isOpen && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-50 bg-[color:var(--background)] border border-[color:var(--border)] rounded-xl shadow-lg w-[min(340px,calc(100vw-2rem))]">
          <div className="p-4 space-y-4">
            {/* Opção: Toda a Welcome */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="visibilidade"
                value="todos"
                checked={visibilidade === "todos"}
                onChange={(e) => handleVisibilidadeChange(e.target.value as "todos")}
                className="w-4 h-4"
              />
              <span className="text-[13px]">Toda a Welcome pode ver</span>
            </label>

            {/* Opção: Só eu */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="visibilidade"
                value="so_eu"
                checked={visibilidade === "so_eu"}
                onChange={(e) => handleVisibilidadeChange(e.target.value as "so_eu")}
                className="w-4 h-4"
              />
              <span className="text-[13px]">Só eu vejo</span>
            </label>

            {/* Opção: Escolher pessoas e times */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="visibilidade"
                value="escolhidos"
                checked={visibilidade === "escolhidos"}
                onChange={(e) => handleVisibilidadeChange(e.target.value as "escolhidos")}
                className="w-4 h-4"
              />
              <span className="text-[13px]">Escolher pessoas e times</span>
            </label>

            {/* Lista de pessoas e times quando "escolhidos" está selecionado */}
            {visibilidade === "escolhidos" && (
              <div className="border-t border-[color:var(--border)] pt-4 space-y-3">
                <input
                  type="text"
                  placeholder="Buscar pessoa ou time..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 text-[12px] border border-[color:var(--border)] rounded-lg bg-[color:var(--background)] text-[color:var(--foreground)]"
                />

                <div className="max-h-64 overflow-y-auto space-y-2">
                  {filteredPessoas.map((pessoa) => (
                    <label
                      key={`pessoa-${pessoa.id}`}
                      className="flex items-center gap-3 cursor-pointer p-2 hover:bg-[color:var(--accent)]/5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={escolhidos.some((e) => e.user_id === pessoa.id)}
                        onChange={() => togglePessoa(pessoa.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-[12px]">{pessoa.nome}</span>
                    </label>
                  ))}

                  {filteredTimes.map((time) => (
                    <label
                      key={`time-${time.id}`}
                      className="flex items-center gap-3 cursor-pointer p-2 hover:bg-[color:var(--accent)]/5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={escolhidos.some((e) => e.time_id === time.id)}
                        onChange={() => toggleTime(time.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-[12px] font-medium">🏷️ {time.nome}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Botão de salvar */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="w-full py-2 px-3 text-[13px] font-medium bg-[color:var(--foreground)] text-[color:var(--background)] rounded-lg hover:opacity-90 transition disabled:opacity-50"
            >
              {isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

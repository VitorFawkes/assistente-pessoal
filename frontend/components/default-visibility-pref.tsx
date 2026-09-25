"use client";

import { useState, useTransition } from "react";

export function DefaultVisibilityPref({
  currentPreference,
}: {
  currentPreference: "todos" | "so_eu";
}) {
  const [isPending, startTransition] = useTransition();
  const [preference, setPreference] = useState(currentPreference);
  const [saved, setSaved] = useState(false);

  const handleChange = (newPref: "todos" | "so_eu") => {
    setPreference(newPref);
    setSaved(false);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/conta/visibilidade-padrao", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibilidade_padrao: preference }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          alert(body.error || "falha ao salvar preferência");
          return;
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        alert("Erro: " + (e instanceof Error ? e.message : String(e)));
      }
    });
  };

  const isChanged = preference !== currentPreference;

  return (
    <div className="space-y-4 rounded-2xl border border-[color:var(--border)] p-5 sm:p-6">
      <div className="space-y-2">
        <h3 className="text-[13px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
          Minhas reuniões novas nascem visíveis para:
        </h3>
        <p className="text-[12px] text-[color:var(--muted)]">
          Cada nova reunião que você grava ou faz upload herda esta configuração.
          Você pode mudar a visibilidade de cada reunião depois de criada.
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="visibilidade_padrao"
            value="so_eu"
            checked={preference === "so_eu"}
            onChange={(e) => handleChange(e.target.value as "so_eu")}
            className="w-4 h-4"
          />
          <span className="text-[13px]">Só eu vejo</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="visibilidade_padrao"
            value="todos"
            checked={preference === "todos"}
            onChange={(e) => handleChange(e.target.value as "todos")}
            className="w-4 h-4"
          />
          <span className="text-[13px]">Toda a Welcome pode ver</span>
        </label>
      </div>

      {isChanged && (
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="w-full py-2 px-3 text-[13px] font-medium bg-[color:var(--foreground)] text-[color:var(--background)] rounded-lg hover:opacity-90 transition disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar preferência"}
        </button>
      )}

      {saved && (
        <p className="text-[12px] text-[color:var(--calm)] font-medium">
          ✓ Preferência salva
        </p>
      )}
    </div>
  );
}

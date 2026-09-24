"use client";

import { useState, useTransition } from "react";
import { toggleAcesso } from "./actions";

type Pessoa = {
  nome: string;
  email: string;
  organizacao?: string;
  times?: Array<{ id: string; nome: string }>;
  liberado: boolean;
};

type Props = {
  pessoas: Pessoa[];
};

export function LiberarList({ pessoas: initialPessoas }: Props) {
  const [pessoas, setPessoas] = useState(initialPessoas);
  const [search, setSearch] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const [isPending, startTransition] = useTransition();

  // Coleta todos os times únicos
  const allTimes = new Set<string>();
  initialPessoas.forEach((p) => {
    p.times?.forEach((t) => {
      allTimes.add(t.nome);
    });
  });

  // Filtrar
  const filtered = pessoas.filter((p) => {
    const matchSearch =
      p.nome.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase());

    const matchTime =
      !filterTime ||
      (p.times?.some((t) => t.nome === filterTime) ?? false);

    return matchSearch && matchTime;
  });

  const handleToggle = (email: string, novoStatus: boolean) => {
    startTransition(async () => {
      const result = await toggleAcesso(email, novoStatus);
      if (result.success) {
        setPessoas((prev) =>
          prev.map((p) =>
            p.email === email ? { ...p, liberado: novoStatus } : p,
          ),
        );
      } else {
        console.error("erro ao atualizar acesso:", result.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Buscar por nome ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border rounded"
        />
        <select
          value={filterTime}
          onChange={(e) => setFilterTime(e.target.value)}
          className="px-3 py-2 border rounded"
        >
          <option value="">Todos os times</option>
          {Array.from(allTimes)
            .sort()
            .map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
        </select>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto border rounded">
        <table className="w-full">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Organização</th>
              <th className="px-4 py-2 text-left">Times</th>
              <th className="px-4 py-2 text-center">Liberado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-gray-500">
                  Nenhuma pessoa encontrada
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.email} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{p.nome}</td>
                  <td className="px-4 py-2 text-sm">{p.email}</td>
                  <td className="px-4 py-2 text-sm">{p.organizacao || "—"}</td>
                  <td className="px-4 py-2 text-sm">
                    {p.times && p.times.length > 0
                      ? p.times.map((t) => t.nome).join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handleToggle(p.email, !p.liberado)}
                      disabled={isPending}
                      className={`px-3 py-1 rounded text-sm font-medium transition ${
                        p.liberado
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-red-100 text-red-800 hover:bg-red-200"
                      } ${isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {p.liberado ? "Sim" : "Não"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-600 mt-4">
        Total: {filtered.length} pessoa(s) de {pessoas.length}
      </p>
    </div>
  );
}

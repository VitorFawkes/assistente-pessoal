"use client";

import { createContext, useContext } from "react";

// Quem é "você" na tela. Instância do Vitor: "Vitor" nos dois; equipe: o nome
// da pessoa (para marcar quem falou) e "Você" nos rótulos de agrupamento.
type Dono = { nome: string; rotulo: string };
const DonoCtx = createContext<Dono>({ nome: "Vitor", rotulo: "Vitor" });

export function DonoProvider({ value, children }: { value: Dono; children: React.ReactNode }) {
  return <DonoCtx.Provider value={value}>{children}</DonoCtx.Provider>;
}

export function useDono(): Dono {
  return useContext(DonoCtx);
}

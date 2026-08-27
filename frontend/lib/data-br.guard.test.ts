import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A TRAVA do "horário de Brasília SEMPRE, em toda a plataforma".
//
// Não adianta consertar os 72 pontos de hoje se amanhã alguém escreve
// `new Date().getDate()` de novo. Este teste varre o código e QUEBRA se
// aparecer data lida no fuso de quem está rodando (servidor em UTC, pessoa
// viajando, convidado no exterior).
//
// Achou um caso novo e legítimo? Não silencie: use os ajudantes de
// `lib/data-br.ts`. Se de fato não der, entre aqui na lista com o motivo —
// assim a exceção fica escrita e revisada, não escondida.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASTAS = ["app", "components", "lib"];

// Métodos que respondem no fuso de QUEM RODA, não no de Brasília.
const PROIBIDO =
  /\.(getHours|getMinutes|getDate|getMonth|getFullYear|getDay)\(\)|toLocale(Date|Time)?String\(/;

/** Onde o fuso local é inofensivo — cada um conferido na mão em 26/08/2026. */
const LIBERADOS: Record<string, string> = {
  "lib/data-br.ts":
    "é o próprio módulo: aqui é onde o fuso de Brasília é aplicado",
  "components/mini-calendar.tsx":
    "desenha o calendário sobre um Date que já veio de relogioBR(), ou seja, já está em Brasília",
  "lib/task-filters.ts":
    "usa nowSP()/toSP(), que já devolvem o relógio de Brasília",
  "components/date-filter.tsx":
    "usa nowSP()/toSP(), que já devolvem o relógio de Brasília",
  "components/created-filter.tsx":
    "usa nowSP()/toSP(), que já devolvem o relógio de Brasília",
  "components/tasks-dashboard.tsx":
    "usa nowSP()/toSP(), que já devolvem o relógio de Brasília",
  "components/date-field.tsx":
    "só monta e lê 'yyyy-MM-dd' como texto; nunca vira instante, então o fuso não entra",
  "app/api/capturar/route.ts":
    "passa timeZone explícito no toLocaleDateString",
};

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && !nome.includes(".test.")) saida.push(caminho);
  }
  return saida;
}

describe("trava do horário de Brasília", () => {
  test("nenhum arquivo novo lê data no fuso de quem está rodando", () => {
    const infratores: string[] = [];

    for (const pasta of PASTAS) {
      for (const caminho of arquivos(join(RAIZ, pasta))) {
        const relativo = caminho.slice(RAIZ.length + 1);
        if (LIBERADOS[relativo]) continue;
        const linhas = readFileSync(caminho, "utf8").split("\n");
        linhas.forEach((linha, i) => {
          if (PROIBIDO.test(linha)) infratores.push(`${relativo}:${i + 1} → ${linha.trim()}`);
        });
      }
    }

    if (infratores.length) {
      throw new Error(
        "Data lida no fuso local (o servidor roda em UTC!). Use lib/data-br.ts:\n\n" +
          infratores.join("\n") +
          "\n\nSe for caso legítimo, some à lista LIBERADOS deste teste com o motivo.",
      );
    }
    expect(infratores).toEqual([]);
  });

  test("a lista de liberados não tem arquivo que sumiu", () => {
    const sumidos = Object.keys(LIBERADOS).filter((rel) => {
      try {
        statSync(join(RAIZ, rel));
        return false;
      } catch {
        return true;
      }
    });
    expect(sumidos).toEqual([]);
  });

  test("todo liberado tem motivo escrito", () => {
    for (const [arquivo, motivo] of Object.entries(LIBERADOS)) {
      expect(motivo.length, `${arquivo} sem motivo`).toBeGreaterThan(20);
    }
  });
});

// Conversas do Assistente guardadas no servidor (Vitor, 02/10/2026: "faz" na proposta de guardar pergunta e resposta
// para achar os erros reais; ficam só no servidor, sem tela). Uma linha JSON por pergunta, um arquivo por mês, na pasta
// ASSISTENTE_CONVERSAS_DIR (volume próprio no servidor). Sem a variável (bateria, máquina local), não guarda nada.
// Guardar é ajuda: se falhar, a resposta segue.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hojeBR } from "./data-br";

export async function guardarConversa(linha: Record<string, unknown>): Promise<void> {
  const pasta = process.env.ASSISTENTE_CONVERSAS_DIR;
  if (!pasta) return;
  try {
    await mkdir(pasta, { recursive: true });
    await appendFile(join(pasta, `${hojeBR().slice(0, 7)}.jsonl`), `${JSON.stringify(linha)}\n`);
  } catch (e) {
    console.error("[agente] guardar a conversa:", e);
  }
}

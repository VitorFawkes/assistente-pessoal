// Nome dito ("Paula", "a Ana Tereza") → pessoa da Welcome. Regras puras, testadas em
// pessoa-por-nome.test.ts. Nunca chuta: com duas "Maria", devolve as duas e quem pediu escolhe.
import { slugNome } from "./compartilhar";

export type PessoaNomeada = { email: string; nome: string };
export type Achado<P extends PessoaNomeada> = { pessoa: P } | { ambiguas: P[] } | null;

const ARTIGO = /^(?:o|a|os|as|pro|pra|para|com|do|da|de)-/;
const EU = new Set(["eu", "mim", "comigo", "me", "voce", "voces"]);

export function ehEu(nome: string | null | undefined): boolean {
  return EU.has(slugNome(nome));
}

export function acharPessoaPorNome<P extends PessoaNomeada>(nome: string | null | undefined, pessoas: P[]): Achado<P> {
  let alvo = slugNome(nome);
  while (ARTIGO.test(alvo)) alvo = alvo.replace(ARTIGO, "");
  if (!alvo || alvo === "?") return null;
  const inteiras = pessoas.filter((p) => slugNome(p.nome) === alvo);
  if (inteiras.length === 1) return { pessoa: inteiras[0] };
  if (inteiras.length > 1) return { ambiguas: inteiras };
  const partes = alvo.split("-");
  // "Ana Tereza" casa com "Ana Tereza Souza"; "Paula" casa com "Paula Klotz".
  const comeca = pessoas.filter((p) => {
    const s = slugNome(p.nome).split("-");
    return partes.every((x, i) => s[i] === x);
  });
  if (comeca.length === 1) return { pessoa: comeca[0] };
  if (comeca.length > 1) return { ambiguas: comeca };
  // Primeiro nome + sobrenome solto ("Paula Klotz" quando o cadastro é "Paula Maria Klotz").
  if (partes.length > 1) {
    const soltas = pessoas.filter((p) => {
      const s = slugNome(p.nome).split("-");
      return s[0] === partes[0] && partes.slice(1).every((x) => s.includes(x));
    });
    if (soltas.length === 1) return { pessoa: soltas[0] };
    if (soltas.length > 1) return { ambiguas: soltas };
  }
  return null;
}

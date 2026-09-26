// "Speaker A" → o nome que a pessoa escolheu em "Quem falou".
//
// A IA escreve tarefas e resumo antes de alguém dizer quem é cada voz, e o reprocesso depois
// dos nomes não reescreve o texto. A troca é direta (sem IA): só a letra que tem nome muda.

const FALANTE = /\b(?:speaker|falante|locutor)\s+([A-Z]{1,2})\b/gi;

export function trocarFalantes(texto: string, labels: Record<string, string> | null | undefined): string;
export function trocarFalantes(texto: null | undefined, labels: Record<string, string> | null | undefined): null;
export function trocarFalantes(texto: string | null | undefined, labels: Record<string, string> | null | undefined): string | null;
export function trocarFalantes(texto: string | null | undefined, labels: Record<string, string> | null | undefined) {
  if (texto == null) return null;
  if (!labels) return texto;
  return texto.replace(FALANTE, (inteiro, letra: string) => {
    const nome = (labels[letra.toUpperCase()] ?? "").trim();
    return nome && !/^speaker\b/i.test(nome) ? nome : inteiro;
  });
}

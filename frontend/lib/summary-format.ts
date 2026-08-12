// O resumo executivo chega em markdown "de IA": seções escritas como
// **Título:** e itens em bullets (sub-níveis por indentação) — o mesmo formato
// que `ExecutiveSummary` desenha na tela. Aqui ele vira arquivo: .txt pra ler
// e colar em qualquer lugar, .md pra Notion/Claude manterem a hierarquia.

const HEADING_RE = /^\*\*([^*:]+):\*\*\s*(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;

/** Tira os marcadores de negrito, mantendo o texto. */
export function stripBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

function normalize(lines: string[]): string {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Resumo em texto puro: seção em CAIXA ALTA, item com "- ". */
export function summaryToPlainText(md: string): string {
  const out: string[] = [];
  for (const raw of (md || "").replace(/\r/g, "").split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      out.push("");
      continue;
    }

    const heading = trimmed.match(HEADING_RE);
    if (heading && !BULLET_RE.test(raw)) {
      const [, title, rest] = heading;
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(title.trim().toUpperCase());
      if (rest.trim()) out.push(stripBold(rest.trim()));
      continue;
    }

    const bullet = raw.match(BULLET_RE);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "  ");
      out.push(`${indent}- ${stripBold(bullet[2].trim())}`);
      continue;
    }

    out.push(stripBold(trimmed));
  }
  return normalize(out);
}

/** Resumo em markdown de verdade: "**Título:**" vira "## Título". */
export function summaryToMarkdown(md: string): string {
  const out: string[] = [];
  for (const raw of (md || "").replace(/\r/g, "").split("\n")) {
    const trimmed = raw.trim();

    const heading = trimmed.match(HEADING_RE);
    if (heading && !BULLET_RE.test(raw)) {
      const [, title, rest] = heading;
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(`## ${title.trim()}`);
      out.push("");
      if (rest.trim()) out.push(rest.trim());
      continue;
    }

    out.push(raw.trimEnd());
  }
  return normalize(out);
}

import React from "react";

// Renderizador de Markdown minimalista: monta elementos React a partir do texto
// (sem injeção de HTML). Cobre o que o agente costuma produzir:
// **negrito**, *itálico*, `código`, listas (- / numeradas) e títulos (#, ##).

function renderInline(text: string, kp: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    if (m[2] !== undefined) nodes.push(<strong key={`${kp}b${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      nodes.push(
        <code key={`${kp}c${i}`} className="px-1 py-0.5 rounded bg-accent text-[0.85em] font-mono">
          {m[3]}
        </code>,
      );
    else if (m[4] !== undefined) nodes.push(<em key={`${kp}i${i}`}>{m[4]}</em>);
    else if (m[5] !== undefined) nodes.push(<em key={`${kp}i${i}`}>{m[5]}</em>);
    last = idx + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  const isUl = (s: string) => /^\s*[-*•]\s+/.test(s);
  const isOl = (s: string) => /^\s*\d+[.)]\s+/.test(s);
  const isH = (s: string) => /^#{1,3}\s+/.test(s);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={k++} className="font-semibold mt-1.5 first:mt-0">
          {renderInline(h[2], `h${k}`)}
        </p>,
      );
      i++;
      continue;
    }
    if (isUl(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && isUl(lines[i])) {
        items.push(
          <li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*•]\s+/, ""), `u${k}-${items.length}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ul key={k++} className="list-disc pl-5 space-y-0.5 my-1">
          {items}
        </ul>,
      );
      continue;
    }
    if (isOl(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(
          <li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""), `o${k}-${items.length}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ol key={k++} className="list-decimal pl-5 space-y-0.5 my-1">
          {items}
        </ol>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isUl(lines[i]) && !isOl(lines[i]) && !isH(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++} className="my-0.5">
        {para.map((l, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(l, `p${k}-${idx}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-1 leading-relaxed">{blocks}</div>;
}

import type { ReactNode } from "react";

const HEADING_RE = /^\*\*([^*:]+):\*\*\s*(.*)$/;

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(<strong key={key++}>{m[1]}</strong>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

export function ExecutiveSummary({ md }: { md: string }) {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let currentList: string[] = [];
  let key = 0;

  function flushList() {
    if (currentList.length === 0) return;
    blocks.push(
      <ul
        key={key++}
        className="list-disc pl-5 space-y-1 text-[14px] leading-relaxed text-[color:var(--foreground)]"
      >
        {currentList.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    currentList = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushList();
      const [, title, rest] = headingMatch;
      blocks.push(
        <h3
          key={key++}
          className="text-[11px] tracking-[0.18em] uppercase text-[color:var(--muted-strong)] mt-4 first:mt-0"
        >
          {title}
        </h3>,
      );
      if (rest) {
        blocks.push(
          <p
            key={key++}
            className="text-[14px] leading-relaxed text-[color:var(--foreground)]"
          >
            {renderInline(rest)}
          </p>,
        );
      }
    } else if (line.startsWith("- ")) {
      currentList.push(line.slice(2));
    } else if (line === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p
          key={key++}
          className="text-[14px] leading-relaxed text-[color:var(--foreground)]"
        >
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}

import type { ReactNode } from "react";

const HEADING_RE = /^\*\*([^*:]+):\*\*\s*(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;

function renderInline(text: string): ReactNode[] {
  // Split on **bold** spans — captured groups land on odd indices.
  const segments = text.split(/\*\*(.+?)\*\*/g);
  return segments.map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[color:var(--foreground)]">
        {seg}
      </strong>
    ) : (
      seg
    ),
  );
}

type Item = { text: string; children: Item[] };

const MARKERS = ["list-disc", "list-[circle]", "list-[square]"];

function List({ items, depth }: { items: Item[]; depth: number }) {
  const marker = MARKERS[Math.min(depth, MARKERS.length - 1)];
  return (
    <ul
      className={`${marker} pl-5 space-y-1 text-[14px] leading-relaxed text-[color:var(--foreground)] ${
        depth > 0 ? "mt-1" : ""
      }`}
    >
      {items.map((item, i) => (
        <li key={i} className="marker:text-[color:var(--muted-strong)]">
          {renderInline(item.text)}
          {item.children.length > 0 && <List items={item.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function ExecutiveSummary({ md }: { md: string }) {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;

  // Bullets accumulate into a nested tree for the current section; a new
  // heading (or a plain paragraph) flushes it. Blank lines do NOT reset the
  // tree — sibling groups within a section are often separated by them.
  let roots: Item[] = [];
  const stack: { level: number; item: Item }[] = [];

  function flushList() {
    if (roots.length === 0) return;
    blocks.push(<List key={key++} items={roots} depth={0} />);
    roots = [];
    stack.length = 0;
  }

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch && !BULLET_RE.test(raw)) {
      flushList();
      const [, title, rest] = headingMatch;
      blocks.push(
        <h3
          key={key++}
          className="text-[11px] tracking-[0.18em] uppercase text-[color:var(--muted-strong)] mt-5 first:mt-0"
        >
          {title}
        </h3>,
      );
      if (rest) {
        blocks.push(
          <p key={key++} className="text-[14px] leading-relaxed text-[color:var(--foreground)]">
            {renderInline(rest)}
          </p>,
        );
      }
      continue;
    }

    const bulletMatch = raw.match(BULLET_RE);
    if (bulletMatch) {
      const level = Math.floor(bulletMatch[1].replace(/\t/g, "  ").length / 2);
      const item: Item = { text: bulletMatch[2], children: [] };
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length === 0) roots.push(item);
      else stack[stack.length - 1].item.children.push(item);
      stack.push({ level, item });
      continue;
    }

    flushList();
    blocks.push(
      <p key={key++} className="text-[14px] leading-relaxed text-[color:var(--foreground)]">
        {renderInline(trimmed)}
      </p>,
    );
  }
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}

import type { ReactNode } from "react";
import { ProximosPassosList } from "./proximos-passos";

const HEADING_RE = /^\*\*([^*:]+):\*\*\s*(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;

// seções acionáveis (botão "+ tarefa" por item): "Próximos passos" e
// "Decisões e alinhamentos" — com ou sem acento.
const isActionableSection = (title: string) => {
  const t = title.toLowerCase().trim();
  return (
    t.startsWith("próximos passos") ||
    t.startsWith("proximos passos") ||
    t.startsWith("decisões e alinhamentos") ||
    t.startsWith("decisoes e alinhamentos")
  );
};

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

export type Item = { text: string; children: Item[] };

// A IA escreve os subgrupos como bullet solto ("- Site / Landing pages / UX")
// seguido dos itens daquele subgrupo no MESMO nível, separando cada grupo por
// linha em branco. Sem tratar isso, a seção inteira vira uma lista chapada de
// 200 marcadores onde nada se destaca. Aqui o primeiro item de cada bloco vira
// título do bloco quando parece um rótulo: curto, sem pontuação final e com
// irmãos abaixo dele.
const MAX_ROTULO = 64;

export function pareceRotulo(item: Item, irmaosAbaixo: number): boolean {
  if (irmaosAbaixo === 0) return false;
  if (item.children.length > 0) return false;
  const t = item.text.trim();
  if (t.length === 0 || t.length > MAX_ROTULO) return false;
  if (/[.;:!?]$/.test(t)) return false;
  // Frase inteira (com verbo conjugado) quase nunca é rótulo de grupo.
  return t.split(/\s+/).length <= 9;
}

/** Agrupa cada bloco (separado por linha em branco) sob o seu rótulo. */
export function aninharPorBloco(blocos: Item[][]): Item[] {
  const out: Item[] = [];
  for (const bloco of blocos) {
    if (bloco.length === 0) continue;
    const [primeiro, ...resto] = bloco;
    if (pareceRotulo(primeiro, resto.length)) {
      out.push({ text: primeiro.text, children: resto });
    } else {
      out.push(...bloco);
    }
  }
  return out;
}

const MARKERS = ["list-disc", "list-[circle]", "list-[square]"];

function List({ items, depth }: { items: Item[]; depth: number }) {
  const marker = MARKERS[Math.min(depth, MARKERS.length - 1)];
  // No primeiro nível, um item com filhos é o rótulo do subgrupo: vira
  // subtítulo em vez de mais um marcador igual aos outros.
  if (depth === 0) {
    return (
      <div className="space-y-2.5">
        {items.map((item, i) =>
          item.children.length > 0 ? (
            <div key={i}>
              <p className="text-[13px] font-semibold text-[color:var(--foreground)]">
                {renderInline(item.text)}
              </p>
              <List items={item.children} depth={1} />
            </div>
          ) : (
            <ul
              key={i}
              className="list-disc pl-5 text-[14px] leading-relaxed text-[color:var(--foreground)]"
            >
              <li className="marker:text-[color:var(--muted-strong)]">
                {renderInline(item.text)}
              </li>
            </ul>
          ),
        )}
      </div>
    );
  }
  return (
    <ul
      className={`${marker} pl-5 space-y-1 text-[14px] leading-relaxed text-[color:var(--foreground)] mt-1`}
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

export function ExecutiveSummary({ md, meetingId }: { md: string; meetingId?: string }) {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;

  // Bullets accumulate into a nested tree for the current section; a new
  // heading (or a plain paragraph) flushes it. Linha em branco não fecha a
  // seção — ela separa os subgrupos dentro dela, e é isso que dá a hierarquia.
  let roots: Item[] = [];
  let blocos: Item[][] = [];
  const stack: { level: number; item: Item }[] = [];
  let currentSection = "";

  function fecharBloco() {
    if (roots.length > 0) blocos.push(roots);
    roots = [];
    stack.length = 0;
  }

  function flushList() {
    fecharBloco();
    if (blocos.length === 0) return;
    const flat = blocos.flat();
    // Em "Próximos passos" e "Decisões e alinhamentos", cada item ganha botão
    // "+ tarefa" (1 clique) — ali a lista fica chapada de propósito, pra que
    // 1 passo continue virando 1 tarefa.
    if (meetingId && isActionableSection(currentSection)) {
      blocks.push(<ProximosPassosList key={key++} items={flat} meetingId={meetingId} />);
    } else {
      blocks.push(<List key={key++} items={aninharPorBloco(blocos)} depth={0} />);
    }
    blocos = [];
  }

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      fecharBloco();
      continue;
    }

    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch && !BULLET_RE.test(raw)) {
      flushList();
      const [, title, rest] = headingMatch;
      currentSection = title;
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

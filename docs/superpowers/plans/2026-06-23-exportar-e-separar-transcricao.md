# Exportar transcrição + separar por mudança de assunto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir baixar a transcrição de uma reunião em vários formatos e, lendo a transcrição, marcar manualmente onde o assunto muda — virando reuniões separadas ou seções dentro da mesma reunião.

**Architecture:** Tudo nasce dentro da transcrição (`TranscriptionView`), espelhando o affordance por-turn que já existe (`MoveTurnMenu`). Export é uma rota nova + um módulo puro de formatação testável. "Separar" reusa o endpoint `PATCH /api/meetings/[id]/segments` existente, só relaxando o piso de duração para cortes manuais. "Seções" é uma coluna JSONB nova, não-destrutiva.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19 (client components), Postgres + RLS (`withTenant`), TypeScript, testes com `bun:test` (rodar `bun test`). Migrations SQL idempotentes aplicadas manualmente (sem migration tool).

**Spec:** [`docs/superpowers/specs/2026-06-23-exportar-e-separar-transcricao-design.md`](../specs/2026-06-23-exportar-e-separar-transcricao-design.md)

---

## File Structure

**Criar:**
- `db/0017_meeting_sections.sql` — coluna `meetings.sections JSONB`
- `frontend/lib/transcript-format.ts` — formatadores puros (txt/srt/vtt/md) + helpers compartilhados (`groupTurns`, `coerceSegments`, `filterBySection`)
- `frontend/lib/transcript-format.test.ts` — testes dos formatadores (`bun:test`)
- `frontend/app/api/meetings/[id]/export/route.ts` — `GET` export multi-formato
- `frontend/app/api/meetings/[id]/sections/route.ts` — `PATCH` salva seções
- `frontend/components/transcript-export-menu.tsx` — botão "Baixar / exportar" (client)
- `frontend/app/reunioes/[id]/imprimir/page.tsx` — view limpa pra imprimir→PDF
- `frontend/components/cut-bar.tsx` — barra flutuante de cortes pendentes (client)

**Modificar:**
- `frontend/lib/detect-cuts.ts` — `MIN_MANUAL_SEGMENT_DURATION` + `validateManualCuts()` (testável)
- `frontend/lib/queries.ts` — `sections` em `byIdDetailed`; `forExport()`; `updateSections()`
- `frontend/app/reunioes/[id]/page.tsx` — botão de export no header da transcrição; passar `sections`
- `frontend/components/transcription-view.tsx` — `groupTurns` importado do módulo novo; divisores de seção; affordance de corte/seção por turn; barra flutuante
- `frontend/app/api/meetings/[id]/segments/route.ts` — flag `allow_short`
- `db/README.md` — linha da 0017 na tabela de ordem

**Convenções obrigatórias (de `frontend/AGENTS.md`):**
- Toda rota nova: `withAuth(...)` + `withTenant(user.id, ...)`. Nunca `query()` direto em `meetings`.
- Páginas que leem sessão: `export const dynamic = "force-dynamic"`.
- `params` é `Promise` no Next 16: `const { id } = await params`.

---

# FASE 0 — Pré-requisito: migration

### Task 1: Coluna `sections` em meetings

**Files:**
- Create: `db/0017_meeting_sections.sql`
- Modify: `db/README.md`

- [ ] **Step 1: Escrever a migration**

`db/0017_meeting_sections.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────
-- Seções de assunto dentro de UMA reunião (não-destrutivo).
-- Array ordenado [{ "start_seconds": number, "title": string }].
-- A primeira seção é implícita (começa em 0); só marca-se onde NASCE
-- uma seção nova. Idempotente. Aplicar manual via dbgate/pgweb/psql.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN meetings.sections IS
  'Marcadores de seção de assunto: [{start_seconds, title}] ordenado. [] = sem seções. Não-destrutivo (só organização visual + export por seção).';
```

- [ ] **Step 2: Aplicar no banco (Postgres interno do swarm)**

⚠️ O Postgres de produção **não é alcançável por `psql` local** — é host interno do swarm. Aplicar via `sshpass` + `docker exec` no container `n8n_assistente-pessoal-db` (ver memória `assistente-db-access`: `POSTGRES_USER=assistente`, `DB=assistente_pessoal`; credenciais SSH em `.env`). Padrão:

```bash
source .env
# Copiar o SQL pra dentro do container e aplicar via psql local ao container:
sshpass -p "$VPS_PASSWORD" ssh "$VPS_USER@$VPS_HOST" \
  "docker exec -i \$(docker ps -qf name=n8n_assistente-pessoal-db) \
   psql -U assistente -d assistente_pessoal -v ON_ERROR_STOP=1" \
  < db/0017_meeting_sections.sql
```
Expected: `ALTER TABLE` / `COMMENT`. Idempotente — re-rodar não falha.

> Alternativa, se preferir: usar dbgate/pgweb apontando pro container, ou o endpoint temporário `/api/admin/sql`. O importante é **não** assumir `DATABASE_URL` local.

- [ ] **Step 3: Verificar a coluna**

Run (mesmo caminho do Step 2, com a query):
```bash
sshpass -p "$VPS_PASSWORD" ssh "$VPS_USER@$VPS_HOST" \
  "docker exec -i \$(docker ps -qf name=n8n_assistente-pessoal-db) \
   psql -U assistente -d assistente_pessoal -c \"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='meetings' AND column_name='sections';\""
```
Expected: uma linha `sections | jsonb`.

- [ ] **Step 4: Atualizar o README**

Em `db/README.md`, na tabela "Ordem de aplicação", adicionar a linha após a 0016:

```markdown
| 0017 | `0017_meeting_sections.sql` | Adiciona `meetings.sections JSONB` (seções de assunto não-destrutivas) |
```

- [ ] **Step 5: Commit**

```bash
git add db/0017_meeting_sections.sql db/README.md
git commit -m "feat(db): coluna meetings.sections (seções de assunto)"
```

---

# FASE A — Exportar / baixar

### Task 2: Módulo de formatação — texto puro (`.txt`)

**Files:**
- Create: `frontend/lib/transcript-format.ts`
- Test: `frontend/lib/transcript-format.test.ts`

- [ ] **Step 1: Escrever os testes (falham)**

`frontend/lib/transcript-format.test.ts`:

```ts
import { expect, test, describe } from "bun:test";
import {
  groupTurns,
  coerceSegments,
  speakerName,
  fmtClock,
  toPlainText,
  type Segment,
} from "./transcript-format";

const segs: Segment[] = [
  { speaker: "A", start: 0, end: 3, text: "Oi pessoal. " },
  { speaker: "A", start: 3, end: 5, text: "Vamos começar. " },
  { speaker: "B", start: 6, end: 9, text: "Bora. " },
  { speaker: "A", start: 65, end: 70, text: "Próximo ponto. " },
];

describe("groupTurns", () => {
  test("agrupa segmentos consecutivos do mesmo speaker", () => {
    const turns = groupTurns(segs);
    expect(turns).toHaveLength(3);
    expect(turns[0].speaker).toBe("A");
    expect(turns[0].text).toBe("Oi pessoal. Vamos começar. ");
    expect(turns[0].segmentIndices).toEqual([0, 1]);
    expect(turns[1].speaker).toBe("B");
    expect(turns[2].start).toBe(65);
  });

  test("lista vazia pra entrada vazia", () => {
    expect(groupTurns([])).toEqual([]);
  });
});

describe("coerceSegments", () => {
  test("aceita array direto", () => {
    expect(coerceSegments(segs)).toHaveLength(4);
  });
  test("parseia string JSON", () => {
    expect(coerceSegments(JSON.stringify(segs))).toHaveLength(4);
  });
  test("retorna [] pra lixo", () => {
    expect(coerceSegments(null)).toEqual([]);
    expect(coerceSegments("oi")).toEqual([]);
  });
});

describe("speakerName", () => {
  test("usa label quando existe", () => {
    expect(speakerName("A", { A: "Vitor" })).toBe("Vitor");
  });
  test("fallback Speaker X", () => {
    expect(speakerName("B", { A: "Vitor" })).toBe("Speaker B");
  });
});

describe("fmtClock", () => {
  test("mm:ss abaixo de 1h", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(65)).toBe("1:05");
  });
  test("h:mm:ss acima de 1h", () => {
    expect(fmtClock(3725)).toBe("1:02:05");
  });
});

describe("toPlainText", () => {
  test("uma linha por turn com nome e horário", () => {
    const out = toPlainText(segs, { A: "Vitor", B: "Marcelo" });
    expect(out).toBe(
      "[0:00] Vitor: Oi pessoal. Vamos começar.\n" +
        "[0:06] Marcelo: Bora.\n" +
        "[1:05] Vitor: Próximo ponto.",
    );
  });
  test("fallback Speaker X sem labels", () => {
    const out = toPlainText([{ speaker: "A", start: 0, end: 1, text: "oi" }], {});
    expect(out).toBe("[0:00] Speaker A: oi");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: FAIL — `Cannot find module './transcript-format'`.

- [ ] **Step 3: Implementar o módulo (parte txt)**

`frontend/lib/transcript-format.ts`:

```ts
export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type Turn = {
  speaker: string;
  start: number;
  end: number;
  text: string;
  segmentIndices: number[];
};

export type Section = { start_seconds: number; title: string };

export function groupTurns(segments: Segment[]): Turn[] {
  if (!segments?.length) return [];
  const turns: Turn[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) {
      last.end = s.end;
      last.text += s.text;
      last.segmentIndices.push(i);
    } else {
      turns.push({
        speaker: s.speaker,
        start: s.start,
        end: s.end,
        text: s.text,
        segmentIndices: [i],
      });
    }
  }
  return turns;
}

export function coerceSegments(raw: unknown): Segment[] {
  if (Array.isArray(raw)) return raw as Segment[];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Segment[];
    } catch {
      // fall through
    }
  }
  return [];
}

export function speakerName(letter: string, labels: Record<string, string>): string {
  return labels[letter] || `Speaker ${letter}`;
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function toPlainText(segments: Segment[], labels: Record<string, string>): string {
  return groupTurns(segments)
    .map((t) => `[${fmtClock(t.start)}] ${speakerName(t.speaker, labels)}: ${t.text.trim()}`)
    .join("\n");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: PASS (todos os blocos `groupTurns`/`coerceSegments`/`speakerName`/`fmtClock`/`toPlainText`).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/transcript-format.ts frontend/lib/transcript-format.test.ts
git commit -m "feat(export): formatador de transcrição em texto puro (.txt)"
```

---

### Task 3: Formatadores `.srt` e `.vtt`

**Files:**
- Modify: `frontend/lib/transcript-format.ts`
- Test: `frontend/lib/transcript-format.test.ts`

- [ ] **Step 1: Adicionar testes (falham)**

Acrescentar ao final de `frontend/lib/transcript-format.test.ts`:

```ts
import { toSrt, toVtt } from "./transcript-format";

describe("toSrt", () => {
  test("um bloco por segmento com timestamp srt e nome", () => {
    const out = toSrt(
      [
        { speaker: "A", start: 0, end: 2.5, text: "Oi" },
        { speaker: "B", start: 3, end: 4.2, text: "Bora" },
      ],
      { A: "Vitor", B: "Marcelo" },
    );
    expect(out).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\nVitor: Oi\n\n" +
        "2\n00:00:03,000 --> 00:00:04,200\nMarcelo: Bora\n",
    );
  });
});

describe("toVtt", () => {
  test("cabeçalho WEBVTT + timestamps com ponto", () => {
    const out = toVtt([{ speaker: "A", start: 0, end: 2.5, text: "Oi" }], { A: "Vitor" });
    expect(out).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nVitor: Oi\n");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: FAIL — `toSrt`/`toVtt` não existem.

- [ ] **Step 3: Implementar**

Acrescentar a `frontend/lib/transcript-format.ts`:

```ts
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(seconds: number, sep: "," | "."): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}${sep}${String(ms).padStart(3, "0")}`;
}

export function toSrt(segments: Segment[], labels: Record<string, string>): string {
  return segments
    .map((seg, i) => {
      const line = `${speakerName(seg.speaker, labels)}: ${seg.text.trim()}`;
      return `${i + 1}\n${stamp(seg.start, ",")} --> ${stamp(seg.end, ",")}\n${line}\n`;
    })
    .join("\n");
}

export function toVtt(segments: Segment[], labels: Record<string, string>): string {
  const body = segments
    .map((seg) => {
      const line = `${speakerName(seg.speaker, labels)}: ${seg.text.trim()}`;
      return `${stamp(seg.start, ".")} --> ${stamp(seg.end, ".")}\n${line}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/transcript-format.ts frontend/lib/transcript-format.test.ts
git commit -m "feat(export): formatadores .srt e .vtt"
```

---

### Task 4: Formatador `.md` + filtro por seção

**Files:**
- Modify: `frontend/lib/transcript-format.ts`
- Test: `frontend/lib/transcript-format.test.ts`

- [ ] **Step 1: Adicionar testes (falham)**

Acrescentar a `frontend/lib/transcript-format.test.ts`:

```ts
import { toMarkdown, filterBySection, type Section } from "./transcript-format";

describe("toMarkdown", () => {
  test("cabeçalho com título, data, participantes + corpo", () => {
    const out = toMarkdown(
      [
        { speaker: "A", start: 0, end: 3, text: "Oi" },
        { speaker: "B", start: 4, end: 6, text: "Bora" },
      ],
      { A: "Vitor", B: "Marcelo" },
      { title: "Reunião X", dateLabel: "23/06/2026", participants: ["Vitor", "Marcelo"] },
    );
    expect(out).toBe(
      "# Reunião X\n\n" +
        "**Data:** 23/06/2026  \n" +
        "**Participantes:** Vitor, Marcelo\n\n" +
        "---\n\n" +
        "**[0:00] Vitor:** Oi\n\n" +
        "**[0:04] Marcelo:** Bora\n",
    );
  });
});

describe("filterBySection", () => {
  const segs: Segment[] = [
    { speaker: "A", start: 0, end: 10, text: "intro" },
    { speaker: "A", start: 60, end: 70, text: "financeiro" },
    { speaker: "A", start: 130, end: 140, text: "contratação" },
  ];
  const sections: Section[] = [
    { start_seconds: 0, title: "Abertura" },
    { start_seconds: 60, title: "Financeiro" },
    { start_seconds: 120, title: "Contratação" },
  ];
  test("seção do meio pega só os segmentos do intervalo", () => {
    const out = filterBySection(segs, sections, 1, 200);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("financeiro");
  });
  test("última seção vai até a duração", () => {
    const out = filterBySection(segs, sections, 2, 200);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("contratação");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: FAIL — `toMarkdown`/`filterBySection` não existem.

- [ ] **Step 3: Implementar**

Acrescentar a `frontend/lib/transcript-format.ts`:

```ts
export function toMarkdown(
  segments: Segment[],
  labels: Record<string, string>,
  meta: { title: string; dateLabel: string; participants: string[] },
): string {
  const head =
    `# ${meta.title}\n\n` +
    `**Data:** ${meta.dateLabel}  \n` +
    `**Participantes:** ${meta.participants.join(", ")}\n\n` +
    `---\n\n`;
  const body = groupTurns(segments)
    .map((t) => `**[${fmtClock(t.start)}] ${speakerName(t.speaker, labels)}:** ${t.text.trim()}`)
    .join("\n\n");
  return `${head}${body}\n`;
}

/** Segmentos cujo start cai no intervalo da seção `index` (sorted por start_seconds). */
export function filterBySection(
  segments: Segment[],
  sections: Section[],
  index: number,
  duration: number,
): Segment[] {
  const sorted = [...sections].sort((a, b) => a.start_seconds - b.start_seconds);
  const start = sorted[index]?.start_seconds ?? 0;
  const end = sorted[index + 1]?.start_seconds ?? duration;
  return segments.filter((s) => s.start >= start && s.start < end);
}

/** Nomes distintos dos speakers (resolvidos), na ordem de aparição. */
export function participantNames(
  segments: Segment[],
  labels: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segments) {
    const name = speakerName(s.speaker, labels);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && bun test lib/transcript-format.test.ts`
Expected: PASS (módulo completo).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/transcript-format.ts frontend/lib/transcript-format.test.ts
git commit -m "feat(export): formatador .md + filtro por seção + participantes"
```

---

### Task 5: Query `forExport` + `sections` em `byIdDetailed`

**Files:**
- Modify: `frontend/lib/queries.ts`

- [ ] **Step 1: Adicionar `sections` ao `byIdDetailed`**

Em `frontend/lib/queries.ts`, no método `byIdDetailed` (≈ linha 180): adicionar `sections` ao tipo de retorno e ao SELECT.

No objeto de tipo do `db.query<{...}>` (após `speaker_labels_proposed`), acrescentar:
```ts
        sections: unknown;
```
No SQL, trocar a última linha de colunas:
```sql
           speaker_labels, speaker_labels_proposed
```
por:
```sql
           speaker_labels, speaker_labels_proposed, sections
```

- [ ] **Step 2: Adicionar os métodos `forExport` e `updateSections`**

Em `frontend/lib/queries.ts`, dentro de `meetingsFor`, logo após o `byIdDetailed`, inserir:

```ts
  /** Dados crus pra export (segments, labels, summary, recorded_at ISO, sections). */
  forExport: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        summary: string | null;
        duration_seconds: number | null;
        recorded_at: string | null;
        segments: unknown;
        speaker_labels: Record<string, string> | null;
        sections: unknown;
      }>(
        `SELECT summary, duration_seconds,
                to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
                segments, speaker_labels, sections
         FROM meetings WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Salva o array completo de seções (replace). Retorna a linha atualizada ou null. */
  updateSections: (id: string, sections: { start_seconds: number; title: string }[]) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string }>(
        `UPDATE meetings SET sections = $2::jsonb WHERE id = $1 RETURNING id`,
        [id, JSON.stringify(sections)],
      );
      return r.rows[0] ?? null;
    }),
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: sem erros novos relacionados a `queries.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/queries.ts
git commit -m "feat(export): forExport + updateSections + sections em byIdDetailed"
```

---

### Task 6: Rota `GET /api/meetings/[id]/export`

**Files:**
- Create: `frontend/app/api/meetings/[id]/export/route.ts`

- [ ] **Step 1: Implementar a rota**

`frontend/app/api/meetings/[id]/export/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import {
  coerceSegments,
  toPlainText,
  toSrt,
  toVtt,
  toMarkdown,
  filterBySection,
  participantNames,
} from "@/lib/transcript-format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORMATS = {
  txt: { ext: "txt", mime: "text/plain; charset=utf-8" },
  srt: { ext: "srt", mime: "application/x-subrip; charset=utf-8" },
  vtt: { ext: "vtt", mime: "text/vtt; charset=utf-8" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
} as const;

type Fmt = keyof typeof FORMATS;
type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const url = new URL((req as NextRequest).url);
  const format = (url.searchParams.get("format") || "txt") as Fmt;
  if (!FORMATS[format]) {
    return NextResponse.json({ error: "format inválido" }, { status: 400 });
  }
  const scope = url.searchParams.get("scope") || "full";
  const sectionIdx = Number(url.searchParams.get("section"));

  const m = await meetingsFor(user.id).forExport(id);
  if (!m) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  const allSegments = coerceSegments(m.segments);
  if (allSegments.length === 0) {
    return NextResponse.json({ error: "sem transcrição" }, { status: 422 });
  }
  const labels = m.speaker_labels || {};
  const sections = coerceSections(m.sections);

  let segments = allSegments;
  let titleSuffix = "";
  if (scope === "section" && Number.isInteger(sectionIdx) && sections[sectionIdx]) {
    segments = filterBySection(allSegments, sections, sectionIdx, m.duration_seconds || 0);
    titleSuffix = ` — ${sections[sectionIdx].title}`;
    if (segments.length === 0) {
      return NextResponse.json({ error: "seção vazia" }, { status: 422 });
    }
  }

  let body: string;
  if (format === "txt") body = toPlainText(segments, labels);
  else if (format === "srt") body = toSrt(segments, labels);
  else if (format === "vtt") body = toVtt(segments, labels);
  else
    body = toMarkdown(segments, labels, {
      title: (m.summary || "Reunião") + titleSuffix,
      dateLabel: m.recorded_at ? fmtDate(m.recorded_at) : "sem data",
      participants: participantNames(segments, labels),
    });

  const datePart = m.recorded_at ? m.recorded_at.slice(0, 10) : "sem-data";
  const filename = `reuniao-${datePart}.${FORMATS[format].ext}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": FORMATS[format].mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

function coerceSections(raw: unknown): { start_seconds: number; title: string }[] {
  if (Array.isArray(raw)) return raw as { start_seconds: number; title: string }[];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    } catch {
      // ignore
    }
  }
  return [];
}
```

- [ ] **Step 2: Validar manualmente (logado no app)**

Subir o dev server e baixar cada formato de uma reunião real com transcrição:

Run: `cd frontend && bun run dev` (em background) e então, autenticado no browser, abrir:
`http://localhost:3000/api/meetings/<id-de-uma-reuniao>/export?format=txt`
Expected: download de `reuniao-YYYY-MM-DD.txt` com linhas `[mm:ss] Nome: texto`. Repetir `format=srt`, `vtt`, `md`. `format=xpto` → 400. Reunião de outro user → 404.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/meetings/[id]/export/route.ts
git commit -m "feat(export): rota GET /api/meetings/[id]/export (txt/srt/vtt/md + scope=section)"
```

---

### Task 7: Menu "Baixar / exportar" na página + copiar

**Files:**
- Create: `frontend/components/transcript-export-menu.tsx`
- Modify: `frontend/app/reunioes/[id]/page.tsx`

- [ ] **Step 1: Criar o componente**

`frontend/components/transcript-export-menu.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Download, Copy, Check, Printer, FileText, Captions, FileCode } from "lucide-react";
import { toPlainText, type Segment } from "@/lib/transcript-format";

export function TranscriptExportMenu({
  meetingId,
  segments,
  labels,
}: {
  meetingId: string;
  segments: Segment[];
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const base = `/api/meetings/${meetingId}/export`;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(toPlainText(segments, labels));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard indisponível — ignora
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
        title="Baixar a transcrição"
      >
        <Download size={13} /> baixar / exportar
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-1.5 w-56 space-y-0.5">
          <a
            href={`${base}?format=txt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <FileText size={13} /> Texto (.txt)
          </a>
          <a
            href={`${base}?format=md`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <FileCode size={13} /> Markdown (.md)
          </a>
          <a
            href={`${base}?format=srt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Captions size={13} /> Legenda (.srt)
          </a>
          <a
            href={`${base}?format=vtt`}
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Captions size={13} /> Legenda (.vtt)
          </a>
          <button
            type="button"
            onClick={copyAll}
            className="w-full flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            {copied ? <Check size={13} className="text-[color:var(--calm)]" /> : <Copy size={13} />}
            {copied ? "Copiado!" : "Copiar tudo"}
          </button>
          <a
            href={`/reunioes/${meetingId}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)]"
          >
            <Printer size={13} /> Imprimir / PDF
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire na página**

Em `frontend/app/reunioes/[id]/page.tsx`:

Adicionar o import (junto dos outros componentes, ≈ linha 18):
```tsx
import { TranscriptExportMenu } from "@/components/transcript-export-menu";
```

No header da seção Transcrição (≈ linhas 219-232), dentro da `<div className="flex items-center justify-between ...">`, **depois** do link "identificar speakers" (ainda dentro da div), adicionar o menu — agrupando os dois botões num flex à direita. Trocar o bloco:

```tsx
            {meeting.segments && meeting.segments.length > 0 && (
              <Link
                href={`/reunioes/${meeting.id}/identificar`}
                ...
              >
                <UsersRound size={13} /> identificar speakers
              </Link>
            )}
```
por:
```tsx
            {meeting.segments && meeting.segments.length > 0 && (
              <div className="flex items-center gap-2">
                <Link
                  href={`/reunioes/${meeting.id}/identificar`}
                  className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
                  title="Tela dedicada pra ouvir trechos curtos e rotular speakers"
                >
                  <UsersRound size={13} /> identificar speakers
                </Link>
                <TranscriptExportMenu
                  meetingId={meeting.id}
                  segments={meeting.segments}
                  labels={meeting.speaker_labels || {}}
                />
              </div>
            )}
```

- [ ] **Step 3: Validar no app (Playwright)**

Abrir uma reunião com transcrição. Clicar "baixar / exportar" → menu abre. Clicar "Texto (.txt)" → baixa. Clicar "Copiar tudo" → vira "Copiado!". Tirar screenshot.
Expected: menu funcional, download e cópia ok.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/transcript-export-menu.tsx frontend/app/reunioes/[id]/page.tsx
git commit -m "feat(export): menu Baixar/exportar + copiar no detalhe da reunião"
```

---

### Task 8: View de impressão → PDF

**Files:**
- Create: `frontend/app/reunioes/[id]/imprimir/page.tsx`

- [ ] **Step 1: Criar o gatilho de impressão (client)**

`frontend/app/reunioes/[id]/imprimir/print-trigger.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
```

- [ ] **Step 2: Criar a página de impressão (server component)**

`frontend/app/reunioes/[id]/imprimir/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import { coerceSegments, groupTurns, speakerName, fmtClock } from "@/lib/transcript-format";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

export default async function ImprimirPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const m = await meetingsFor(user.id).forExport(id);
  if (!m) notFound();

  const segments = coerceSegments(m.segments);
  const labels = m.speaker_labels || {};
  const turns = groupTurns(segments);

  return (
    <div className="mx-auto max-w-3xl p-8 text-black bg-white print:p-0">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{m.summary || "Reunião"}</h1>
        <p className="text-sm text-neutral-600 mt-1">
          {m.recorded_at ? fmtDate(m.recorded_at) : "sem data"}
        </p>
      </header>
      <div className="space-y-3">
        {turns.map((t, i) => (
          <p key={i} className="text-[14px] leading-relaxed">
            <span className="font-mono text-neutral-500 text-[12px]">[{fmtClock(t.start)}]</span>{" "}
            <strong>{speakerName(t.speaker, labels)}:</strong> {t.text.trim()}
          </p>
        ))}
      </div>
      <PrintTrigger />
    </div>
  );
}
```

- [ ] **Step 3: Validar no app**

Abrir `http://localhost:3000/reunioes/<id>/imprimir` autenticado.
Expected: página limpa com a transcrição; diálogo de impressão abre sozinho; "Salvar como PDF" gera um PDF legível.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/reunioes/[id]/imprimir/
git commit -m "feat(export): view de impressão limpa (Salvar como PDF)"
```

---

# FASE C — Seções (mesma reunião)

### Task 9: Rota `PATCH /api/meetings/[id]/sections`

**Files:**
- Create: `frontend/app/api/meetings/[id]/sections/route.ts`

- [ ] **Step 1: Implementar a rota**

`frontend/app/api/meetings/[id]/sections/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { sections?: Array<{ start_seconds?: number; title?: string }> };
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body: Body = (await (req as NextRequest).json().catch(() => ({}))) as Body;
  const raw = Array.isArray(body.sections) ? body.sections : [];

  const sections = raw
    .filter(
      (s) => typeof s?.start_seconds === "number" && Number.isFinite(s.start_seconds) && s.start_seconds >= 0,
    )
    .map((s) => ({
      start_seconds: Math.round(s.start_seconds as number),
      title: (typeof s.title === "string" ? s.title : "").trim().slice(0, 120) || "Seção",
    }))
    .sort((a, b) => a.start_seconds - b.start_seconds);

  const updated = await meetingsFor(user.id).updateSections(id, sections);
  if (!updated) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true, sections });
});
```

- [ ] **Step 2: Validar manualmente**

Run (autenticado; pegar cookie de sessão do browser ou usar o app):
`curl -X PATCH http://localhost:3000/api/meetings/<id>/sections -H 'Content-Type: application/json' --cookie '<sessao>' -d '{"sections":[{"start_seconds":60,"title":"Financeiro"}]}'`
Expected: `{"ok":true,"sections":[{"start_seconds":60,"title":"Financeiro"}]}`. Conferir no banco: `SELECT sections FROM meetings WHERE id='<id>';`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/meetings/[id]/sections/route.ts
git commit -m "feat(secoes): rota PATCH /api/meetings/[id]/sections"
```

---

### Task 10: `groupTurns` compartilhado + props de seção no `TranscriptionView`

**Files:**
- Modify: `frontend/components/transcription-view.tsx`
- Modify: `frontend/app/reunioes/[id]/page.tsx`

- [ ] **Step 1: Reusar `groupTurns` do módulo (DRY)**

Em `frontend/components/transcription-view.tsx`:
- Remover a função local `groupTurns` (≈ linhas 45-66) e o `type Turn` local (≈ linhas 37-43).
- No import do topo, trocar/adicionar:
```tsx
import { groupTurns, type Segment as FmtSegment, type Turn } from "@/lib/transcript-format";
```
- O `export type Segment` local (linhas 22-27) é idêntico ao do módulo; mantê-lo é ok (a página importa `Segment` daqui). Garantir que `groupTurns(segments)` continue tipando — `Segment` local e `FmtSegment` têm o mesmo shape.

- [ ] **Step 2: Adicionar prop `sections` (sem render ainda)**

Em `TranscriptionView`, adicionar à assinatura de props:
```tsx
  sections = [],
}: {
  ...
  sections?: { start_seconds: number; title: string }[];
}) {
```
(declarar `sections` no destructuring e no tipo).

- [ ] **Step 3: Passar `sections` da página**

Em `frontend/app/reunioes/[id]/page.tsx`:
- No `type Meeting`, adicionar:
```tsx
  sections: { start_seconds: number; title: string }[] | null;
```
- No `<TranscriptionView ... />`, adicionar a prop:
```tsx
              sections={meeting.sections || []}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/transcription-view.tsx frontend/app/reunioes/[id]/page.tsx
git commit -m "refactor(transcricao): groupTurns compartilhado + prop sections (sem render)"
```

---

### Task 11: Render dos divisores de seção

**Files:**
- Modify: `frontend/components/transcription-view.tsx`

- [ ] **Step 1: Calcular o índice de seção por turn**

Dentro do `TranscriptionView`, após `const turns = groupTurns(segments);`, adicionar:

```tsx
  const sortedSections = [...sections].sort((a, b) => a.start_seconds - b.start_seconds);
  // Para cada turn, qual seção começa exatamente nele (primeiro turn com start >= section.start)
  function sectionStartingAt(turnIndex: number): { start_seconds: number; title: string } | null {
    const t = turns[turnIndex];
    const prevEnd = turnIndex > 0 ? turns[turnIndex - 1].start : -1;
    return (
      sortedSections.find((s) => s.start_seconds > prevEnd && s.start_seconds <= t.start) ?? null
    );
  }
```

- [ ] **Step 2: Renderizar o divisor antes do turn**

No `.map` dos turns (≈ linha 508), envolver cada turn para injetar o divisor. Trocar:

```tsx
      {turns.map((t, i) => (
        <div key={i} className="flex gap-3 relative">
```
por:

```tsx
      {turns.map((t, i) => {
        const sec = sectionStartingAt(i);
        return (
        <div key={i}>
        {sec && (
          <div className="flex items-center gap-2 my-4 first:mt-0">
            <span className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)] bg-[color:var(--accent)] px-2.5 py-1 rounded-full">
              {sec.title}
            </span>
            <span className="flex-1 h-px bg-[color:var(--border)]" />
          </div>
        )}
        <div className="flex gap-3 relative">
```

E fechar os dois `<div>` + o callback no final do map. Trocar:
```tsx
        </div>
      ))}
    </div>
  );
```
por:
```tsx
        </div>
        </div>
        );
      })}
    </div>
  );
```

- [ ] **Step 3: Validar no app (Playwright)**

Com uma reunião que tenha `sections` setado (via a rota da Task 9), abrir o detalhe.
Expected: divisores com o título aparecem nos pontos certos da transcrição. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/transcription-view.tsx
git commit -m "feat(secoes): divisores de seção na transcrição"
```

---

### Task 12: Marcar/renomear/remover seção pelo texto

**Files:**
- Modify: `frontend/components/transcription-view.tsx`

- [ ] **Step 1: Estado local + persistência**

No corpo do `TranscriptionView`, adicionar estado e função de salvar (perto dos outros `useState`):

```tsx
  const [sectionList, setSectionList] = useState(
    [...sections].sort((a, b) => a.start_seconds - b.start_seconds),
  );

  async function saveSections(next: { start_seconds: number; title: string }[]) {
    const sorted = [...next].sort((a, b) => a.start_seconds - b.start_seconds);
    setSectionList(sorted);
    try {
      await fetch(`/api/meetings/${meetingId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sorted }),
      });
    } catch {
      // mantém otimista; refresh corrige se falhar
    }
  }
```

Trocar todas as referências de `sortedSections`/`sections` no cálculo do divisor (Task 11) por `sectionList`. Ou seja, em `sectionStartingAt`, usar `sectionList.find(...)`.

- [ ] **Step 2: Botão "nova seção" por turn**

No bloco de ações à direita do turn (onde está o `MoveTurnMenu`, ≈ linha 525-534), adicionar um botão que cria seção a partir do `start` daquele turn. Logo após o `</div>` que fecha o `MoveTurnMenu`, dentro do mesmo `<div className="relative shrink-0">`, ou num irmão, adicionar:

```tsx
          <button
            type="button"
            title="marcar nova seção a partir daqui"
            onClick={() => {
              const title = window.prompt("Título da seção (ex: Financeiro):", "")?.trim();
              if (!title) return;
              const at = Math.round(t.start);
              const without = sectionList.filter((s) => Math.abs(s.start_seconds - at) > 1);
              saveSections([...without, { start_seconds: at, title }]);
            }}
            className="opacity-30 hover:opacity-100 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition shrink-0 mt-0.5"
            aria-label="nova seção aqui"
          >
            <BookmarkPlus size={12} />
          </button>
```

Adicionar `BookmarkPlus` ao import do `lucide-react` no topo.

- [ ] **Step 3: Renomear/remover no divisor**

No divisor de seção (Task 11), tornar o título clicável pra renomear e adicionar um "×" pra remover. Trocar o `<span>` do título por:

```tsx
            <button
              type="button"
              onClick={() => {
                const novo = window.prompt("Renomear seção:", sec.title)?.trim();
                if (novo === undefined) return;
                const next = sectionList.map((s) =>
                  s.start_seconds === sec.start_seconds ? { ...s, title: novo || s.title } : s,
                );
                saveSections(next);
              }}
              className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)] bg-[color:var(--accent)] px-2.5 py-1 rounded-full hover:ring-1 hover:ring-[color:var(--foreground)]/30"
            >
              {sec.title}
            </button>
            <button
              type="button"
              title="remover seção"
              onClick={() =>
                saveSections(sectionList.filter((s) => s.start_seconds !== sec.start_seconds))
              }
              className="text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
              aria-label="remover seção"
            >
              <X size={12} />
            </button>
```

(`X` já está importado.)

- [ ] **Step 4: Validar no app (Playwright)**

Abrir reunião. No hover de um turn, clicar no ícone de seção → digitar "Financeiro" → divisor aparece e persiste após refresh. Renomear e remover funcionam.
Expected: ciclo criar/renomear/remover ok, persistindo no banco.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/transcription-view.tsx
git commit -m "feat(secoes): marcar/renomear/remover seção pela transcrição"
```

---

### Task 13: Baixar seção no menu de export

**Files:**
- Modify: `frontend/components/transcript-export-menu.tsx`
- Modify: `frontend/app/reunioes/[id]/page.tsx`

- [ ] **Step 1: Aceitar `sections` no menu**

Em `frontend/components/transcript-export-menu.tsx`, adicionar à assinatura de props:
```tsx
  sections = [],
}: {
  meetingId: string;
  segments: Segment[];
  labels: Record<string, string>;
  sections?: { start_seconds: number; title: string }[];
}) {
```

Antes do `</div>` que fecha o dropdown (depois do link "Imprimir / PDF"), adicionar a lista de seções:

```tsx
          {sections.length > 0 && (
            <div className="border-t border-[color:var(--border)]/50 mt-1 pt-1">
              <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)] px-2 pb-1">
                baixar seção
              </p>
              {sections.map((s, i) => (
                <a
                  key={i}
                  href={`${base}?format=txt&scope=section&section=${i}`}
                  className="block text-[12px] px-2 py-1.5 rounded-md hover:bg-[color:var(--accent)] truncate"
                  title={s.title}
                >
                  {s.title}
                </a>
              ))}
            </div>
          )}
```

- [ ] **Step 2: Passar `sections` da página**

Em `frontend/app/reunioes/[id]/page.tsx`, no `<TranscriptExportMenu ... />`, adicionar:
```tsx
                  sections={meeting.sections || []}
```

- [ ] **Step 3: Validar no app**

Reunião com seções. Abrir menu de export → bloco "baixar seção" lista as seções → baixar uma → `.txt` só com os turnos daquela seção.
Expected: download da seção correto.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/transcript-export-menu.tsx frontend/app/reunioes/[id]/page.tsx
git commit -m "feat(export): baixar seção individual no menu"
```

---

# FASE B — Separar em reuniões pelo texto

### Task 14: Piso manual no endpoint de split (`allow_short`)

**Files:**
- Modify: `frontend/lib/detect-cuts.ts`
- Modify: `frontend/app/api/meetings/[id]/segments/route.ts`
- Test: `frontend/lib/detect-cuts.test.ts`

- [ ] **Step 1: Teste do validador (falha)**

Acrescentar a `frontend/lib/detect-cuts.test.ts`:

```ts
import { validateManualCuts, DETECT_CONSTANTS } from "./detect-cuts";

describe("validateManualCuts", () => {
  test("aceita cortes que respeitam o piso", () => {
    const r = validateManualCuts([60], 200, 30);
    expect(r.ok).toBe(true);
  });
  test("rejeita trecho menor que o piso", () => {
    const r = validateManualCuts([10], 200, 30); // primeiro trecho = 10s
    expect(r.ok).toBe(false);
    expect(r.tooShort).toBe(10);
  });
  test("rejeita corte fora do intervalo", () => {
    expect(validateManualCuts([0], 200, 30).ok).toBe(false);
    expect(validateManualCuts([200], 200, 30).ok).toBe(false);
  });
  test("piso automático de 10min ainda bloqueia trecho de 5min", () => {
    const r = validateManualCuts([300], 1200, DETECT_CONSTANTS.MIN_SEGMENT_DURATION);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && bun test lib/detect-cuts.test.ts`
Expected: FAIL — `validateManualCuts` não existe.

- [ ] **Step 3: Implementar constante + validador**

Em `frontend/lib/detect-cuts.ts`, dentro de `DETECT_CONSTANTS`, adicionar:
```ts
  MIN_MANUAL_SEGMENT_DURATION: 30,
```

E no final do arquivo, exportar:
```ts
/** Valida cortes manuais: cada corte dentro de (0,duration) e cada trecho >= minDur. */
export function validateManualCuts(
  cutSeconds: number[],
  duration: number,
  minDur: number,
): { ok: boolean; tooShort?: number; outOfRange?: number } {
  for (const c of cutSeconds) {
    if (c <= 0 || c >= duration) return { ok: false, outOfRange: c };
  }
  const positions = [0, ...[...cutSeconds].sort((a, b) => a - b), duration];
  for (let i = 0; i < positions.length - 1; i++) {
    const segDur = positions[i + 1] - positions[i];
    if (segDur < minDur) return { ok: false, tooShort: segDur };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && bun test lib/detect-cuts.test.ts`
Expected: PASS (incluindo os testes antigos de `detectCuts`).

- [ ] **Step 5: Usar `allow_short` no endpoint**

Em `frontend/app/api/meetings/[id]/segments/route.ts`:

No `type Body` (≈ linha 30), adicionar:
```ts
  allow_short?: boolean;
```

Após `const restore = body.restore === true;` (≈ linha 112), adicionar:
```ts
  const allowShort = body.allow_short === true;
```

Trocar o bloco de validação de duração (≈ linhas 204-210):
```ts
        const positions = [0, ...cuts.map((c) => c.at_seconds), duration];
        for (let i = 0; i < positions.length - 1; i++) {
          const segDur = positions[i + 1] - positions[i];
          if (segDur < DETECT_CONSTANTS.MIN_SEGMENT_DURATION) {
            throw new Error(`SEGMENT_TOO_SHORT:${segDur}`);
          }
        }
```
por:
```ts
        const minDur = allowShort
          ? DETECT_CONSTANTS.MIN_MANUAL_SEGMENT_DURATION
          : DETECT_CONSTANTS.MIN_SEGMENT_DURATION;
        const positions = [0, ...cuts.map((c) => c.at_seconds), duration];
        for (let i = 0; i < positions.length - 1; i++) {
          const segDur = positions[i + 1] - positions[i];
          if (segDur < minDur) {
            throw new Error(`SEGMENT_TOO_SHORT:${segDur}`);
          }
        }
```

> O fluxo automático de `/segmentar` não envia `allow_short` → continua com piso de 10min. Nada muda lá.

- [ ] **Step 6: Type-check + testes**

Run: `cd frontend && bunx tsc --noEmit && bun test lib/`
Expected: sem erros; todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/detect-cuts.ts frontend/lib/detect-cuts.test.ts frontend/app/api/meetings/[id]/segments/route.ts
git commit -m "feat(separar): allow_short + validateManualCuts (piso manual 30s)"
```

---

### Task 15: Barra flutuante de cortes pendentes

**Files:**
- Create: `frontend/components/cut-bar.tsx`

- [ ] **Step 1: Criar o componente**

`frontend/components/cut-bar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scissors } from "lucide-react";

export function CutBar({
  meetingId,
  cuts,
  onClear,
}: {
  meetingId: string;
  cuts: { at_seconds: number; label: string }[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cuts.length === 0) return null;
  const nReunioes = cuts.length + 1;

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allow_short: true,
          cuts: cuts.map((c) => ({ at_seconds: c.at_seconds, title: c.label })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onClear();
      // Pai vira archived_session → volta pra lista
      router.push("/reunioes");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto paper-card rounded-2xl border border-[color:var(--border)] shadow-xl px-4 py-3 flex items-center gap-3 max-w-lg w-full">
        <Scissors size={16} className="text-[color:var(--muted-strong)] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium">
            {cuts.length} {cuts.length === 1 ? "corte marcado" : "cortes marcados"} → separar em{" "}
            {nReunioes} reuniões
          </p>
          {error && <p className="text-[11px] text-[color:var(--urgent)] mt-0.5">{error}</p>}
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-2 disabled:opacity-50"
        >
          limpar
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          className="press-feedback text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {busy ? "separando…" : "separar"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: sem erros (o componente ainda não é usado — ok).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/cut-bar.tsx
git commit -m "feat(separar): barra flutuante de cortes pendentes"
```

---

### Task 16: Marcar cortes pela transcrição + integrar a barra

**Files:**
- Modify: `frontend/components/transcription-view.tsx`

- [ ] **Step 1: Estado de cortes + import**

Em `frontend/components/transcription-view.tsx`:
- Adicionar imports no topo: `import { CutBar } from "@/components/cut-bar";` e `Split` no `lucide-react`.
- No corpo do componente, adicionar estado:
```tsx
  const [pendingCuts, setPendingCuts] = useState<{ at_seconds: number; label: string }[]>([]);

  function toggleCut(turnIndex: number) {
    const t = turns[turnIndex];
    const at = Math.round(t.start);
    if (at <= 0) return; // não dá pra cortar no começo
    setPendingCuts((prev) => {
      const exists = prev.some((c) => Math.abs(c.at_seconds - at) <= 1);
      if (exists) return prev.filter((c) => Math.abs(c.at_seconds - at) > 1);
      const label = `Parte a partir de ${fmtTimeLabel(t.start)}`;
      return [...prev, { at_seconds: at, label }].sort((a, b) => a.at_seconds - b.at_seconds);
    });
  }

  function isCutHere(turnIndex: number): boolean {
    const at = Math.round(turns[turnIndex].start);
    return pendingCuts.some((c) => Math.abs(c.at_seconds - at) <= 1);
  }
```

Adicionar um helper de label perto do topo do arquivo (fora do componente), reusando o `fmtTime` que já existe:
```tsx
function fmtTimeLabel(seconds: number): string {
  return fmtTime(seconds);
}
```
(ou usar `fmtTime` direto — `fmtTimeLabel` é só clareza; pode chamar `fmtTime(t.start)` no lugar.)

- [ ] **Step 2: Botão "separar daqui" por turn**

No cluster de ações do turn (junto do `MoveTurnMenu` e do botão de seção da Task 12), adicionar:

```tsx
          <button
            type="button"
            title={isCutHere(i) ? "desfazer corte" : "separar: a partir daqui é outra reunião"}
            onClick={() => toggleCut(i)}
            className={
              isCutHere(i)
                ? "text-[color:var(--urgent)] shrink-0 mt-0.5"
                : "opacity-30 hover:opacity-100 text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition shrink-0 mt-0.5"
            }
            aria-label="separar a partir daqui"
          >
            <Split size={12} />
          </button>
```

- [ ] **Step 3: Linha divisória visual no corte pendente**

No render do turn, antes do `<div className="flex gap-3 relative">` (e antes/depois do divisor de seção da Task 11), injetar a marca de corte:

```tsx
        {isCutHere(i) && (
          <div className="flex items-center gap-2 my-3">
            <span className="flex-1 h-px bg-[color:var(--urgent)]/60" />
            <span className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--urgent)]">
              corte — nova reunião
            </span>
            <span className="flex-1 h-px bg-[color:var(--urgent)]/60" />
          </div>
        )}
```

- [ ] **Step 4: Montar a barra**

No final do `return` do `TranscriptionView`, antes do `</div>` que fecha o container raiz, adicionar:

```tsx
      <CutBar
        meetingId={meetingId}
        cuts={pendingCuts}
        onClear={() => setPendingCuts([])}
      />
```

- [ ] **Step 5: Validar no app (Playwright) — end-to-end**

Numa reunião com vários turnos:
1. Hover num turn → clicar no ícone de "separar" → linha vermelha "corte — nova reunião" aparece; barra flutuante mostra "1 corte marcado → separar em 2 reuniões".
2. Marcar um segundo corte → "2 cortes → 3 reuniões".
3. Clicar "separar" → redireciona pra `/reunioes`; o pai sai da lista (arquivado) e as filhas aparecem (após processamento n8n).
4. Conferir no banco: filhas com `parent_meeting_id`, `source='segmented'`, e que um corte de < 10min foi aceito (graças a `allow_short`).

Expected: split funciona inclusive com trechos curtos; fluxo `/segmentar` automático intacto.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/transcription-view.tsx
git commit -m "feat(separar): marcar cortes pela transcrição + barra de separar"
```

---

## Validação final (todas as fases)

- [ ] **Testes unitários:** `cd frontend && bun test lib/` → tudo verde (transcript-format + detect-cuts).
- [ ] **Type-check:** `cd frontend && bunx tsc --noEmit` → limpo.
- [ ] **Lint:** `cd frontend && bun run lint` → sem erros novos.
- [ ] **Smoke no app real (Playwright):** export nos 4 formatos + copiar + imprimir; criar/renomear/remover seção + baixar seção; marcar 2 cortes e separar em 3 reuniões.

---

## Self-Review (preenchido na escrita do plano)

**Cobertura do spec:**
- Parte A (export txt/srt/vtt/md/copiar/PDF) → Tasks 2-8 ✅
- Parte B (separar pelo texto, allow_short, piso 30s, cortes acumulados) → Tasks 14-16 ✅
- Parte C (seções: coluna, rota, render, CRUD, export por seção) → Tasks 1, 9-13 ✅
- Multi-tenant (withAuth+withTenant em toda rota) → Tasks 6, 9 ✅
- Migration idempotente aplicada manual → Task 1 ✅

**Consistência de tipos:** `Segment`, `Turn`, `Section` definidos em `transcript-format.ts` e reusados; `validateManualCuts`/`MIN_MANUAL_SEGMENT_DURATION` em `detect-cuts.ts` referenciados igual no endpoint; `forExport`/`updateSections` assinaturas batem entre queries e rotas.

**Dependências de ordem:** migration (Task 1) primeiro porque `forExport` e a página leem a coluna `sections`. Dentro de A, módulo puro (2-4) antes da rota (6) que o consome. C depende de A (menu de export existe). B é independente de A/C (só toca endpoint + transcription-view).

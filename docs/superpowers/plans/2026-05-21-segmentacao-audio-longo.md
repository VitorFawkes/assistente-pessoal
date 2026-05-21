# Segmentação de áudio longo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar cortes naturais em gravações longas (>60min) usando os segments diarizados já salvos no DB, e permitir que Vitor revise + fatie em N meetings independentes via UI em `/reunioes/[id]/segmentar`.

**Architecture:** Detector heurístico puro em TS (silêncio + speakers) roda server-side no Next.js. Frontend orquestra fatiamento (ffmpeg local) + INSERT atômico dos filhos em transação Postgres. n8n marca `needs_segmentation=true` quando duração > 1h e dispara WhatsApp; um workflow secundário "Acoes - Process Segment" extrai tarefas pra cada filho criado. Sem mudanças no voice-svc nem no Mac agent.

**Tech Stack:** Next.js 16.2.6 (App Router, Bun runtime no container, `oven/bun:1.3-alpine`), TypeScript, `pg` direto (sem ORM), Tailwind 4, Postgres 17 (sem pgvector), ffmpeg via `child_process`, n8n + Evolution API.

**Spec:** [docs/superpowers/specs/2026-05-21-segmentacao-audio-longo-design.md](../specs/2026-05-21-segmentacao-audio-longo-design.md)

---

## Task 1: Migration DB

**Files:**
- Create: `db/0006_meeting_segmentation.sql`

Adiciona colunas pra hierarquia pai/filho e expande o CHECK do status pra incluir `archived_session`.

- [ ] **Step 1: Criar a migration**

```sql
-- db/0006_meeting_segmentation.sql
-- Segmentação de áudio longo em N meetings filhos.
-- Cada filho mantém referência ao pai (archived_session) via parent_meeting_id.
-- Aplicar manualmente via dbgate/pgweb (projeto não tem migration tool).

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS parent_meeting_id UUID NULL
    REFERENCES meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_index INT NULL,
  ADD COLUMN IF NOT EXISTS segment_start_offset REAL NULL,
  ADD COLUMN IF NOT EXISTS segment_end_offset REAL NULL,
  ADD COLUMN IF NOT EXISTS needs_segmentation BOOLEAN NOT NULL DEFAULT false;

-- O status original tem CHECK com 5 valores. Expande pra incluir o estado final
-- de "pai arquivado após segmentação". Pais ficam invisíveis no /reunioes.
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('received','transcribing','analyzing','done','error','archived_session'));

-- O source original aceita só ('macbook','iphone'). Filhos terão source='segmented'.
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_source_check
  CHECK (source IN ('macbook','iphone','segmented'));

CREATE INDEX IF NOT EXISTS meetings_parent_idx
  ON meetings(parent_meeting_id) WHERE parent_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meetings_needs_seg_idx
  ON meetings(needs_segmentation) WHERE needs_segmentation = true;

COMMENT ON COLUMN meetings.parent_meeting_id IS
  'Aponta pro meeting-pai (status=archived_session) que originou este segmento. NULL = meeting raiz.';
COMMENT ON COLUMN meetings.segment_index IS
  'Ordem do segmento dentro do pai (0,1,2,...). NULL em meetings raiz.';
COMMENT ON COLUMN meetings.segment_start_offset IS
  'Segundos no áudio do pai onde este segmento começa. NULL em raiz.';
COMMENT ON COLUMN meetings.segment_end_offset IS
  'Segundos no áudio do pai onde este segmento termina. NULL em raiz.';
COMMENT ON COLUMN meetings.needs_segmentation IS
  'Marcado pelo n8n quando duração > 60min, sinaliza pra UI mostrar banner.';
```

- [ ] **Step 2: Aplicar no banco**

Acessar dbgate (ou pgweb) apontando pra DATABASE_URL do `.env`, abrir aba SQL, colar o conteúdo do arquivo e executar. Confirmar que não há erro (todas as cláusulas têm `IF NOT EXISTS` / `IF EXISTS`, então é idempotente).

Verificação:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'meetings'
  AND column_name IN ('parent_meeting_id','segment_index','segment_start_offset','segment_end_offset','needs_segmentation');
-- Esperado: 5 linhas.

SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'meetings_status_check';
-- Esperado: CHECK contém 'archived_session'.

SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'meetings_source_check';
-- Esperado: CHECK contém 'segmented'.
```

- [ ] **Step 3: Commit**

```bash
git add db/0006_meeting_segmentation.sql
git commit -m "db: migration 0006 — segmentation columns + status/source CHECK"
```

---

## Task 2: ffmpeg no container do frontend

**Files:**
- Modify: `frontend/Dockerfile`

O container do Next.js usa `oven/bun:1.3-alpine` sem ffmpeg. A nova rota de segmentação chama `ffmpeg -c copy` localmente.

- [ ] **Step 1: Editar o Dockerfile**

No estágio `runner`, antes do `USER app`, adicionar:

```dockerfile
# ffmpeg pra fatiamento de áudio em /api/meetings/[id]/segments
RUN apk add --no-cache ffmpeg
```

Resultado do bloco runner depois da edição:
```dockerfile
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# ffmpeg pra fatiamento de áudio em /api/meetings/[id]/segments
RUN apk add --no-cache ffmpeg

RUN addgroup -S app && adduser -S app -G app
USER app

# Next.js standalone output
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

EXPOSE 3000
CMD ["bun", "server.js"]
```

- [ ] **Step 2: Build local para validar (opcional, se Docker estiver disponível)**

```bash
docker build -t assistente-frontend-test ./frontend
docker run --rm assistente-frontend-test which ffmpeg
# Esperado: /usr/bin/ffmpeg
```

Se Docker não estiver disponível localmente, pular — a validação real vai ocorrer no easypanel rebuild.

- [ ] **Step 3: Commit**

```bash
git add frontend/Dockerfile
git commit -m "frontend: ffmpeg no container pra fatiamento de áudio"
```

---

## Task 3: Detector heurístico (puro, testável)

**Files:**
- Create: `frontend/lib/detect-cuts.ts`
- Test: `frontend/lib/detect-cuts.test.ts`

Módulo puro. Sem dependências externas. Roda server-side na página `/segmentar` e tem testes unitários via `bun test` (built-in, não requer dependency).

- [ ] **Step 1: Escrever o teste primeiro**

```ts
// frontend/lib/detect-cuts.test.ts
import { expect, test, describe } from "bun:test";
import { detectCuts, type Segment } from "./detect-cuts";

function makeSeg(speaker: string, start: number, end: number, text = ""): Segment {
  return { speaker, start, end, text };
}

describe("detectCuts", () => {
  test("retorna lista vazia para áudio sem silêncios longos", () => {
    const segs: Segment[] = [];
    for (let i = 0; i < 100; i++) {
      segs.push(makeSeg("A", i * 10, i * 10 + 8, "tudo seguido"));
    }
    const cuts = detectCuts(segs, 1000);
    expect(cuts).toHaveLength(0);
  });

  test("detecta silêncio HARD (>180s) como corte forte", () => {
    // Speaker A fala dos 600s-700s, depois silêncio total até 900s, depois fala até 1500s.
    // Gap = 200s entre A.end=700 e A.start=900. Cada lado tem >MIN_SEGMENT_DURATION=600s.
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 900, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].at_seconds).toBe(800); // meio do gap
    expect(cuts[0].confidence).toBeGreaterThanOrEqual(1.0);
    expect(cuts[0].reasons.some((r) => r.includes("silêncio"))).toBe(true);
  });

  test("silêncio SOFT (90-180s) sozinho fica abaixo do floor e é filtrado", () => {
    // Gap de 120s, sem mudança de speakers. Peso 0.5, abaixo do CONFIDENCE_FLOOR=0.7.
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 820, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(0);
  });

  test("silêncio SOFT + speaker novo entra acima do floor", () => {
    // Antes: só A fala. Gap de 120s. Depois: B e C falam. Jaccard = 0.
    const segs: Segment[] = [];
    // 0-700: A fala
    for (let t = 0; t < 700; t += 10) segs.push(makeSeg("A", t, t + 8));
    // 820-1500: B e C falam alternados
    for (let t = 820; t < 1500; t += 10) {
      const sp = t % 20 === 0 ? "B" : "C";
      segs.push(makeSeg(sp, t, t + 8));
    }
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].confidence).toBeGreaterThanOrEqual(1.0); // 0.5 silêncio + 0.5 speakers
    expect(cuts[0].reasons.some((r) => r.includes("speakers"))).toBe(true);
  });

  test("descarta cortes que criariam segmento < MIN_SEGMENT_DURATION (600s)", () => {
    // Gap forte de 200s aos 300s — segmento esquerdo só teria 300s. Descarta.
    const segs: Segment[] = [
      makeSeg("A", 0, 300),
      makeSeg("A", 500, 1500),
    ];
    const cuts = detectCuts(segs, 1500);
    expect(cuts).toHaveLength(0);
  });

  test("merge: cortes a menos de MERGE_DISTANCE (300s) mantém o de maior confidence", () => {
    // Dois gaps próximos. O segundo é HARD, o primeiro é SOFT+speakers.
    // (Ambos passariam o floor sozinhos, mas estão a < 300s.)
    const segs: Segment[] = [];
    // 0-700: A só
    for (let t = 0; t < 700; t += 10) segs.push(makeSeg("A", t, t + 8));
    // 820-900: B e C (gap SOFT=120s + speakers novos = peso 1.0)
    for (let t = 820; t < 900; t += 10) segs.push(makeSeg(t % 20 === 0 ? "B" : "C", t, t + 8));
    // 1100-2000: D (gap HARD=200s, peso 1.0)
    for (let t = 1100; t < 2000; t += 10) segs.push(makeSeg("D", t, t + 8));
    const cuts = detectCuts(segs, 2000);
    expect(cuts).toHaveLength(1);
    // Ambos tem confidence ~1.0; merge mantém um deles. O importante é não duplicar.
  });

  test("input vazio retorna lista vazia", () => {
    expect(detectCuts([], 0)).toHaveLength(0);
    expect(detectCuts([], 1000)).toHaveLength(0);
  });

  test("um único segmento retorna lista vazia", () => {
    expect(detectCuts([makeSeg("A", 0, 1000)], 1000)).toHaveLength(0);
  });

  test("reasons inclui descrição legível", () => {
    const segs: Segment[] = [
      makeSeg("A", 0, 700),
      makeSeg("A", 1000, 1700), // gap de 300s, HARD
    ];
    const cuts = detectCuts(segs, 1700);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].reasons[0]).toMatch(/silêncio.*5min/);
  });
});
```

- [ ] **Step 2: Rodar o teste — deve falhar (módulo ainda não existe)**

```bash
cd frontend && bun test lib/detect-cuts
```

Esperado: erro de import `Cannot find module './detect-cuts'`.

- [ ] **Step 3: Implementar o módulo**

```ts
// frontend/lib/detect-cuts.ts
export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type Cut = {
  at_seconds: number;
  confidence: number;
  reasons: string[];
};

export const DETECT_CONSTANTS = {
  SILENCE_HARD: 180,          // 3min sem voz = peso 1.0
  SILENCE_SOFT: 90,           // 90s sem voz = peso 0.5
  SPEAKER_WINDOW: 300,        // janela de 5min antes/depois
  SPEAKER_JACCARD_MAX: 0.3,   // <30% overlap = mudança forte
  SPEAKER_WEIGHT: 0.5,        // bônus quando coincide com silêncio
  MIN_SEGMENT_DURATION: 600,  // mini-meeting ≥ 10min
  CONFIDENCE_FLOOR: 0.7,
  MERGE_DISTANCE: 300,
} as const;

function fmtDur(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (sec === 0) return `${m}min`;
  return `${m}min${sec}s`;
}

function speakersInWindow(
  segments: Segment[],
  centerTime: number,
  windowSeconds: number,
  direction: "before" | "after",
): Set<string> {
  const out = new Set<string>();
  for (const s of segments) {
    if (direction === "before") {
      if (s.end <= centerTime && s.end >= centerTime - windowSeconds) {
        out.add(s.speaker);
      }
    } else {
      if (s.start >= centerTime && s.start <= centerTime + windowSeconds) {
        out.add(s.speaker);
      }
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = new Set<string>();
  for (const x of a) if (b.has(x)) inter.add(x);
  const uni = new Set<string>([...a, ...b]);
  return inter.size / uni.size;
}

export function detectCuts(segments: Segment[], duration: number): Cut[] {
  const C = DETECT_CONSTANTS;
  if (!segments || segments.length < 2) return [];

  // 1) sinais de silêncio
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const candidates: Cut[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const gap = next.start - curr.end;
    if (gap < C.SILENCE_SOFT) continue;

    const at = curr.end + gap / 2;
    const weight = gap >= C.SILENCE_HARD ? 1.0 : 0.5;
    const reasons = [`silêncio ${fmtDur(gap)}`];

    // 2) sinal de speakers ao redor do candidato
    const before = speakersInWindow(sorted, at, C.SPEAKER_WINDOW, "before");
    const after = speakersInWindow(sorted, at, C.SPEAKER_WINDOW, "after");
    const jac = jaccard(before, after);
    const novos: string[] = [];
    for (const x of after) if (!before.has(x)) novos.push(x);

    let confidence = weight;
    if (jac < C.SPEAKER_JACCARD_MAX && novos.length > 0) {
      confidence += C.SPEAKER_WEIGHT;
      reasons.push(`speakers ${novos.sort().join(",")} novos`);
    }

    candidates.push({ at_seconds: at, confidence, reasons });
  }

  // 3) merge de candidatos próximos: mantém o de maior confidence
  candidates.sort((a, b) => a.at_seconds - b.at_seconds);
  const merged: Cut[] = [];
  for (const c of candidates) {
    const last = merged[merged.length - 1];
    if (last && c.at_seconds - last.at_seconds < C.MERGE_DISTANCE) {
      if (c.confidence > last.confidence) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }

  // 4) filtro de duração mínima por segmento resultante
  const positions = [0, ...merged.map((c) => c.at_seconds), duration];
  const keep: Cut[] = [];
  for (let i = 0; i < merged.length; i++) {
    const leftDur = positions[i + 1] - positions[i];
    const rightDur = positions[i + 2] - positions[i + 1];
    if (leftDur >= C.MIN_SEGMENT_DURATION && rightDur >= C.MIN_SEGMENT_DURATION) {
      keep.push(merged[i]);
    }
  }

  // 5) filtro de confidence
  return keep.filter((c) => c.confidence >= C.CONFIDENCE_FLOOR);
}
```

- [ ] **Step 4: Rodar o teste — deve passar**

```bash
cd frontend && bun test lib/detect-cuts
```

Esperado: todos os testes verdes. Se algum falhar, ler a mensagem e corrigir o algoritmo (não o teste).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/detect-cuts.ts frontend/lib/detect-cuts.test.ts
git commit -m "feat(frontend): detector heurístico de cortes em áudios longos"
```

---

## Task 4: Helper de fatiamento via ffmpeg

**Files:**
- Create: `frontend/lib/audio-clip.ts`

Wrapper sobre `child_process.spawn` pra rodar `ffmpeg -c copy`. Server-only. Recebe path de entrada + intervalos + paths de saída, escreve N arquivos.

- [ ] **Step 1: Implementar o helper**

```ts
// frontend/lib/audio-clip.ts
// Server-only: roda ffmpeg local pra fatiar áudio sem reencode.
// Cada chamada é isolada (1 input → 1 output). Idempotente: sobrescreve output.
import "server-only";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ClipInterval = {
  start: number;          // segundos no áudio do pai
  end: number;            // segundos no áudio do pai (exclusivo)
  outputPath: string;     // path final absoluto onde gravar o mp3 do filho
};

class FfmpegError extends Error {
  constructor(message: string, public stderr: string, public code: number | null) {
    super(message);
    this.name = "FfmpegError";
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg exited with ${code}`, stderr, code));
    });
  });
}

export async function clipAudio(
  inputPath: string,
  intervals: ClipInterval[],
): Promise<void> {
  for (const iv of intervals) {
    if (iv.end <= iv.start) {
      throw new Error(`interval inválido: ${iv.start} >= ${iv.end}`);
    }
    await mkdir(dirname(iv.outputPath), { recursive: true });
    // -ss antes de -i pra seek rápido; -t é duração; -c copy é sem reencode.
    const dur = iv.end - iv.start;
    await runFfmpeg([
      "-y",
      "-ss", iv.start.toFixed(3),
      "-t", dur.toFixed(3),
      "-i", inputPath,
      "-c", "copy",
      "-loglevel", "warning",
      iv.outputPath,
    ]);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/audio-clip.ts
git commit -m "feat(frontend): helper ffmpeg pra fatiamento sem reencode"
```

---

## Task 5: Helper de WhatsApp via Evolution API

**Files:**
- Create: `frontend/lib/whatsapp.ts`

A spec exige uma mensagem única ao Vitor após o PATCH ("Sessão de DD/MM segmentada em N reuniões"). Helper isolado pra ser reusado por outras rotas no futuro.

- [ ] **Step 1: Implementar o helper**

```ts
// frontend/lib/whatsapp.ts
import "server-only";

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;
const DESTINO = process.env.WHATSAPP_DESTINO;

export async function sendWhatsApp(text: string): Promise<void> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE || !DESTINO) {
    console.warn("[whatsapp] env vars ausentes — mensagem não enviada");
    return;
  }
  try {
    const res = await fetch(
      `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_KEY,
        },
        body: JSON.stringify({ number: DESTINO, text }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[whatsapp] HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[whatsapp] erro ao enviar:", err);
  }
}
```

> **Antes de commitar**: confirmar o nome do endpoint da Evolution rodando hoje. Olhar o nó 14 (`Send WhatsApp`) do workflow `Acoes - Audio Ingest` ao vivo via n8n API e copiar o path exato (`/message/sendText/{instance}` é o default, mas pode estar customizado):
>
> ```bash
> source .env
> N8N_URL="https://n8n.vitorgambetti.com.br"
> curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" \
>   | python3 -c "import sys,json; w=json.loads(sys.stdin.read()); [print(json.dumps(n.get('parameters',{}),indent=2,ensure_ascii=False)) for n in w['nodes'] if n['name']=='14. Send WhatsApp']"
> ```
>
> Ajustar o path no helper se necessário.

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/whatsapp.ts
git commit -m "feat(frontend): helper Evolution API pra WhatsApp"
```

---

## Task 6: API PATCH `/api/meetings/[id]/segments`

**Files:**
- Create: `frontend/app/api/meetings/[id]/segments/route.ts`

Roteia o fluxo de fatiar uma meeting longa em N filhos. Transação atômica em Postgres + ffmpeg + fire-and-forget de webhook + WhatsApp.

- [ ] **Step 1: Implementar a rota**

```ts
// frontend/app/api/meetings/[id]/segments/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { withClient } from "@/lib/db";
import { clipAudio, type ClipInterval } from "@/lib/audio-clip";
import { sendWhatsApp } from "@/lib/whatsapp";
import { DETECT_CONSTANTS } from "@/lib/detect-cuts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const N8N_WEBHOOK = process.env.N8N_PROCESS_SEGMENT_URL
  || "https://n8n.vitorgambetti.com.br/webhook/acoes-process-segment";

type Segment = { speaker: string; start: number; end: number; text: string };

type ParentRow = {
  id: string;
  status: string;
  parent_meeting_id: string | null;
  audio_path: string;
  duration_seconds: number | null;
  meeting_type: string | null;
  recorded_at: string | null;
  segments: Segment[] | null;
};

type Body = {
  cuts?: Array<{ at_seconds?: number; title?: string | null }>;
  archive_only?: boolean;
};

function physicalPath(audioPath: string): string {
  if (!audioPath.startsWith("/audios/") || audioPath.includes("..")) {
    throw new Error(`audio_path inválido: ${audioPath}`);
  }
  const relative = audioPath.replace(/^\/audios\//, "");
  return resolvePath(AUDIO_ROOT, relative);
}

function childAudioPaths(childIds: string[]): { logical: string[]; physical: string[] } {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const logical = childIds.map((id) => `/audios/${year}/${month}/${id}.mp3`);
  const physical = logical.map((p) => physicalPath(p));
  return { logical, physical };
}

function filterSegmentsForInterval(
  segments: Segment[],
  start: number,
  end: number,
): { childSegments: Segment[]; transcription: string } {
  const inRange = segments.filter((s) => s.start >= start && s.end <= end);
  const childSegments = inRange.map((s) => ({
    speaker: s.speaker,
    start: s.start - start,
    end: s.end - start,
    text: s.text,
  }));
  const transcription = childSegments.map((s) => s.text).join("");
  return { childSegments, transcription };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body: Body = (await req.json().catch(() => ({}))) as Body;
  const archiveOnly = body.archive_only === true;
  const rawCuts = Array.isArray(body.cuts) ? body.cuts : [];

  const cuts: Array<{ at_seconds: number; title: string | null }> = [];
  for (const c of rawCuts) {
    if (typeof c?.at_seconds !== "number" || !Number.isFinite(c.at_seconds)) continue;
    const title = typeof c?.title === "string" ? c.title.trim().slice(0, 200) : null;
    cuts.push({ at_seconds: c.at_seconds, title: title || null });
  }
  cuts.sort((a, b) => a.at_seconds - b.at_seconds);

  let createdAudioPaths: string[] = [];
  let tempDir: string | null = null;
  let cleanupTemp = true;

  try {
    const result = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // 1) Lock + validate pai
        const r = await c.query<ParentRow>(
          `SELECT id, status, parent_meeting_id, audio_path, duration_seconds,
                  meeting_type, recorded_at::text AS recorded_at, segments
           FROM meetings WHERE id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (!r.rows.length) throw new Error("NOT_FOUND");
        const parent = r.rows[0];
        if (parent.status === "archived_session") throw new Error("ALREADY_ARCHIVED");
        if (parent.parent_meeting_id) throw new Error("IS_CHILD");
        const duration = parent.duration_seconds || 0;
        if (duration <= 0) throw new Error("PARENT_NO_DURATION");

        // 2) Caso archive_only: só arquiva
        if (archiveOnly) {
          await c.query(
            `UPDATE meetings SET status='archived_session', needs_segmentation=false
             WHERE id = $1::uuid`,
            [id],
          );
          await c.query("COMMIT");
          return { parent, children: [] as ChildResult[], archived: true };
        }

        // 3) Validate cuts
        for (const cut of cuts) {
          if (cut.at_seconds <= 0 || cut.at_seconds >= duration) {
            throw new Error(`CUT_OUT_OF_RANGE:${cut.at_seconds}`);
          }
        }
        const positions = [0, ...cuts.map((c) => c.at_seconds), duration];
        for (let i = 0; i < positions.length - 1; i++) {
          const segDur = positions[i + 1] - positions[i];
          if (segDur < DETECT_CONSTANTS.MIN_SEGMENT_DURATION) {
            throw new Error(`SEGMENT_TOO_SHORT:${segDur}`);
          }
        }
        const intervals: Array<{ start: number; end: number; title: string | null }> = [];
        for (let i = 0; i < positions.length - 1; i++) {
          intervals.push({
            start: positions[i],
            end: positions[i + 1],
            title: i === 0 ? null : cuts[i - 1].title,
          });
        }

        // 4) Gera UUIDs e paths dos filhos
        const childIds = intervals.map(() => randomUUID());
        const { logical: logicalPaths, physical: physicalPaths } = childAudioPaths(childIds);

        // 5) ffmpeg em temp dir (evita poluir /audios em caso de falha)
        const parentPhys = physicalPath(parent.audio_path);
        tempDir = await mkdtemp(`${tmpdir()}/segments-${id}-`);
        const tempPaths = childIds.map((cid) => `${tempDir}/${cid}.mp3`);
        const clipIntervals: ClipInterval[] = intervals.map((iv, i) => ({
          start: iv.start,
          end: iv.end,
          outputPath: tempPaths[i],
        }));
        await clipAudio(parentPhys, clipIntervals);

        // 6) INSERT filhos
        const childResults: ChildResult[] = [];
        const parentSegments = parent.segments || [];
        for (let i = 0; i < intervals.length; i++) {
          const iv = intervals[i];
          const cid = childIds[i];
          const { childSegments, transcription } = filterSegmentsForInterval(
            parentSegments,
            iv.start,
            iv.end,
          );
          await c.query(
            `INSERT INTO meetings (
               id, source, meeting_type, original_filename, audio_path,
               duration_seconds, recorded_at, status, transcription, segments,
               parent_meeting_id, segment_index, segment_start_offset, segment_end_offset
             ) VALUES (
               $1::uuid, 'segmented', $2, $3, $4,
               $5, $6, 'received', $7, $8::jsonb,
               $9::uuid, $10, $11, $12
             )`,
            [
              cid,
              parent.meeting_type,
              `segment-${i + 1}.mp3`,
              logicalPaths[i],
              Math.round(iv.end - iv.start),
              parent.recorded_at,
              transcription,
              JSON.stringify(childSegments),
              parent.id,
              i,
              iv.start,
              iv.end,
            ],
          );
          childResults.push({
            id: cid,
            start: iv.start,
            end: iv.end,
            title: iv.title,
            audio_path: logicalPaths[i],
            physical_temp: tempPaths[i],
            physical_final: physicalPaths[i],
          });
        }

        // 7) Arquiva pai
        await c.query(
          `UPDATE meetings SET status='archived_session', needs_segmentation=false
           WHERE id = $1::uuid`,
          [id],
        );

        // 8) Commit (a partir daqui não rola rollback do DB)
        await c.query("COMMIT");

        // 9) Move arquivos do temp pro destino final (post-commit; falha aqui só logga)
        for (const child of childResults) {
          await rename(child.physical_temp, child.physical_final);
          createdAudioPaths.push(child.physical_final);
        }
        cleanupTemp = false; // já moveu tudo
        return { parent, children: childResults, archived: false };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });

    // 10) Fire-and-forget: dispara workflow novo pra cada filho
    for (const child of result.children) {
      fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: child.id }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        console.warn(`[segments] webhook n8n falhou pra ${child.id}`);
      });
    }

    // 11) WhatsApp único
    if (result.archived) {
      sendWhatsApp(`📦 Sessão arquivada sem segmentação.`).catch(() => {});
    } else if (result.children.length > 0) {
      const recordedAt = result.parent.recorded_at;
      const dateStr = recordedAt
        ? new Date(recordedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
        : "hoje";
      sendWhatsApp(
        `✂️ Sessão de ${dateStr} segmentada em ${result.children.length} reuniões. Tarefas serão extraídas em segundo plano.`,
      ).catch(() => {});
    }

    return NextResponse.json({
      parent_id: result.parent.id,
      archived_only: result.archived,
      segments_created: result.children.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        title: c.title,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 :
      msg === "ALREADY_ARCHIVED" ? 409 :
      msg === "IS_CHILD" ? 409 :
      msg.startsWith("CUT_") || msg.startsWith("SEGMENT_") || msg === "PARENT_NO_DURATION" ? 400 :
      500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    // Cleanup do temp dir caso algo tenha falhado antes do rename
    if (tempDir && cleanupTemp) {
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

type ChildResult = {
  id: string;
  start: number;
  end: number;
  title: string | null;
  audio_path: string;
  physical_temp: string;
  physical_final: string;
};
```

- [ ] **Step 2: Testar localmente que o módulo compila**

```bash
cd frontend && bun run build 2>&1 | tail -20
```

Esperado: build sem erro de TS na nova rota. Se houver erro, ler e corrigir.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/meetings/[id]/segments/route.ts
git commit -m "feat(api): PATCH /api/meetings/[id]/segments — fatia sessão longa em N filhos"
```

---

## Task 7: Página servidor `/reunioes/[id]/segmentar`

**Files:**
- Create: `frontend/app/reunioes/[id]/segmentar/page.tsx`

Carrega meeting, valida que é pai não-arquivado, computa cortes iniciais, renderiza o client component.

- [ ] **Step 1: Implementar a página**

```tsx
// frontend/app/reunioes/[id]/segmentar/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { query } from "@/lib/db";
import { detectCuts, type Segment } from "@/lib/detect-cuts";
import { SegmentTimeline } from "./segment-timeline";

export const dynamic = "force-dynamic";

type MeetingRow = {
  id: string;
  status: string;
  parent_meeting_id: string | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  segments: Segment[] | null;
};

async function fetchMeeting(id: string): Promise<MeetingRow | null> {
  const rows = await query<MeetingRow>(
    `SELECT id, status, parent_meeting_id, duration_seconds,
            to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
            segments
     FROM meetings WHERE id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

export default async function SegmentarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = await fetchMeeting(id);
  if (!meeting) redirect("/reunioes");
  if (meeting.parent_meeting_id) redirect(`/reunioes/${id}`);
  if (meeting.status === "archived_session") redirect("/reunioes");

  const segments = meeting.segments ?? [];
  const duration = meeting.duration_seconds || 0;

  if (segments.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          href={`/reunioes/${id}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
        >
          <ArrowLeft size={14} /> voltar pra reunião
        </Link>
        <div className="paper-card rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            Esse áudio não tem transcrição diarizada — não dá pra detectar cortes.
            Você ainda pode arquivar sem segmentar.
          </p>
          <SegmentTimeline
            meetingId={id}
            initialCuts={[]}
            duration={duration}
            segments={[]}
            recordedAt={meeting.recorded_at}
            archiveOnly
          />
        </div>
      </div>
    );
  }

  const initialCuts = detectCuts(segments, duration);

  return (
    <div className="space-y-6 sm:space-y-8">
      <Link
        href={`/reunioes/${id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ArrowLeft size={14} /> voltar pra reunião
      </Link>

      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Segmentar áudio longo
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          Onde uma reunião{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            vira outra.
          </span>
        </h1>
        <p className="text-[13px] text-[color:var(--muted-strong)] max-w-md">
          Confirma os cortes propostos ou ajusta manualmente. Cada segmento vira
          uma reunião independente com tarefas extraídas separadamente.
        </p>
      </header>

      <SegmentTimeline
        meetingId={id}
        initialCuts={initialCuts}
        duration={duration}
        segments={segments}
        recordedAt={meeting.recorded_at}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit (junto com o client component da próxima task)**

Deferir o commit pra Task 8 (precisamos do componente client pra build passar).

---

## Task 8: Client component `segment-timeline.tsx`

**Files:**
- Create: `frontend/app/reunioes/[id]/segmentar/segment-timeline.tsx`

UI da revisão de cortes. Audio player, lista de segmentos + cortes editáveis, botões "confirmar" e "arquivar sem segmentar".

- [ ] **Step 1: Implementar o componente**

```tsx
// frontend/app/reunioes/[id]/segmentar/segment-timeline.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X, Plus, Archive } from "lucide-react";
import type { Cut, Segment } from "@/lib/detect-cuts";
import { DETECT_CONSTANTS } from "@/lib/detect-cuts";
import { cn } from "@/lib/utils";

function fmtTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtDurShort(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}`;
  return `${m}min`;
}

function parseTime(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  return h * 3600 + min * 60 + sec;
}

type EditableCut = { at_seconds: number; title: string; reasons: string[]; confidence: number };

export function SegmentTimeline({
  meetingId,
  initialCuts,
  duration,
  segments,
  recordedAt,
  archiveOnly,
}: {
  meetingId: string;
  initialCuts: Cut[];
  duration: number;
  segments: Segment[];
  recordedAt: string | null;
  archiveOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cuts, setCuts] = useState<EditableCut[]>(() =>
    initialCuts.map((c) => ({
      at_seconds: c.at_seconds,
      title: "",
      reasons: c.reasons,
      confidence: c.confidence,
    })),
  );
  const [newCutInput, setNewCutInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positions = useMemo(
    () => [0, ...cuts.map((c) => c.at_seconds), duration],
    [cuts, duration],
  );

  const intervals = useMemo(
    () =>
      positions.slice(0, -1).map((p, i) => ({
        start: p,
        end: positions[i + 1],
        durationSeconds: positions[i + 1] - p,
        speakers: Array.from(
          new Set(
            segments
              .filter((s) => s.start >= p && s.end <= positions[i + 1])
              .map((s) => s.speaker),
          ),
        ).sort(),
        firstPhrase: segments
          .filter((s) => s.start >= p && s.end <= positions[i + 1] && s.end - s.start >= 3)
          .slice(0, 1)
          .map((s) => s.text.trim().slice(0, 140))[0] || "",
      })),
    [positions, segments],
  );

  const intervalErrors = useMemo(() => {
    const errs: string[] = [];
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i].durationSeconds < DETECT_CONSTANTS.MIN_SEGMENT_DURATION) {
        errs.push(
          `segmento ${i + 1} tem ${fmtDurShort(intervals[i].durationSeconds)} (mín. ${DETECT_CONSTANTS.MIN_SEGMENT_DURATION / 60}min)`,
        );
      }
    }
    return errs;
  }, [intervals]);

  function moveCut(idx: number, newAt: number) {
    setCuts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], at_seconds: newAt };
      next.sort((a, b) => a.at_seconds - b.at_seconds);
      return next;
    });
  }

  function removeCut(idx: number) {
    setCuts((prev) => prev.filter((_, i) => i !== idx));
  }

  function addCut() {
    const sec = parseTime(newCutInput);
    if (sec === null || sec <= 0 || sec >= duration) {
      setError("formato inválido — use HH:MM:SS dentro da duração do áudio");
      return;
    }
    setError(null);
    setNewCutInput("");
    setCuts((prev) => {
      const next = [
        ...prev,
        { at_seconds: sec, title: "", reasons: ["manual"], confidence: 1 },
      ];
      next.sort((a, b) => a.at_seconds - b.at_seconds);
      return next;
    });
  }

  async function submitSegments() {
    if (intervalErrors.length > 0) {
      setError(intervalErrors.join("; "));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuts: cuts.map((c) => ({ at_seconds: c.at_seconds, title: c.title || null })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push("/reunioes?segmented=1"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function archiveOnlyAction() {
    if (!confirmArchive) {
      setConfirmArchive(true);
      setTimeout(() => setConfirmArchive(false), 5000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive_only: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push("/reunioes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (archiveOnly) {
    return (
      <div className="mt-6 space-y-3">
        {error && (
          <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={archiveOnlyAction}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {busy ? <Sparkles size={12} className="animate-pulse" /> : <Archive size={12} />}
          {confirmArchive ? "clique de novo pra confirmar" : "arquivar sem segmentar"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5">
        <audio
          controls
          preload="metadata"
          src={`/api/audio/${meetingId}`}
          className="w-full"
        />
        <p className="text-[12px] text-[color:var(--muted)] mt-2">
          {fmtDurShort(duration)} total · {cuts.length} cortes propostos · {intervals.length} segmentos
        </p>
      </div>

      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {intervals.map((iv, i) => (
          <div key={`iv-${i}`}>
            <div className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5 space-y-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
                  Segmento {i + 1} · {fmtTime(iv.start)}–{fmtTime(iv.end)} ({fmtDurShort(iv.durationSeconds)})
                </p>
              </div>
              <p className="text-[12px] text-[color:var(--muted-strong)]">
                Speakers: {iv.speakers.join(", ") || "—"}
              </p>
              {iv.firstPhrase && (
                <p className="text-[12px] text-[color:var(--muted-strong)] italic line-clamp-2">
                  &ldquo;{iv.firstPhrase}…&rdquo;
                </p>
              )}
              {i < cuts.length && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={cuts[i].title}
                    onChange={(e) =>
                      setCuts((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i], title: e.target.value };
                        return next;
                      })
                    }
                    placeholder="título opcional do próximo segmento…"
                    className="w-full text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
                  />
                </div>
              )}
            </div>

            {i < cuts.length && (
              <CutRow
                cut={cuts[i]}
                idx={i}
                duration={duration}
                prevPos={positions[i]}
                nextPos={positions[i + 2]}
                onMove={moveCut}
                onRemove={removeCut}
              />
            )}
          </div>
        ))}
      </div>

      <div className="paper-card rounded-2xl border border-dashed border-[color:var(--border)] p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newCutInput}
            onChange={(e) => setNewCutInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCut();
            }}
            placeholder="HH:MM:SS"
            className="flex-1 min-w-[140px] text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
          />
          <button
            type="button"
            onClick={addCut}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
          >
            <Plus size={12} /> adicionar corte
          </button>
        </div>
      </div>

      {intervalErrors.length > 0 && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {intervalErrors.join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-[color:var(--border)]/50">
        <button
          type="button"
          onClick={submitSegments}
          disabled={busy || intervalErrors.length > 0}
          className="inline-flex items-center gap-1 text-[13px] px-4 py-2 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {busy ? <Sparkles size={12} className="animate-pulse" /> : <Check size={12} />}
          confirmar e criar {intervals.length} reuniões
        </button>
        <button
          type="button"
          onClick={archiveOnlyAction}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:opacity-80 disabled:opacity-50"
        >
          <Archive size={12} />
          {confirmArchive ? "clique de novo pra confirmar" : "arquivar sem segmentar"}
        </button>
      </div>
    </div>
  );
}

function CutRow({
  cut,
  idx,
  duration,
  prevPos,
  nextPos,
  onMove,
  onRemove,
}: {
  cut: EditableCut;
  idx: number;
  duration: number;
  prevPos: number;
  nextPos: number;
  onMove: (idx: number, newAt: number) => void;
  onRemove: (idx: number) => void;
}) {
  const [draft, setDraft] = useState<string>(fmtTime(cut.at_seconds));
  const [localErr, setLocalErr] = useState<string | null>(null);

  function commit() {
    const sec = parseTime(draft);
    if (sec === null) {
      setLocalErr("HH:MM:SS inválido");
      return;
    }
    const minAt = prevPos + DETECT_CONSTANTS.MIN_SEGMENT_DURATION;
    const maxAt = nextPos - DETECT_CONSTANTS.MIN_SEGMENT_DURATION;
    if (sec < minAt || sec > maxAt) {
      setLocalErr(`fora do intervalo permitido (${fmtTime(minAt)}–${fmtTime(maxAt)})`);
      return;
    }
    if (sec <= 0 || sec >= duration) {
      setLocalErr("fora da duração do áudio");
      return;
    }
    setLocalErr(null);
    onMove(idx, sec);
  }

  return (
    <div className="my-2 mx-3 px-3 py-2 rounded-xl bg-[color:var(--accent)]/30 border border-dashed border-[color:var(--border)]">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono text-[color:var(--muted-strong)]">✂️ corte</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cn(
            "font-mono text-[11px] px-2 py-0.5 rounded bg-[color:var(--card)] border outline-none w-[110px]",
            localErr
              ? "border-[color:var(--urgent)]"
              : "border-[color:var(--border)] focus:border-[color:var(--foreground)]",
          )}
        />
        <span className="text-[color:var(--muted)]">·</span>
        <span className="text-[color:var(--muted)]">{cut.reasons.join(" + ")}</span>
        <button
          type="button"
          onClick={() => onRemove(idx)}
          className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--urgent-bg)] text-[color:var(--urgent)] hover:opacity-80"
        >
          <X size={10} /> remover
        </button>
      </div>
      {localErr && (
        <p className="text-[10px] text-[color:var(--urgent)] mt-1">{localErr}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar build**

```bash
cd frontend && bun run build 2>&1 | tail -20
```

Esperado: build verde.

- [ ] **Step 3: Commit (página + componente juntos)**

```bash
git add frontend/app/reunioes/[id]/segmentar/
git commit -m "feat(frontend): página /reunioes/[id]/segmentar"
```

---

## Task 9: Banner `needs_segmentation` no `/reunioes`

**Files:**
- Modify: `frontend/app/reunioes/page.tsx`

Adiciona `needs_segmentation` no SELECT e renderiza banner ⚠️ no card quando true.

- [ ] **Step 1: Ler o arquivo atual pra ver onde inserir**

```bash
wc -l frontend/app/reunioes/page.tsx
```

Esperado: arquivo existe (~100-200 linhas).

- [ ] **Step 2: Modificar o SELECT da `fetchMeetings` pra incluir `needs_segmentation`**

Encontrar o bloco `query<Meeting>` e adicionar `m.needs_segmentation` no SELECT:

```tsx
// adicionar ao type Meeting:
type Meeting = {
  // ... existentes
  needs_segmentation: boolean;
};

// no SELECT:
return query<Meeting>(`
  SELECT
    m.id, m.source, m.meeting_type,
    to_char(coalesce(m.recorded_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
    to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    m.status, m.summary, m.duration_seconds, m.needs_segmentation,
    (SELECT count(*) FROM tarefas WHERE meeting_id = m.id)::int AS n_tarefas,
    (SELECT count(*) FROM tarefas WHERE meeting_id = m.id AND owner = 'vitor')::int AS n_minhas
  FROM meetings m
  WHERE m.status != 'archived_session'
  ORDER BY coalesce(m.recorded_at, m.created_at) DESC
  LIMIT 100;
`);
```

(O `WHERE m.status != 'archived_session'` resolve a Task 12 de filtro junto.)

- [ ] **Step 3: Renderizar banner no card**

No JSX que renderiza cada meeting (procurar `MeetingIcon` ou `StatusPill` no arquivo), adicionar antes do `summary` ou logo abaixo do header do card:

```tsx
{meeting.needs_segmentation && (
  <div className="text-[11px] text-[color:var(--warm)] bg-[color:var(--warm-bg)] px-2 py-1 rounded-full inline-flex items-center gap-1 w-fit">
    ⚠️ áudio longo · <Link href={`/reunioes/${meeting.id}/segmentar`} className="underline">revisar segmentação</Link>
  </div>
)}
```

Garantir import de `Link` (já existe no arquivo).

- [ ] **Step 4: Validar build**

```bash
cd frontend && bun run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/reunioes/page.tsx
git commit -m "feat(frontend): banner needs_segmentation + filtra archived_session no /reunioes"
```

---

## Task 10: Atualizar workflow n8n `Acoes - Audio Ingest`

**Files:**
- Modify: workflow live `98jEiWWSAKFWEP6B` via n8n API
- Modify: `n8n-workflows/acoes-audio-ingest.json` (resolver defasagem com o live)

Adiciona dois nós novos entre `12. UPDATE meeting (done)` e `13. Build WhatsApp Message`: um Code que decide se precisa segmentar, e um Postgres que persiste a flag. Atualiza o template do nó 13 pra mencionar segmentação quando aplicável.

- [ ] **Step 1: Baixar o workflow live atual e salvar em `/tmp/audio-ingest-live.json`**

```bash
source .env
N8N_URL="https://n8n.vitorgambetti.com.br"
curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  > /tmp/audio-ingest-live.json
python3 -c "import json; print(len(json.load(open('/tmp/audio-ingest-live.json'))['nodes']), 'nodes')"
```

Esperado: ~18-19 nodes (estado atual antes da mudança).

- [ ] **Step 2: Editar o workflow no n8n UI**

Abrir `https://n8n.vitorgambetti.com.br/workflow/98jEiWWSAKFWEP6B` no navegador. Adicionar:

**Nó `12c. Mark Needs Segmentation` (Code), conectado depois de `12. UPDATE meeting (done)`:**

```javascript
const meta = $('3. Prepare Metadata').first().json;
const duration = meta.duration_seconds_local || 0;
const needs = duration > 3600;
return [{
  json: {
    needs_segmentation: needs,
    meeting_id: meta.meeting_id,
    duration_seconds: duration
  }
}];
```

**Nó `12d. UPDATE needs_segmentation` (Postgres):**
- Operation: `Update`
- Schema: `public`
- Table: `meetings`
- Mapping mode: `Define Below`
- Values:
  - `id`: `{{ $json.meeting_id }}`
  - `needs_segmentation`: `{{ $json.needs_segmentation }}`
- Matching columns: `id`

Conectar `12. UPDATE meeting (done)` → `12c.` → `12d.` → `13. Build WhatsApp Message`.

**Editar o nó `13. Build WhatsApp Message`** pra acrescentar uma linha extra quando `$json.needs_segmentation === true`. Exemplo de adendo:

```javascript
// no final do nó 13, antes do return final
const needsSeg = $('12c. Mark Needs Segmentation').first().json.needs_segmentation;
const meetingId = $('3. Prepare Metadata').first().json.meeting_id;
if (needsSeg) {
  // Acrescentar linha à mensagem existente
  message += `\n\n🎙️ Áudio longo (${(duration/3600).toFixed(1)}h) — revisar segmentação: https://n8n-assistente-frontend.tatetz.easypanel.host/reunioes/${meetingId}/segmentar`;
}
```

> Adaptar a sintaxe à estrutura real do nó 13 (que pode usar template literals ou outra abordagem — confirmar baixando o jsCode com o comando do Step 1).

Salvar. Confirmar que o workflow ativou sem erro.

- [ ] **Step 3: Baixar o workflow live atualizado e gravar no git**

```bash
source .env
N8N_URL="https://n8n.vitorgambetti.com.br"
curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | python3 -m json.tool > n8n-workflows/acoes-audio-ingest.json
git diff --stat n8n-workflows/acoes-audio-ingest.json
```

Esperado: diff grande (o arquivo no git estava defasado vs o live). Não é problema — o ponto é deixar o arquivo no git refletindo o estado atual.

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/acoes-audio-ingest.json
git commit -m "n8n: nodes 12c/12d marcam needs_segmentation + mensagem WhatsApp pra áudios longos"
```

---

## Task 11: Novo workflow n8n `Acoes - Process Segment`

**Files:**
- Create: workflow live via n8n API
- Create: `n8n-workflows/acoes-process-segment.json`

Sub-workflow disparado pelo PATCH pra cada filho criado. Versão enxuta do `Acoes - Audio Ingest` (sem upload de áudio, sem Whisper — meeting já tem transcrição salva pelo PATCH).

- [ ] **Step 1: Criar o workflow via n8n UI**

Abrir `https://n8n.vitorgambetti.com.br/`, criar workflow novo `Acoes - Process Segment`. Adicionar nós:

1. **Webhook**
   - HTTP Method: `POST`
   - Path: `acoes-process-segment`
   - Authentication: `Header Auth` (mesma config do principal — copiar credential)

2. **Validate Auth (IF)** — clonar do principal.

3. **SELECT meeting (Postgres)**
   - Operation: `Execute Query`
   - Query: `SELECT id, transcription, segments, duration_seconds, recorded_at FROM meetings WHERE id = $1::uuid`
   - Params: `{{ $json.body.meeting_id }}`

4. **UPDATE meeting status='analyzing' (Postgres)**
   - Operation: `Update`
   - Match: `id = {{ $json.body.meeting_id }}`
   - Set: `status = 'analyzing'`

5. **GPT Extract Actions (OpenAI)** — duplicar o nó 8 do workflow principal (mesmo modelo `gpt-5.1`, mesmo system prompt). Input: `{{ $('SELECT meeting').first().json.transcription }}`.

6. **Parse Actions (Code)** — duplicar o nó 9.

7. **Has Actions? (IF)** — duplicar.

8. **INSERT tarefas (Postgres)** — duplicar nó 11.

9. **UPDATE meeting status='done' (Postgres)** — duplicar nó 12.

10. **Call voice-svc/identify (HTTP)** — duplicar nó 12b, com `meeting_id` apontando para o filho:
    - URL: `http://voice-svc:8000/identify`
    - Method: POST
    - Body: `{ "meeting_id": "{{ $('Webhook').first().json.body.meeting_id }}" }`
    - Timeout: 120000ms
    - Never Error: true

Salvar e ativar.

- [ ] **Step 2: Testar o webhook isolado**

```bash
source .env
# Use um meeting_id válido de uma meeting com transcription preenchida
TEST_MEETING_ID="<UUID de uma meeting existente>"
curl -s -X POST "https://n8n.vitorgambetti.com.br/webhook/acoes-process-segment" \
  -H "Content-Type: application/json" \
  -H "X-Auth: $WEBHOOK_TOKEN" \
  -d "{\"meeting_id\":\"$TEST_MEETING_ID\"}"
```

Esperado: 200 OK. Conferir no n8n UI que a execução completou e que tarefas novas apareceram pra `meeting_id` (ou que GPT decidiu não criar nenhuma).

- [ ] **Step 3: Baixar o JSON e gravar no git**

```bash
source .env
N8N_URL="https://n8n.vitorgambetti.com.br"
# Pegar o ID do novo workflow
NEW_ID=$(curl -s "$N8N_URL/api/v1/workflows?limit=10" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | python3 -c "import sys,json; [print(w['id']) for w in json.load(sys.stdin)['data'] if w['name']=='Acoes - Process Segment']")
curl -s "$N8N_URL/api/v1/workflows/$NEW_ID" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | python3 -m json.tool > n8n-workflows/acoes-process-segment.json
```

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/acoes-process-segment.json
git commit -m "n8n: workflow Acoes - Process Segment pra cada filho de uma sessão segmentada"
```

---

## Task 12: Verificação end-to-end manual

Não há código novo — só roteiro de validação contra a aplicação rodando.

- [ ] **Step 1: Pré-condições**

- Migration 0006 aplicada (Task 1 step 2)
- Frontend redeployado com ffmpeg + novo código (Tasks 2-9)
- Ambos workflows n8n no estado final (Tasks 10-11)

- [ ] **Step 2: Confirmar que detector funciona em meeting existente**

Pegar uma meeting recente com `duration_seconds > 3600` (8h+ se possível) que ainda esteja `status='done'`. Pode forçar `needs_segmentation=true` via SQL pra testar a UI:

```sql
UPDATE meetings SET needs_segmentation = true
WHERE id = '<uuid>'
  AND status = 'done'
  AND parent_meeting_id IS NULL
  AND duration_seconds > 3600;
```

Abrir `https://n8n-assistente-frontend.tatetz.easypanel.host/reunioes/<uuid>/segmentar`. Verificar:
- ✅ Página carrega em < 2s
- ✅ Player de áudio toca o pai inteiro
- ✅ Cortes propostos aparecem com tempos plausíveis + razões legíveis
- ✅ Pode mover, remover, adicionar cortes manuais

- [ ] **Step 3: Confirmar segmentação real**

Clicar "confirmar e criar N reuniões". Esperar resposta. Verificar:
- ✅ PATCH retorna 200 em < 30s
- ✅ Redireciona pra `/reunioes`
- ✅ WhatsApp único chegou ("Sessão de DD/MM segmentada em N reuniões…")
- ✅ Pai sumiu da listagem; N filhos apareceram

```sql
SELECT id, status, parent_meeting_id, segment_index, segment_start_offset, segment_end_offset, duration_seconds
FROM meetings
WHERE parent_meeting_id = '<pai_uuid>' OR id = '<pai_uuid>'
ORDER BY segment_index NULLS FIRST;
```
Esperado: 1 linha do pai com `status='archived_session'`, N linhas dos filhos com offsets coerentes (sem gap, sem overlap).

- [ ] **Step 4: Confirmar tarefas e identify nos filhos**

Aguardar ~5min. Para cada filho:
- ✅ `/reunioes/<filho_id>` mostra player tocando só o trecho
- ✅ `meeting.status='done'`
- ✅ Tarefas extraídas listadas
- ✅ `speaker_labels_proposed` populado (voice-svc/identify rodou)

```sql
SELECT id, status, (SELECT count(*) FROM tarefas WHERE meeting_id = m.id) AS n_tarefas,
       speaker_labels_proposed
FROM meetings m WHERE parent_meeting_id = '<pai_uuid>';
```

- [ ] **Step 5: Testar archive_only**

Em outra meeting (forçar `needs_segmentation=true` igual ao Step 2), abrir `/segmentar`, clicar "arquivar sem segmentar" duas vezes. Verificar:
- ✅ Pai vira `status='archived_session'` sem criar filhos
- ✅ Some do `/reunioes`
- ✅ WhatsApp não foi disparado (ou foi com mensagem de arquivamento — tudo OK)

```sql
SELECT id, status FROM meetings WHERE id = '<uuid>';
-- Esperado: status = 'archived_session'
SELECT count(*) FROM meetings WHERE parent_meeting_id = '<uuid>';
-- Esperado: 0
```

- [ ] **Step 6: Marcar tudo como funcional**

Se algum step falhou, voltar e corrigir antes de fechar. Se tudo passou:

```bash
git log --oneline -15
# Confirmar que todos os commits das tasks 1-11 estão presentes
```

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| ffmpeg não instalado no container final (esqueceu o rebuild) | Task 2 step 2 valida via `docker run` se Docker local existir. Em produção, o erro vai aparecer no PATCH como 500 com stderr `ffmpeg: not found` — verificar build no easypanel. |
| WhatsApp Evolution API path errado | Task 5 step 1 inclui comando pra confirmar o path do workflow live antes de commitar. |
| Algoritmo erra muito na prática | Spec define métrica de sucesso ≥70% e prevê Abordagem B (refinamento GPT) como evolução. Não é bloqueio do MVP. |
| Pai segmentado por engano → perde tarefas | Pai não tem tarefas antes da segmentação? Confirmar: `SELECT count(*) FROM tarefas WHERE meeting_id = '<pai>'` antes. Se já tem tarefas extraídas, deletar antes de segmentar OU aceitar que ficam órfãs (FK CASCADE pode apagar se o pai for deletado — mas a operação não deleta, só arquiva). |
| Race: dois cliques no "confirmar" | `SELECT FOR UPDATE` no PATCH (Task 6 step 1) + `status='archived_session'` faz a segunda chamada falhar com 409. |

# Segmentação de áudio longo — detectar e separar reuniões dentro de uma gravação contínua

**Data:** 2026-05-21
**Status:** Aprovado, pronto pra implementação
**Escopo:** `db/`, `frontend/`, `n8n-workflows/`

## Contexto

Vitor grava o iPhone Voice Memos ligado pelo dia, capturando várias reuniões + conversas + silêncio + ligações num único arquivo. O pipeline atual (`transcribe.sh` → n8n `Acoes - Audio Ingest` → 1 meeting) trata tudo como uma reunião só: GPT-5.1 lê a transcrição inteira e extrai tarefas misturadas, sem distinção de contexto. Resultado: tarefas vagas, contexto perdido, e o `/reunioes` mostra um único bloco gigante de 8h em vez das 3-5 reuniões que de fato aconteceram.

O dado bruto pra resolver isso **já existe**: o `transcribe.sh` usa `gpt-4o-transcribe-diarize` e produz `segments: [{speaker, start, end, text}]` com timestamps cumulativos entre chunks de 20min. O nó 6 do workflow live (`Use Pretranscribed`, editado em 2026-05-20) repassa isso pro nó 7 que salva na coluna `meetings.segments JSONB`. A spec abaixo ativa o uso desse dado pra detectar cortes naturais e fatiar a sessão em N meetings independentes após revisão manual do Vitor.

## Decisões aprovadas (durante brainstorm)

1. **Sinais de corte combinados** — silêncio longo (peso forte) + mudança de speakers (peso fraco, dependente de silêncio coexistir). Mudança de tópico via GPT fica para evolução futura.
2. **Auto-detecta + revisão no frontend** — n8n marca `needs_segmentation=true` quando duração > 60min e dispara WhatsApp. Página `/reunioes/[id]/segmentar` mostra cortes propostos, Vitor confirma/move/remove.
3. **Cada segmento vira meeting independente** — gravação original some do `/reunioes` (status `archived_session`). Filhos têm `parent_meeting_id` apontando pro pai pra histórico.
4. **Abordagem A (heurística pura)** — zero custo de LLM na detecção. Extração de tarefas via GPT-5.1 só roda nos filhos. Refinamento semântico fica como evolução se a prática mostrar precisão baixa.
5. **Áudio fatiado fisicamente no momento do save** — `ffmpeg -c copy` (sem reencode, instantâneo). Cada filho tem `audio_path` próprio. Espaço extra desprezível em mp3 48kbps.
6. **Sem drag-and-drop na timeline** — mover corte via input numérico (segundos ou HH:MM:SS). Drag fica como evolução.
7. **WhatsApp único do PATCH** — não envia uma mensagem por filho ao final do GPT extract. Vitor abre `/reunioes` pra ver as tarefas chegando.
8. **Letra do diarize reseta entre chunks** — sinal de "mudança de speakers" só conta como forte quando coincide com silêncio ≥ 90s. Mitigação via embeddings reais (voice-svc) fica fora do MVP.

## Algoritmo de detecção (`detect-cuts.ts`)

Módulo puro, testável, server-side. Sem dependências externas.

```ts
type Segment = { speaker: string; start: number; end: number; text: string }
type Cut = { at_seconds: number; confidence: number; reasons: string[] }

const SILENCE_HARD = 180        // 3min sem voz = peso 1.0
const SILENCE_SOFT = 90         // 90s sem voz = peso 0.5
const SPEAKER_WINDOW = 300      // janela de 5min antes/depois
const SPEAKER_JACCARD_MAX = 0.3
const MIN_SEGMENT_DURATION = 600 // mini-meeting ≥ 10min
const CONFIDENCE_FLOOR = 0.7
const MERGE_DISTANCE = 300       // cortes a < 5min: mantém o de maior confidence
```

**Passos:**
1. **Sinal silêncio**: pra cada `(segments[i], segments[i+1])`, `gap = next.start - curr.end`. `gap ≥ SILENCE_HARD` → peso 1.0; `gap ≥ SILENCE_SOFT` → peso 0.5. Corte fica no meio do gap.
2. **Sinal speakers** (sobre candidatos de silêncio existentes): `set_before` = speakers nos últimos `SPEAKER_WINDOW`s; `set_after` = próximos `SPEAKER_WINDOW`s. Se Jaccard `|∩|/|∪| < 0.3` E `set_after \ set_before ≠ ∅` (entrou speaker novo) → soma 0.5 ao peso do candidato.
3. **Merge**: cortes a < `MERGE_DISTANCE` entre si → mantém só o de maior confidence.
4. **Filtro de duração**: descarta cortes que criariam segmento < `MIN_SEGMENT_DURATION`.
5. **Filtro de confidence**: descarta peso < `CONFIDENCE_FLOOR`.
6. Retorna ordenado por `at_seconds`. `reasons[]` lista os critérios que dispararam ("silêncio 3min12s", "speakers C,D novos").

## Arquitetura de dados

### Migration `db/0006_meeting_segmentation.sql` (nova)

```sql
ALTER TABLE meetings
  ADD COLUMN parent_meeting_id UUID NULL REFERENCES meetings(id) ON DELETE SET NULL,
  ADD COLUMN segment_index INT NULL,
  ADD COLUMN segment_start_offset REAL NULL,
  ADD COLUMN segment_end_offset REAL NULL,
  ADD COLUMN needs_segmentation BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX meetings_parent_idx ON meetings(parent_meeting_id) WHERE parent_meeting_id IS NOT NULL;
CREATE INDEX meetings_needs_seg_idx ON meetings(needs_segmentation) WHERE needs_segmentation = true;
```

Aplicar manualmente via dbgate (projeto não tem migration tool — ver `AGENTS.md`).

### Novo status: `archived_session`

Pais segmentados ficam com `status='archived_session'`. Filtro padrão da listagem `/reunioes` exclui esse status. Sem CHECK CONSTRAINT em `status` (texto livre no schema atual).

### `tarefas` (existente)

Continua igual. `meeting_id` aponta pro filho. Pais arquivados não têm tarefas associadas.

## Mudanças no pipeline existente

### n8n workflow `Acoes - Audio Ingest` (live)

Adicionar entre o nó 12 (`UPDATE meeting (done)`) e 13 (`Build WhatsApp Message`):

**Nó novo `12c. Mark Needs Segmentation`** (Code):
```js
const meta = $('3. Prepare Metadata').first().json;
const duration = meta.duration_seconds_local || 0;
const needs = duration > 3600;  // > 60min
return [{ json: { needs_segmentation: needs, meeting_id: meta.meeting_id, duration_seconds: duration } }];
```

**Nó novo `12d. UPDATE needs_segmentation`** (Postgres, condicional via IF anterior se quiser ser estrito): seta `needs_segmentation = $json.needs_segmentation` em `meetings WHERE id = meeting_id`.

**Nó 13 (Build WhatsApp Message)**: atualizar o template pra incluir `🎙️ áudio longo (Xh) — revisar segmentação: <URL>/reunioes/<id>/segmentar` quando `needs_segmentation=true`.

Editar o workflow live via API n8n (PATCH `/workflows/98jEiWWSAKFWEP6B`). Atualizar também `n8n-workflows/acoes-audio-ingest.json` no git (que está defasado — confirmar diff completo).

### n8n workflow `Acoes - Process Segment` (novo)

Cópia enxuta do principal, sem webhook trigger de Mac (recebe `meeting_id` direto). Salvar em `n8n-workflows/acoes-process-segment.json` e criar via API. Nós:

```
1. Webhook (path: acoes-process-segment, espera body { meeting_id })
2. Validate Auth (mesmo IF do principal)
3. SELECT meeting (busca pelo id)
4. UPDATE meeting status='analyzing'
5. GPT Extract Actions (gpt-5.1, mesmo prompt do nó 8 do principal)
6. Parse Actions (mesmo Code do nó 9)
7. Has Actions? (IF)
8. INSERT tarefas
9. UPDATE meeting status='done'
10. Call voice-svc/identify (mesmo do 12b principal, com timeout 120s, neverError)
```

Sem WhatsApp por segmento — mensagem única é enviada pelo PATCH (ver abaixo).

## API: `PATCH /api/meetings/[id]/segments`

Nova rota em `frontend/app/api/meetings/[id]/segments/route.ts`.

### Contrato

```ts
// Input
{
  cuts: Array<{ at_seconds: number; title?: string | null }>
  // ordenados por at_seconds. Lista vazia = arquiva pai sem fatiar
  // (cria 1 filho com intervalo completo OU só arquiva — ver decisão abaixo).
}

// 200 OK
{
  parent_id: string
  segments_created: Array<{
    id: string
    start: number
    end: number
    title: string | null
  }>
}

// 409 Conflict — pai já está com status='archived_session'
// 400 Bad Request — cuts inválidos (overlap, fora da duração, segmento < MIN_SEGMENT_DURATION)
// 404 Not Found — meeting_id não existe
```

### Comportamento

Em transação Postgres:
1. SELECT meeting FOR UPDATE; valida `status != 'archived_session'` e `parent_meeting_id IS NULL` (não dá pra segmentar um filho).
2. Valida cuts: ordenados, dentro de `(0, duration_seconds)`, sem overlap, cada intervalo resultante ≥ `MIN_SEGMENT_DURATION`.
3. Compute intervals `[(0, c1), (c1, c2), ..., (cN, duration)]`.
4. **Lista vazia + `archive_only` ausente/false** (`cuts=[]`, default): cria 1 filho com intervalo `(0, duration)` E arquiva pai. Vitor usa pra "este áudio é uma reunião só, classifique normalmente — sem fatiar".
5. **`archive_only: true`** (campo opcional do input): só arquiva pai, **não cria nenhum filho**. Vitor usa pra descartar a sessão sem extrair tarefas dela. O `cuts` é ignorado nesse modo.
6. Pra cada intervalo (numeração ajustada após adicionar passo 5):
   - Gera UUID do filho.
   - `ffmpeg -ss start -to end -i {parent.audio_path} -c copy {child.audio_path}` em temp dir (`/tmp/segments/<parent_id>/`).
   - Filtra `segments JSONB` do pai por `seg.start >= interval.start && seg.end <= interval.end`. Subtrai `interval.start` de cada `start`/`end` (resultam relativos ao áudio do filho, começando em 0).
   - Concatena `seg.text` filtrados pra montar `transcription`.
   - INSERT meeting com: `parent_meeting_id=pai`, `segment_index=N`, `segment_start_offset=interval.start`, `segment_end_offset=interval.end`, `audio_path`, `transcription`, `segments`, `duration_seconds=interval.end-interval.start`, `status='received'`, `source='segmented'`, `meeting_type`/`recorded_at` herdados.
7. UPDATE pai: `status='archived_session'`, `needs_segmentation=false`.
8. COMMIT.
9. Move arquivos do temp dir pro destino final (post-commit). Se falhar aqui, log erro mas não reverte DB — filhos ficam apontando pra arquivo inexistente; recuperação manual via re-extração ffmpeg do pai.
10. **Fire-and-forget**: pra cada filho criado, `POST $N8N_URL/webhook/acoes-process-segment` com `{meeting_id}`. Erros: log warn, segue.
11. **WhatsApp único**: enviar via Evolution API direto do route (já tem `EVOLUTION_API_URL` no `.env`) — "Sessão de DD/MM segmentada em N reuniões. Tarefas serão extraídas em segundo plano."
12. Return.

**Compatibilidade voice-svc/identify nos filhos**: o voice-svc lê `meeting.segments` do DB e faz `ffmpeg clip` do áudio do meeting nos intervalos `start`-`end` dos turnos. Como o áudio do filho começa em 0 e seus `segments` foram reindexados pra serem relativos ao filho (passo 6), o identify funciona sem mudanças no voice-svc.

### Padrões herdados

- Validação UUID regex e sanitização de payload: ver `frontend/app/api/meetings/[id]/speakers/route.ts:4` e `:65`.
- Resolução de pessoa e padrão get-or-create: idem `speakers/route.ts:20-187`.
- Fire-and-forget de webhook n8n: idem `speakers/route.ts` (chama `acoes-reprocess-tarefas`).
- Erro 404 vs 500: try/catch + `if (err.code === 'NOT_FOUND')`.

## UI: `/reunioes/[id]/segmentar`

Estrutura:

```
frontend/app/reunioes/[id]/segmentar/
  page.tsx                      (server: carrega meeting + computa cuts iniciais)
  segment-timeline.tsx          (client: estado, interação)
  detect-cuts.ts                (puro, testável)
  detect-cuts.test.ts           (bun test)
```

### `page.tsx` (server component)

1. SELECT meeting; valida `status != 'archived_session'` E `parent_meeting_id IS NULL`. Senão redirect pra `/reunioes/[id]`.
2. Se `segments IS NULL` ou `array_length(segments) = 0`: render placeholder "áudio sem transcrição diarizada, não dá pra segmentar".
3. Roda `detectCuts(segments, duration_seconds)` → `initialCuts: Cut[]`.
4. Renderiza `<SegmentTimeline meetingId initialCuts duration segments />`.

### `segment-timeline.tsx` (client)

Estado:
```ts
const [cuts, setCuts] = useState<Cut[]>(initialCuts)
const [busy, setBusy] = useState(false)
const [savedMessage, setSavedMessage] = useState<string|null>(null)
```

Layout (mobile-first, paper-card):

```
← reunião
Áudio de 21/05 · 4h 23min · 8 speakers (A-H)

[▶ audio player único, /api/audio/{parentId}]

Detectei N cortes prováveis. Revise:

─── Segmento 1 · 09:12–10:48 (1h36) ──────────────
Speakers: A, B, C  · primeiras frases:
"bom dia, vamos começar pelo financeiro…"
[✎ título opcional]

[✂️ corte · 10:48 · silêncio 4min + speaker novo
 mover pra: HH:MM:SS [_______] ✕ remover]

─── Segmento 2 · 10:48–13:02 (2h14) ──────────────
...

[+ adicionar corte em HH:MM:SS]

─────────────────────────────────────────────
[✓ confirmar e criar N reuniões]
[arquivar sem segmentar]
```

Componentes:
- **Player**: copy paste do `/reunioes/[id]/page.tsx` (linhas 100-246), apontando pra `/api/audio/{parentId}`.
- **Bloco de segmento**: mostra range (`HH:MM-HH:MM`), duração, speakers únicos, primeiras 1-2 frases (do primeiro turno > 3s, padrão do `identificar`).
- **Bloco de corte**: input `<input type="text">` com máscara HH:MM:SS, botão remover. Valida onChange: novo valor não pode invadir corte adjacente nem deixar segmento < `MIN_SEGMENT_DURATION` — feedback inline vermelho.
- **Adicionar corte**: linha tracejada no fim com botão + input.
- **Confirmar**: desabilita se `busy`. Optimistic — não há estado pra reverter, mostra "criando reuniões..." → ao 200, `router.push('/reunioes')` + toast verde 6s ("N reuniões criadas").
- **Arquivar sem segmentar**: PATCH com `archive_only: true` → confirma inline em 2 cliques (igual delete do `task-row`).

Reuso explícito:
- Padrão optimistic + toast verde 6s: `frontend/components/identify-speakers.tsx:130-138`.
- "primeiras frases" do segmento: lógica de top_turns de `frontend/app/reunioes/[id]/identificar/page.tsx:38-73`.
- Classes Tailwind: `.paper-card`, `.rounded-2xl`, tipografia Fraunces/Geist (ver `frontend/AGENTS.md`).

## Casos de borda

1. **Áudio sem segments** (silent=true ou diarize falhou): página renderiza placeholder "não dá pra segmentar". Botão "arquivar sem segmentar" continua disponível.
2. **Confirmar sem cortes** (apenas remover todos os propostos + confirmar): cria 1 filho com `(0, duration)` + arquiva pai. Equivalente a "este áudio É uma reunião só".
3. **Arquivar sem segmentar** (`archive_only: true`): só arquiva pai, não cria filho. Áudio fica preservado, some do `/reunioes`. Revisitar = SQL manual.
4. **Áudio entre 60min e MIN_SEGMENT_DURATION × 2** (60-120min): detector pode achar 0 ou 1 corte só. Página mostra normalmente; Vitor decide.
5. **`/segmentar` num filho**: bloqueia via valida `parent_meeting_id IS NULL`. Redirect pra `/reunioes/[id]`.
6. **Race (dois cliques no confirmar)**: debounce no client + `status='archived_session'` no SELECT FOR UPDATE = 409.
7. **n8n offline no fire-and-forget**: filhos ficam `status='received'`. Recuperação manual: chamar `/webhook/acoes-process-segment` direto pra cada filho. (Adicionar comando admin futuro.)
8. **ffmpeg falha no meio de N intervalos**: faz operação em temp dir, só move arquivos pro destino final após commit. Se ffmpeg falhar antes do commit, rollback do DB; se falhar no move post-commit, log erro e filho fica apontando pra arquivo inexistente (recuperar via re-extração).
9. **needs_segmentation=true mas Vitor ignora**: `/reunioes` mostra banner ⚠️ "áudio longo aguardando segmentação" no card. Não bloqueia uso normal.
10. **Tarefas duplicadas entre filhos**: não há dedupe. Cada GPT vê só o texto do seu segmento, sem ambiguidade na prática.

## Plano de implementação (ordem mergeável)

Cada item vira commit independente que deixa o sistema funcionando:

1. **DB**: migration `db/0006_meeting_segmentation.sql` (não rompe nada, todos os campos nullable + default).
2. **Detector**: `frontend/lib/detect-cuts.ts` + `detect-cuts.test.ts` com fixtures (silêncio puro, speakers puro, combinado, sem cortes, segmentos muito curtos). Rodar via `bun test`. **Único teste automatizado da spec.**
3. **n8n**: editar workflow live (nós 12c, 12d + WhatsApp template). Atualizar `n8n-workflows/acoes-audio-ingest.json` com o estado final do live (resolver defasagem). Criar workflow novo `acoes-process-segment` (live + JSON em `n8n-workflows/`).
4. **API**: `frontend/app/api/meetings/[id]/segments/route.ts` (PATCH) + helper de ffmpeg + invocação Evolution API.
5. **UI**: página `/reunioes/[id]/segmentar` + componentes.
6. **Banner needs_segmentation**: ajuste no `/reunioes` (card mostra ⚠️ banner quando flag true).
7. **Filtro listagem**: `/reunioes` exclui `status='archived_session'` (uma linha no SELECT).

## Verificação end-to-end

1. **Unit** (item 2 do plano): `cd frontend && bun test detect-cuts` — passa em todos os fixtures.
2. **Manual** com áudio real de dia inteiro do iCloud:
   - Confirmar que `meeting.needs_segmentation=true` foi setado pelo n8n.
   - Confirmar WhatsApp chegou com link pra `/segmentar`.
   - Abrir `/reunioes/[id]/segmentar`: cortes propostos aparecem em < 1s, player toca o áudio inteiro do pai.
   - Mover um corte, remover outro, adicionar manual: validações disparam corretamente.
   - Confirmar: PATCH retorna < 30s (gargalo é ffmpeg copy), redireciona pra `/reunioes`, toast verde aparece, WhatsApp único chega.
3. **Confirmar pós-PATCH**:
   - `/reunioes` mostra N filhos (não mostra pai).
   - Cada filho em `/reunioes/{id}`: player toca só o trecho, transcrição bate, speakers identificados em < 2min (voice-svc/identify).
   - Tarefas extraídas pelos workflows `Acoes - Process Segment` chegam em < 5min.
4. **DB sanity**:
   ```sql
   SELECT id, status, parent_meeting_id, segment_index, segment_start_offset, segment_end_offset, duration_seconds
   FROM meetings
   WHERE parent_meeting_id = '<pai_id>' OR id = '<pai_id>'
   ORDER BY segment_index NULLS FIRST;
   ```
   Espera: 1 linha do pai com `status='archived_session'`, N linhas dos filhos com `parent_meeting_id` preenchido, offsets ordenados sem gap.

## Métrica de sucesso prática

Rodar num áudio real de 8h+ e Vitor concordar com ≥ 70% dos cortes propostos sem adicionar manuais. Se cair abaixo, próxima iteração é Abordagem B (refinamento via GPT-5.1 lendo a transcrição com cortes propostos e ajustando por mudança de tópico).

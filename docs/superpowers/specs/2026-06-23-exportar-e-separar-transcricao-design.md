# Exportar transcrição + separar por mudança de assunto

**Data:** 2026-06-23
**Status:** Aprovado (aguardando review do spec)
**Relacionado:** [`2026-05-21-segmentacao-audio-longo-design.md`](2026-05-21-segmentacao-audio-longo-design.md) (segmentação automática por silêncio)

## Problema

Hoje não existe nenhuma forma de **baixar a transcrição** de uma reunião — os dados estão todos no banco (`segments`, `speaker_labels`), mas não há botão, rota nem formato de export em lugar nenhum.

Além disso, um mesmo áudio às vezes contém **mais de uma reunião** ou **muda tanto de assunto** que vale separar. A segmentação automática existente (`/reunioes/[id]/segmentar`) só detecta cortes por **silêncio + troca de voz** (`detectCuts` em [`frontend/lib/detect-cuts.ts`](../../../frontend/lib/detect-cuts.ts)), com piso de 10 min por trecho. Isso **não cobre** o caso "mesmas pessoas, sem silêncio, mas o assunto virou outro" — que é justamente quando o usuário, lendo a transcrição, percebe a virada.

A solução é dar ao usuário um caminho **manual, guiado pelo conteúdo**: ele lê a transcrição e marca, na própria linha, onde o assunto muda — escolhendo na hora se aquilo vira **reunião separada** ou só uma **seção** dentro da mesma reunião.

## Decisões de produto (confirmadas com o usuário)

1. **Corte 100% manual** — sem detecção por IA. O usuário lê e clica na linha da transcrição.
2. **Duas saídas, escolhidas na hora:** o corte pode (a) **separar em reuniões** independentes, ou (b) **marcar uma seção** dentro da mesma reunião.
3. **Todos os formatos de export:** `.txt`, `.srt`/`.vtt`, `.md`, copiar-tudo, e PDF.
4. **PDF = impressão nativa** (print-stylesheet + "Salvar como PDF" do navegador), não PDF gerado no servidor.
5. **Separar = cortes acumulados + 1 confirmação** (não corte imediato a cada clique).
6. **Piso manual de 30s** ao separar (em vez dos 10 min da detecção automática).

## Arquitetura

Tudo nasce **dentro da transcrição** ([`frontend/components/transcription-view.tsx`](../../../frontend/components/transcription-view.tsx)), espelhando o padrão de affordance por-turn que já existe (`MoveTurnMenu`, a tesoura à direita de cada turn). A tela `/segmentar` continua intacta para o fluxo "áudio longo / detecção automática". Estamos adicionando o caminho manual por conteúdo, não substituindo nada.

Três partes independentes, cada uma shippável sozinha:

| Parte | O que é | Destrutivo? |
|---|---|---|
| **A. Exportar** | Baixar `.txt`/`.srt`/`.vtt`/`.md`, copiar, imprimir→PDF | Não |
| **B. Separar em reuniões** | Clicar na linha → cortes acumulados → reusa `PATCH /segments` | Sim (arquiva pai, cria filhas, re-extrai tarefas) |
| **C. Seções** | Clicar na linha → rotular seção → divisor no texto | Não |

**Ordem de build:** A → C → B (export isolado primeiro; seções não-destrutivas; separar por último, pois mexe no endpoint e é destrutivo).

---

## Parte A — Exportar / baixar

### Rota nova
`GET /api/meetings/[id]/export?format={txt|srt|vtt|md}[&scope=full|section&section=<idx>]`

- Auth + RLS via `withTenant(user.id, ...)`, espelhando [`frontend/app/api/audio/[meetingId]/route.ts`](../../../frontend/app/api/audio/[meetingId]/route.ts).
- Resposta com `Content-Disposition: attachment; filename="reuniao-YYYY-MM-DD.<ext>"`.
- Carrega `segments`, `speaker_labels`, `summary`, `recorded_at` da reunião (via helper em `lib/queries.ts`).
- `scope=section` filtra os segmentos ao intervalo da seção `<idx>` (Parte C). Default `scope=full`.

### Formatos
- **`.txt`** — por *turn* (segmentos consecutivos do mesmo speaker agrupados, igual `groupTurns`): `[mm:ss] Nome: texto`. Nome vem de `speaker_labels[letter]`, com fallback `Speaker A`.
- **`.srt` / `.vtt`** — um bloco por segmento, com timestamps `HH:MM:SS,mmm` (srt) / `HH:MM:SS.mmm` (vtt) e o nome como prefixo do texto.
- **`.md`** — cabeçalho (`# <summary ou data>`, data legível, lista de participantes) + corpo por turn.

### Copiar tudo
Client-side: copia o formato `.txt` montado a partir dos `segments` já em memória no componente. Sem rota.

### PDF
Botão "Imprimir" abre uma view com print-stylesheet (`@media print`) e dispara `window.print()` → usuário salva como PDF nativamente. **Nenhuma dependência nova.** (Se no futuro quiser PDF gerado no servidor, é outro design.)

### UI
Botão "Baixar / exportar" no topo da transcrição em [`frontend/app/reunioes/[id]/page.tsx`](../../../frontend/app/reunioes/[id]/page.tsx), abrindo um menu: Texto (.txt) · Legenda (.srt/.vtt) · Markdown (.md) · Imprimir/PDF · Copiar tudo. Cada reunião (pai, filha, ou com seções) exporta a sua. Com seções, o menu também oferece "Baixar seção atual".

---

## Parte B — Separar em reuniões pelo texto

### Interação
No `TranscriptionView`, cada turn ganha (no mesmo cluster de ações onde já está a tesoura do `MoveTurnMenu`) a ação **"Separar: a partir daqui é outra reunião"**.

- Cada clique **marca um ponto de corte** em `cut.at_seconds = start do primeiro segmento daquele turn`. Ficar na fronteira de segmento garante que `filterSegmentsForInterval` (que usa `start >= cut && end <= cut`) não descarte nenhum segmento "atravessado".
- Marcadores são **estado efêmero** (client) renderizados como linhas divisórias na transcrição, com opção de desfazer cada um.
- Uma **barra flutuante** acumula: *"2 cortes marcados → Separar em 3 reuniões"*. Confirmar chama o endpoint existente com todos os `cuts` de uma vez.

### Reuso do endpoint existente
`PATCH /api/meetings/[id]/segments` no modo `cuts` ([`frontend/app/api/meetings/[id]/segments/route.ts`](../../../frontend/app/api/meetings/[id]/segments/route.ts)) já: recorta áudio (`clipAudio`), cria filhas com `parent_meeting_id`, arquiva o pai (`archived_session`), dispara `acoes-process-segment` no n8n por filha. **Reuso total.**

### Mudança mínima no endpoint
O modo `cuts` hoje rejeita qualquer trecho `< MIN_SEGMENT_DURATION` (600s). Adicionar flag opcional **`allow_short?: boolean`** no body:
- Ausente/`false` → comportamento atual (piso 10 min). A tela `/segmentar` automática **não** envia o flag.
- `true` → piso cai para **`MIN_MANUAL_SEGMENT_DURATION = 30`** (constante nova), só pra evitar reunião-fantasma de poucos segundos. O corte manual da transcrição envia `allow_short: true`.

Nenhum outro comportamento muda; o fluxo automático fica idêntico.

---

## Parte C — Marcar seções (mesma reunião)

Não-destrutivo. No mesmo menu do turn → **"Nova seção a partir daqui"** → campo de rótulo inline ("Financeiro") → salva imediatamente.

### Modelo de dados
Migration `db/0017_meeting_sections.sql`:
```sql
ALTER TABLE meetings ADD COLUMN sections JSONB NOT NULL DEFAULT '[]';
```
Formato: `[{ "start_seconds": number, "title": string }]`, ordenado por `start_seconds`. Segue o padrão do projeto (tudo de reunião é JSONB na própria linha de `meetings`; sem tabela nova). Coberto por RLS automaticamente.

### Rota
`PATCH /api/meetings/[id]/sections` — salva o array completo de seções (criar/editar/remover via replace). Auth + RLS via `withTenant`, validando que o caller é dono da reunião. `title` truncado a ~120 chars; `start_seconds` validado contra `duration_seconds`.

### Render
`TranscriptionView` desenha um divisor com o título antes do primeiro turn cujo `start >= section.start_seconds`. Seções são colapsáveis. Cada divisor tem ação de renomear/remover. Carrega `sections` junto da reunião (adicionar à query de `byIdDetailed` em `lib/queries.ts`).

### Export por seção
O menu de export (Parte A) ganha "Baixar seção atual" → `GET .../export?scope=section&section=<idx>`.

Tarefas, áudio e a reunião continuam **um só** — seção é organização visual + recorte de export, nada mais.

---

## Resumo das mudanças no código

**Novos arquivos**
- `frontend/app/api/meetings/[id]/export/route.ts` — export multi-formato (Parte A)
- `frontend/app/api/meetings/[id]/sections/route.ts` — CRUD de seções (Parte C)
- `frontend/lib/transcript-format.ts` — formatadores `.txt`/`.srt`/`.vtt`/`.md` (compartilhado entre rota e copiar-tudo)
- `db/0017_meeting_sections.sql` — coluna `sections`
- Componente(s) de UI: menu de export + barra flutuante de cortes (nomes finais no plano)

**Arquivos alterados**
- `frontend/components/transcription-view.tsx` — affordance de corte/seção por turn, divisores de seção, barra flutuante, render de marcadores
- `frontend/app/reunioes/[id]/page.tsx` — botão "Baixar / exportar"; passar `sections` ao componente
- `frontend/app/api/meetings/[id]/segments/route.ts` — flag `allow_short` + `MIN_MANUAL_SEGMENT_DURATION`
- `frontend/lib/detect-cuts.ts` — adicionar a constante `MIN_MANUAL_SEGMENT_DURATION` (junto das outras)
- `frontend/lib/queries.ts` — incluir `sections` no `byIdDetailed`

## Multi-tenant / segurança
- Toda rota nova usa `withAuth` + `withTenant(user.id, ...)` — RLS no Postgres filtra `meetings` por dono. Sem `query()` direto em `meetings` (regra do `AGENTS.md`).
- Export valida posse da reunião (a query via `withTenant` já filtra; 404 se não for do user).
- `allow_short` não relaxa nenhuma checagem de posse — só o piso de duração.

## Testes
- **Formatadores** (`transcript-format.ts`): unit tests por formato — txt agrupado por turn, srt/vtt com timestamps corretos, md com cabeçalho. Casos: sem labels (fallback `Speaker X`), segmento único, transcrição vazia.
- **Export route**: 200 com `Content-Disposition` correto por formato; 404 pra reunião de outro user; `scope=section` recorta certo.
- **Sections route**: salva/edita/remove; rejeita `start_seconds` fora de range; isolamento por tenant.
- **Segments `allow_short`**: com flag, aceita trecho de 30s–10min; sem flag, mantém rejeição `SEGMENT_TOO_SHORT`; `< 30s` rejeita mesmo com flag.
- **UI** (validação no app real via Playwright, como é o fluxo do projeto): marcar 2 cortes → separar em 3 reuniões; marcar seção → divisor aparece e persiste; baixar cada formato.

## Fora de escopo (YAGNI)
- Detecção de assunto por IA (decisão explícita: manual).
- PDF gerado no servidor.
- Export em lote de várias reuniões.
- Reordenar/mesclar seções de forma arbitrária (só criar/renomear/remover por enquanto).

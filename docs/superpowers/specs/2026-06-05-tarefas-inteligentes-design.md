# Tarefas inteligentes e multidimensionais — Design

**Data:** 2026-06-05
**Status:** Aprovado (brainstorming) — pronto pra virar plano de implementação

## Contexto e problema

O pipeline transforma áudio → transcrição → análise GPT (node "8. GPT Extract Actions") →
tarefas. Hoje cada tarefa tem: `titulo`, `descricao`, `owner`, `acao`
(executar/cobrar/aguardar), `prazo`, `prioridade`, `evidencia`, `confidence`.

Feedback do Vitor sobre as tarefas geradas:
1. **Faltam tarefas** — a IA perde compromissos que foram combinados.
2. **Tarefas rasas** — saem genéricas; falta o porquê/contexto/o que fazer.
3. **Não entende quem é quem** — atribuição fraca de dono/interlocutor (confunde Vitor × Thiago × terceiros).
4. **Card mostra pouco** — `descricao`/`evidencia`/`confidence_rationale` existem no banco mas ficam escondidos atrás do modal de edição.
5. **Quer agrupar por pessoa/grupo** — ver e atribuir tarefas a pessoas ou frentes, **inclusive quem não falou na reunião**, e poder selecionar isso.

## Objetivos

- Extração mais **exaustiva**, **rica** e com **atribuição correta** de interlocutores.
- Cada tarefa carrega **3 eixos**: executor (existe), **pessoas envolvidas** (novo), **frente/área** (novo).
- UI mostra tudo **agrupado por pessoa**, com a info inline (sem abas que trocam a visão), e **editável**.
- Frentes/áreas em modelo **híbrido**: lista base + IA escolhe dela + pode propor nova pra aprovação.

## Não-objetivos (por ora)

- Não auto-reprocessar todas as reuniões antigas (backfill é opt-in por reunião).
- Não construir merge/dedupe avançado de pessoas (só get-or-create + aliases existentes).
- Filtros avançados e tela de gestão de frentes ficam pra fase posterior.

## 1. Modelo de dados (migration `db/0010_*`)

### `frentes` (nova, por usuário)
```
id uuid pk default gen_random_uuid()
user_id uuid not null references users(id) on delete cascade
nome text not null
slug text not null               -- normalizado p/ matching da IA
ordem int not null default 0
ativo boolean not null default true
created_at timestamptz default now()
UNIQUE (user_id, slug)
```
- RLS no padrão `app_tenant` (NOBYPASSRLS) como as demais tabelas de dados.
- **Seed** na migration p/ usuários existentes: Marketing, Vendas/SDR, Dados & Dashboards,
  Produto, Trips, Weddings, Edis, Operações. (Novos usuários recebem o set base via app/onboarding — detalhe do plano.)

### `tarefa_pessoas` (nova, join)
```
tarefa_id uuid not null references tarefas(id) on delete cascade
pessoa_id uuid not null references pessoas(id) on delete cascade
principal boolean not null default false   -- marca a pessoa de agrupamento
PRIMARY KEY (tarefa_id, pessoa_id)
```
- Reaproveita `pessoas` (UNIQUE(user_id, nome), aliases, is_vitor). Não-speakers viram pessoa via get-or-create (mesmo fluxo de `0c14066`).

### `tarefas` (alterações)
```
+ frente_id      uuid null references frentes(id) on delete set null
+ frente_proposta text null     -- IA sugeriu área fora da lista → pendente de aprovação
```
- `owner`/`acao`/`is_mine` permanecem (eixo executor).

### Chave de agrupamento por pessoa
- O **pipeline** marca `tarefa_pessoas.principal = true` na pessoa de agrupamento, seguindo a regra:
  - Se `acao ∈ (cobrar, aguardar)` e existe pessoa do `owner` → essa pessoa é a principal.
  - Senão, a 1ª pessoa de `pessoas_envolvidas` é a principal.
  - Se não há pessoa envolvida → nenhuma principal (tarefa solo do Vitor).
- A UI **agrupa pela pessoa `principal`**; tarefa sem principal cai no grupo **"Você"**.
- Tarefa com várias pessoas aparece só sob a principal; as outras viram chips no card.

## 2. IA — prompt do "segundo cérebro"

Aplicar nos **3 workflows de análise**: `acoes-audio-ingest` (node 8),
`acoes-process-segment` (node 8) e `acoes-reprocess-meeting` (node 6).

### Reforços de comportamento
- **Exaustividade**: extrair todo compromisso concreto, inclusive pequenos; **quebrar pedidos compostos** em tarefas separadas.
- **Riqueza**: `descricao` sempre com *o quê* + *porquê* + *pra quem*; `evidencia` obrigatória.
- **Interlocutores**: usar a **transcrição rotulada com nomes** (quando o voice-svc identificou) como fonte de verdade pra `owner`/delegação; em dúvida, `owner = "?"`. Não herdar interlocutor entre segmentos (regra de speaker-tracking já existente).

### Novos campos no output JSON (por ação)
```
"pessoas_envolvidas": ["<nome canônico ou literal>", ...],  // quem a tarefa envolve, incl. não-presentes; [] se só Vitor
"area": "<uma das frentes conhecidas>" | null,
"area_nova": "<nome sugerido>" | null                        // só se nada encaixa e vale propor
```
- Passar no user message a **lista de frentes conhecidas** (nova consulta/append) e as **pessoas conhecidas** (já existe via node "7f. SELECT pessoas").
- Instruções novas no system prompt: seção PESSOAS_ENVOLVIDAS (quem a tarefa concerne; não-speakers permitidos; usar nome canônico quando casar com pessoa conhecida) e seção FRENTE/ÁREA (escolher da lista; `area_nova` só quando claramente nenhuma serve).

### Consertar `acoes-reprocess-meeting` (dívida técnica)
- Está **stale**: prompt/Parse/INSERT sem o campo `acao`, e fora do repo/apply.sh.
- Sincronizar o prompt + Parse + INSERT com o audio-ingest (incluindo `acao` + novos campos) e **versionar** no repo + apply.sh.

## 3. Pipeline (n8n)

Em cada workflow de análise, após o GPT:
- **Parse Actions**: ler `pessoas_envolvidas`, `area`, `area_nova` por ação (além do que já lê). `raw_ai_response` continua guardando o JSON inteiro.
- **Resolver pessoas**: pra cada nome em `pessoas_envolvidas` → get-or-create `pessoas` (por user) → inserir `tarefa_pessoas`; marcar `principal` conforme a regra de agrupamento.
- **Resolver área**: casar `area` com `frentes` (por slug) → `frente_id`; se vier `area_nova` → `frente_proposta`.

## 4. UI (frontend) — layout B

- **`lib/queries.ts`**: tarefas retornam `pessoas` (array `{id, nome, is_speaker}`), `frente` (nome) e `frente_proposta`; suporte a agrupamento por pessoa.
- **`components/task-row.tsx`**: card enriquecido — `descricao` em 1-2 linhas (visível), `evidencia` recolhível, chips de **executor/acao**, **área**, **pessoas**; prazo + link da reunião.
- **Edição inline** (chips com ✎): mudar área (escolher de `frentes` ou adicionar nova), add/remove pessoa. **Aprovar** `frente_proposta` → cria `frente` + seta `frente_id`.
- **`components/tasks-dashboard.tsx`** + lista da reunião: **agrupado por pessoa** (heading por pessoa, badge "não falou" p/ terceiros, grupo "Você"). Visão única, sem abas.
- Novos endpoints: PATCH tarefa p/ `frente_id`; add/remove `tarefa_pessoas`; aprovar frente proposta.

## 5. Retroativo (backfill)

- Ação por reunião "reprocessar/enriquecer" usando o `acoes-reprocess-meeting` já consertado (passa a gerar os novos campos).
- ⚠️ Reprocessar **substitui** as tarefas da reunião (delete + re-insert) → avisar que edições manuais/`acao` daquela reunião se perdem.
- Tarefas antigas sem pessoas/área simplesmente mostram o que têm.

## 6. Faseamento sugerido (detalhar no plano)

- **Fase 1 — Dados + IA**: migration (`frentes`, `tarefa_pessoas`, colunas) + prompt enriquecido + pipeline de resolução nos 3 workflows + conserto/versionamento do reprocess-meeting. Reuniões **novas** já saem ricas.
- **Fase 2 — UI**: card enriquecido + agrupado por pessoa + edição inline + aprovação de frente proposta.
- **Fase 3 — Polimento**: filtros por chip, tela de gestão de frentes, backfill assistido de reuniões antigas.

## Riscos e mitigações

- **Qualidade da diarização** afeta atribuição: se o speaker não foi identificado, cai em `owner="?"`/heurística. O prompt já trata "?".
- **Explosão de pessoas** (nomes mal transcritos viram pessoa nova): só criar quando o nome é claro; reaproveitar aliases; merge fica pra depois.
- **Drift n8n**: prompt vive no JSON do repo + apply.sh (lição de `c09bc68`/`n8n-apply-overwrites-live-edits`). Aplicar nos 3 workflows e versionar todos.
- **Reprocesso destrutivo**: backfill opt-in + aviso.

## Decisões com default (revisar no review do spec)
- Descrição visível em 1-2 linhas; evidência recolhível por padrão.
- Tarefa multi-pessoa agrupa sob a **principal**; outras viram chips.
- Frentes base semeadas conforme lista acima (editável depois).

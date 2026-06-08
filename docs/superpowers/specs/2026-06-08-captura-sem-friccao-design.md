# Captura sem fricção — quick-add por texto e voz com auto-estruturação

**Data:** 2026-06-08
**Status:** Aprovado (brainstorm), pronto pra plano de implementação
**Escopo:** `frontend/` + `db/` — captura de tarefas que não vêm de reunião

> Revisado após crítica adversarial (4 lentes). Achados de design incorporados; "blockers" que eram só "ainda não implementado" foram descartados (são o trabalho que o spec descreve).

## Problema

Hoje a plataforma só sabe criar tarefas a partir de **reuniões** (áudio → AssemblyAI → GPT extrai). Existe um começo de criação manual (`TaskCreateModal` + `POST /api/tarefas`), mas é um formulário completo — trabalhoso pra jogar uma tarefa solta que surgiu na cabeça.

Resultado: a maioria das tarefas do Vitor que **não** nasce numa reunião continua fora do sistema (na cabeça, em outros apps). Pra plataforma virar "o lugar onde organizo TODAS as tarefas", a captura precisa ser **sem fricção**: qualquer tarefa entra em segundos, por texto ou voz, e já vira tarefa pronta — sem ritual de triagem.

Feedback que originou o escopo (brainstorm 2026-06-08):
1. **Captura sem fricção** é o maior buraco (escolhido sobre workflow diário, tipos novos de tarefa, consolidação).
2. Canais agora: **quick-add por texto** (linguagem natural) e **voz rápida** (1 tarefa). WhatsApp-de-entrada e iOS nativo ficam pra depois.
3. No instante da captura, o GPT **auto-estrutura** (não cai cru numa caixa de entrada nem exige fila de aprovação).
4. Depois de digitar, dá pra **decidir pra quem é, quando e etc. de forma fácil** — por chips rápidos, não pelo modal pesado.

## Decisões aprovadas (durante brainstorm)

1. **Arquitetura: Caminho 1** — o "cérebro" que transforma texto solto em tarefa estruturada mora no Next.js (`lib/capture.ts`), chamada de GPT **síncrona**. Escolhido sobre rotear pelo n8n (latência/risco no caminho interativo) e sobre estruturação assíncrona (contradiz "pronta na hora").
2. **Auto-estrutura na hora**, sem caixa de entrada. Baixa confiança liga `precisa_revisao` e o card mostra um marcador — não bloqueia.
3. **Quick-add vira um compositor**, não um campo cego: você digita, **Enter cria a tarefa na hora**, e o GPT devolve os chips (quem / quando / prioridade / área) pré-preenchidos como **sugestões editáveis pós-criação**.
4. **Chips reutilizáveis**: os chips do compositor são os mesmos componentes que depois rodam no card da lista (alinhado com [2026-05-20-tarefas-ux-inline-design.md](2026-05-20-tarefas-ux-inline-design.md)). Sem duplicação.
5. **Prompt versionado no código** (não no n8n) — evita o problema conhecido de `apply.sh` sobrescrever edição live, e mantém o pipeline de reuniões intocado.
6. **Voz = transcrição na frente do caminho de texto**: o áudio vira texto e segue exatamente pelo mesmo `parseCapture`.
7. **Uma captura = uma tarefa.** `parseCapture` retorna **um** `CaptureDraft` (não array); o prompt instrui o GPT a extrair só a tarefa principal. Quebrar uma captura em várias tarefas fica fora de escopo.
8. **Captura nunca falha**: se o GPT cair/estourar timeout, salva a tarefa crua (`titulo` = texto digitado, `precisa_revisao = true`) e segue.
9. **O formulário completo continua existindo**: o compositor é o caminho padrão (rápido); o `TaskCreateModal` completo fica a 1 toque ("abrir tudo") pra quem quer descrição longa, status, múltiplas pessoas etc.
10. **Fidelidade do título**: o GPT **preserva as palavras do usuário** — extrai data/pessoa/prioridade pra fora do texto (viram chips) e deixa o título enxuto, mas **nunca parafraseia nem inventa uma frase diferente** da que foi digitada. Ex.: "ligar pro contador sexta de manhã" → título "ligar pro contador" + chip `quando = sexta`, jamais "Realizar contato telefônico com o contador".

## Arquitetura

### Fluxo (sem ambiguidade de "quando salva")

```
Compositor (texto)  ── Enter ──┐
                               ├─►  POST /api/capturar      (1x, no envio)
Compositor (🎙 voz) ── parar ──┘         │
   grava áudio → transcreve → texto      │
                                         ▼
                       parseCapture(texto, ctx)        [lib/capture.ts — 1 chamada GPT, síncrona]
                                         │   (retorna UM CaptureDraft + confidence)
                                         ▼
                       tarefasFor(userId).criar(draft)  [helper compartilhado — devolve Tarefa COMPLETA]
                         • computa precisa_revisao
                         • INSERT tarefas (meeting_id NULL)
                         • INSERT tarefa_eventos 'criada' { origem, raw, confidence }
                         • pessoas_raw / area_raw → triggers já existentes resolvem
                         • SELECT de volta com joins (pessoas, frente, is_mine)
                                         │
                                         ▼
                       201 { tarefa }  → card pronto na lista (otimista)
                                         │
   ajustes nos chips (quem/quando/prioridade/área) ── PATCH /api/tarefas/[id] ── (otimista, incremental)
```

**Não há botão "Salvar" final.** A tarefa é salva no envio (passo 1). Os chips são ajustes incrementais depois. Não há re-parse enquanto digita (sem debounce de re-parse — evita chips desatualizados).

### `lib/capture.ts` — o cérebro

```ts
type CaptureCtx = {
  hoje: string;                         // ISO, pra resolver "sexta" → data
  tz: string;                           // "America/Sao_Paulo" (fixo; ver Decisões de borda)
  frentes: { nome: string }[];          // só nomes — o trigger faz o match por slug
  owners: { name: string; is_me: boolean }[]; // pra canonizar "pra quem"
};

type CaptureDraft = {
  titulo: string;
  descricao: string | null;
  owner: string;                        // "vitor" | nome | "?"
  acao: "executar" | "cobrar" | "aguardar";
  prazo: string | null;                 // ISO ou null
  prazo_text: string | null;            // texto literal ("sexta de manhã")
  prioridade: "baixa" | "media" | "alta" | "urgente";
  area_raw: string | null;              // nome de frente; trigger resolve em frente_id/proposta
  pessoas: string[];                    // nomes; vão em pessoas_raw, trigger resolve
  confidence: "high" | "medium" | "low";
  confidence_rationale: string;
};

async function parseCapture(raw: string, ctx: CaptureCtx): Promise<CaptureDraft>;
```

- **Prompt enxuto de uma tarefa só**, destilado das regras já maduras do prompt das reuniões (`n8n-workflows/acoes-audio-ingest.json`, nó "GPT Extract Actions"): lógica de `acao`, de `owner`, de `prioridade`, parsing de prazo pt-BR, `pessoas`, `area`. Vive no código, versionado. Instrui o GPT a extrair **só a tarefa principal** e a **preservar a redação do usuário** no `titulo` (lifta data/pessoa/prioridade pra fora, mas não parafraseia — ver Decisão 10).
- **Modelo:** **a decidir no plano de implementação, com benchmark** — começar pelo mesmo modelo do pipeline de reuniões (hoje referido como `gpt-5.1`) e testar um tier mais rápido/barato se existir. `temperature` ~0.2. Meta de latência perceptível < ~1,5s; **validar com protótipo** (5-10 exemplos pt-BR) antes de fechar o modelo. (Não cravar um id de modelo no spec.)
- **`CaptureDraft` é o contrato compartilhado** com o cérebro das reuniões: qualquer campo novo num lado deve ser espelhado no outro. Documentado aqui pra evitar divergência silenciosa entre os dois prompts.

### `POST /api/capturar` — a rota (`withAuth`)

- Aceita JSON `{ texto: string }` **ou** multipart com `audio` (clipe curto).
- **Validação:** `texto` vazio/só espaços → 400 (o cliente também valida antes de enviar). Não cria tarefa fantasma.
- Se vier áudio: transcreve com a API de transcrição da OpenAI (modelo síncrono, ex.: `whisper-1`/`gpt-4o-transcribe` — **decidir e validar latência no plano**; AssemblyAI continua só pras reuniões longas), depois trata como `texto`.
- Monta `CaptureCtx` (hoje, `tz` fixo `America/Sao_Paulo`, `frentesFor(user).list()`, `GET /api/owners`).
- Chama `parseCapture` → `tarefasFor(user.id).criar(draft, { origem: "captura_texto" | "captura_voz", raw })` → devolve `201 { tarefa }` (shape completo).
- **Fallback (captura nunca falha):** qualquer erro de GPT/transcrição → cria tarefa crua (`titulo = raw`, `precisa_revisao = true`, sem `confidence`) e devolve 201. Loga no `payload` do evento `criada` (`{ error, model, latency_ms }`). Nunca 5xx por falha de IA.
- Registra custo em `usage_events` (`event_type: 'captura'`, `meeting_id = NULL`). Atribuição por tarefa (`tarefa_id`) é opcional/deferida — não bloqueia o MVP.

### Refactor que vem junto (melhorar o código onde mexo)

Hoje o INSERT de tarefa + evento + pessoas mora inline em `frontend/app/api/tarefas/route.ts` (linhas ~50-93). Extrair pra um método em `lib/queries.ts` (locus das queries de usuário, já tem os padrões de serialização):

```ts
// tarefasFor(userId).criar(draft, meta)
//   meta = { origem: "manual" | "captura_texto" | "captura_voz"; raw?: string }
//   → computa precisa_revisao = confidence !== "high" || (prazo_text && !prazo)
//   → INSERT + evento 'criada' (payload inclui origem/raw/confidence)
//   → resolve pessoas (ver abaixo) e area_raw via triggers existentes
//   → SELECT de volta com joins → retorna Tarefa COMPLETA (mesmo shape de .recentes())
criar(draft: CaptureDraft, meta): Promise<Tarefa>;
```

Tanto `POST /api/tarefas` (manual) quanto `POST /api/capturar` chamam o mesmo método e devolvem o **mesmo shape completo** (com `pessoas`, `frente`, `is_mine`) — sem o front receber row crua.

**Pessoas — dois caminhos (resolver a inconsistência atual):**
- **Captura:** `parseCapture` devolve `pessoas: string[]` → seta `pessoas_raw` (JSON) e deixa o **trigger `resolve_tarefa_pessoas`** (já existe, `db/0010`) criar pessoas + `tarefa_pessoas` (principal = primeira).
- **Manual:** o `TaskCreateModal` manda `{ nome, principal }[]` (com flag principal explícita) → mantém o loop atual.
- `criar()` aceita os dois formatos: se `pessoas` é `string[]`, usa `pessoas_raw`; se é `{nome,principal}[]`, faz o loop. (Hoje o `route.ts` manual faz só o loop — passa a ser um dos dois caminhos.)

## Modelo de dados — mudança mínima

`db/0011_captura.sql` (constrói sobre o `0010`, que **já está aplicado** — frentes, `tarefa_pessoas`, `area_raw`, `pessoas_raw`, triggers; e sobre o `0008`, que já tem `acao`. Sem colisão de migration):

```sql
ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS precisa_revisao boolean NOT NULL DEFAULT false;

-- filtro futuro "só revisar" (barato, opcional)
CREATE INDEX IF NOT EXISTS idx_tarefas_revisao ON tarefas (user_id) WHERE precisa_revisao;
```

- **Uma coluna nova.** Liga o marcador "revisar" e permite filtrar.
- Atualizar o type `Tarefa` em `lib/queries.ts` pra incluir `precisa_revisao: boolean`.
- **Texto cru + origem + confiança** ficam no `payload` do `tarefa_eventos` 'criada' — **zero coluna nova** pra isso.
- Nada de tabela nova. `usage_events` continua como está (loga `meeting_id = NULL`). Recorrentes, inbox, projetos seguem fora de escopo.
- Multi-tenant: a coluna entra em `tarefas`, já coberta por RLS; nenhuma policy nova. O INSERT passa por `withTenant`, como o manual já faz.

## UX — o compositor

Caminho **padrão** de adicionar tarefa (substitui o destaque do botão "Nova tarefa", mas **não** remove o acesso ao form completo — ver chip "abrir tudo").

```
┌──────────────────────────────────────────────────────────┐
│ ✎  ligar pro contador sexta de manhã              🎙   ↵  │
├──────────────────────────────────────────────────────────┤
│ pra quem: eu ▾   quando: sex 12/06 ▾   ⚡ média ▾   # ▾  ⋯ │
└──────────────────────────────────────────────────────────┘
   ↑ o GPT pré-preencheu (pós-criação) — toque pra ajustar    ⋯ = abrir tudo
```

- **Campo de texto** com placeholder em linguagem natural. **Enter** (ou tocar ↵) → `POST /api/capturar` → estado otimista "estruturando…" → card aparece na lista com os chips preenchidos. **Sem re-parse enquanto digita.**
- **Atalho de teclado in-app** (não global de SO): tecla `c` quando nada está focado, em desktop, foca o campo. Em mobile, um "+" proeminente abre o compositor.
- **Linha de chips** (pré-preenchidos, ajustáveis em 1-2 toques; cada ajuste = `PATCH /api/tarefas/[id]` otimista):
  - **pra quem** (componente único `pra-quem-chip`, owner + acao acoplados): "eu" → `owner=vitor, acao=executar`. Pessoa → `owner=nome, acao=cobrar` (padrão de delegação = "a pessoa faz, eu cobro"; toggle pra `aguardar` = "não preciso cobrar"). Isso é **consistente com o modelo atual** (`AcaoChip`/`AcaoToggle` em `task-row.tsx`). Autocomplete de `GET /api/owners` + pessoas.
  - **quando** (`prazo-chip`): quick hoje / amanhã / sexta / +1 semana (os mesmos do modal hoje) + escolher data + remover. Override manual limpa `prazo_text`.
  - **prioridade** (`prioridade-chip`): baixa / média / alta / urgente.
  - **área** (`area-chip`): dropdown de `frentes` + "propor nova" (vira `area_raw` → trigger).
  - **⋯ abrir tudo**: abre o `TaskCreateModal`/edit completo (descrição longa, status, múltiplas pessoas com principal). O form completo **não some**.
- **🎙 voz**: gravar → transcrever → mesmo fluxo. Em mobile/PWA, a permissão de microfone do iOS Safari é instável; por isso **voz vem depois do texto** no plano, e se o PWA não liberar mic no iOS, esse canal depende do app nativo (deferido). **Texto funciona em todo lugar.**

### Estado "revisar" (ajuste pós-criação)

Quando `precisa_revisao = true` (baixa confiança, ou prazo não resolvido apesar de expressão temporal, ou fallback cru):
- O card mostra um **marcador claro "revisar"** (chip âmbar, no topo, ao lado de onde "vencida"/"urgente" aparecem em `task-row.tsx`).
- Tocar o marcador foca o ajuste: abre os chips com destaque no campo provavelmente ambíguo (ex.: `prazo` se havia `prazo_text` mas `prazo=null`; `owner` se ambíguo). Pra ambiguidades que os chips não cobrem, leva ao modal completo.
- Tooltip no marcador: "IA com baixa confiança — confira prazo / pessoa / área". Sem fila obrigatória; é só um sinal.

### Componentes (`components/task-chips/`)

Construídos agora **com consumidor imediato** (o compositor) — não é abstração prematura. São isolados pra depois caírem no `task-row.tsx` (spec 2026-05-20):
- `popover-shell.tsx` (popover desktop / bottom-sheet mobile, `< 640px`), `prazo-chip.tsx`, `prioridade-chip.tsx`, `area-chip.tsx`, `pra-quem-chip.tsx`.
- **Boundary com 2026-05-20:** aquele spec previa um `owner-chip` (só owner). Este unifica em **`pra-quem-chip` (owner + acao)**, que é o conceito certo. Quando 2026-05-20 for implementado, o card adota o `pra-quem-chip` em vez de um `owner-chip` separado. Hoje, owner/acao inline já existem espalhados em `task-row.tsx` (`OwnerInput` ~82-130, `AcaoChip` ~133-192, `AcaoToggle` ~194-235) — o `pra-quem-chip` consolida os três.

### API auxiliar

- `GET /api/owners` — owners já usados (frequência), "vitor" rotulado "eu" no topo. Pequeno; compartilhado com o spec 2026-05-20 (se já existir quando este for implementado, reusa). Resposta cacheável (`private, max-age=60`).
- `GET /api/frentes` — já existe.

## Comportamento — erros e casos de borda

- **GPT fora / timeout** → tarefa crua + `precisa_revisao=true`, 201. Toast: "salvei, dá uma olhada nos detalhes".
- **Transcrição falha** (voz) → texto parcial se houver; senão placeholder cru + `precisa_revisao`, avisa.
- **Texto vazio / só espaços** → cliente não envia + feedback inline; servidor 400 se chegar.
- **Expressão temporal não resolvida** ("semana que vem" → `prazo` null) → `precisa_revisao=true`, `prazo_text` preserva o dito.
- **Owner ambíguo** (2 Joões) → melhor palpite + `precisa_revisao`; chip "pra quem" abre o autocomplete pra desambiguar. `/api/owners` com cache pra não travar em rede lenta.
- **Otimismo + PATCH falha** (ajuste de chip) → reverte estado local + toast (padrão de `task-row.tsx`).
- **Multi-tarefa num texto só** → `parseCapture` extrai só a principal (instrução no prompt + teste).

## Testes

- **`parseCapture` (unit, GPT mockado)** — tabela pt-BR → campos esperados:
  - "ligar pro contador sexta de manhã" → `executar`, `owner=vitor`, prazo = próx. sexta, `prazo_text="sexta de manhã"`.
  - "cobrar o relatório da Estela até quinta" → `cobrar`, `owner=Estela`, prazo = próx. quinta, `pessoas=[Estela]`.
  - "comprar presente algum dia" → `executar`, prazo null, `prioridade=baixa`, `precisa_revisao=true` (sem prazo apesar de "algum dia").
  - "urgente: responder o e-mail do investidor hoje" → `prioridade=urgente`, prazo = hoje.
  - "cobrar João o relatório E responder o e-mail" → **só a principal** (multi-tarefa não quebra).
- **`precisa_revisao`** — confidence≠high → true; confidence=high + `prazo_text` + `prazo=null` → true.
- **Fallback** — GPT lança → `criar` recebe draft cru, `precisa_revisao=true`, rota devolve 201.
- **`tarefasFor().criar` compartilhado** — manual e captura produzem o **mesmo shape completo** (com `origem` diferente no evento); pessoas (`pessoas_raw` vs loop) e `area_raw` disparam os triggers corretos.
- **Rota `/api/capturar`** — texto e (mock de) áudio chegam ao mesmo caminho; vazio → 400; multi-tenant: `user_id` propagado, RLS respeitada.

## Plano de implementação (ordem; cada item mergeável)

1. **DB** — `db/0011_captura.sql` (`precisa_revisao` + índice) + `precisa_revisao` no type `Tarefa`.
2. **Refactor** — extrair `tarefasFor().criar(draft, meta)` (retorna Tarefa completa; trata os dois caminhos de pessoas) e migrar `POST /api/tarefas` pra ele (paridade garantida por testes).
3. **Protótipo do prompt** — escrever o prompt enxuto, rodar 5-10 exemplos pt-BR, medir latência/qualidade, fechar o modelo. (Gate antes de cravar.)
4. **`lib/capture.ts`** — `parseCapture` + prompt + testes (GPT mockado).
5. **`POST /api/capturar`** — texto first; validação; fallback; `usage_events`; testes de rota.
6. **`GET /api/owners`** — se ainda não existir.
7. **`components/task-chips/`** — `popover-shell` + os 4 chips, isolados.
8. **Compositor** — campo + Enter cria + chips pós-criação + atalho in-app + otimismo + "⋯ abrir tudo". Marcador "revisar" no card.
9. **Voz** — gravação no compositor + transcrição síncrona no `/api/capturar` (validar mic no PWA iOS).

## Fora de escopo (deferido, em ordem provável)

- WhatsApp-de-entrada (texto/áudio pra mim mesmo) — o `parseCapture` já fica pronto pra ser chamado por esse canal depois.
- iOS nativo (Share Sheet / Atalho Siri / widget).
- Tarefas recorrentes / rotinas, lembretes com hora, "algum dia/talvez".
- Visão "Hoje / Foco" e caixa de entrada (workflow diário).
- Consolidar/importar de outros apps (Apple Lembretes etc.).
- Migração completa dos chips inline no card + kebab de status + enxugar o modal (segue como o esforço do spec 2026-05-20).
- Quebrar uma captura em múltiplas tarefas.
- Atalho de teclado **global de SO** (só in-app por ora).
- `tz` configurável por usuário (fixo `America/Sao_Paulo`, alvo Vitor/BR).
- Atribuição de custo por `tarefa_id` em `usage_events`.

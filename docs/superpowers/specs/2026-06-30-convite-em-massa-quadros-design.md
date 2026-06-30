# Convite em massa nos quadros — Design

**Data:** 2026-06-30
**Status:** Aprovado, em implementação

## Problema

Hoje, compartilhar um quadro com várias pessoas exige cadastrar um convidado por vez
(input de 1 nome → "Criar" → repetir). Cada convidado já recebe um link próprio com
token único, o que preserva a atribuição na auditoria (`tarefa_eventos.quadro_convidado_id`).
O incômodo é só o cadastro nome-a-nome.

## Objetivo

Permitir colar vários nomes de uma vez e gerar todos os links juntos, **mantendo a
atribuição** (cada pessoa continua com seu token/link individual).

## Decisões de UX

- **Input:** mantém o campo de 1 nome rápido (com Enter) como está. Abaixo dele, um link
  **"Colar vários"** que expande uma `textarea` (um nome por linha) + botão "Criar N
  convidados" (contador ao vivo) + "Cancelar".
- **Copiar todos:** botão **"Copiar todos os links"** no topo da lista de convidados sempre
  que houver **≥ 2** convidados ativos. Copia um bloco de texto `Nome — link` (um por linha),
  pronto pra colar em WhatsApp/email.

## Arquitetura

### Backend

- `lib/quadros.ts`: nova função `criarConvidados(quadroId, nomes: string[])`.
  - Limpa: `trim` em cada nome, descarta vazios, dedup exato dentro do lote.
  - Um único `INSERT ... SELECT unnest(...)` numa transação (`withTenant`), gerando um token
    `randomBytes(16).base64url` por nome, `RETURNING id, nome, token`.
  - Retorna `Array<{ id, nome, token, link }>` (link montado com `NEXT_PUBLIC_BASE_URL`).
- `app/api/quadros/[id]/convidados/route.ts` (`POST`): passa a aceitar **`{ nomes: string[] }`**
  além do `{ nome }` atual (retrocompatível). Valida: array de strings não-vazias, máx. 100.
  - `{ nome }` → continua chamando `criarConvidado` (retorna objeto único).
  - `{ nomes }` → chama `criarConvidados` (retorna `{ convidados: [...] }`).

### Frontend (`components/quadro-manager.tsx`)

- Estado novo: `bulkOpen` (textarea visível?), `bulkText`, `creatingBulk`.
- `handleCreateConvidadosBulk()`: parseia linhas → `POST { nomes }` → faz append do array
  retornado em `convidados` → recolhe e limpa a textarea → toast "N convidados criados".
- "Copiar todos os links": monta o bloco a partir de `convidados` ativos usando
  `window.location.origin + /q/ + token` (igual a lista já faz). Reaproveita `CopyLinkButton`
  passando o bloco como `link` (ele só faz `clipboard.writeText`).

## Casos de borda

- 0 nomes válidos após limpeza → botão desabilitado / no-op.
- Nome que já existe como convidado → **cria mesmo assim** (modelo permite homônimos hoje;
  sem bloqueio na v1).
- Limite de 100 nomes por requisição no backend.

## Fora de escopo

- Rota gêmea `/api/agent/quadros/[id]/convidados` (API do agente) — fica no `{ nome }` singular.
- Constraint de unicidade de nome de convidado — não muda.

## Testes / verificação

- `next build` (typecheck) limpo.
- Manual: colar 3 nomes → 3 cards aparecem, "Copiar todos" gera 3 linhas `Nome — link`;
  caminho de 1 nome (Enter) segue funcionando.

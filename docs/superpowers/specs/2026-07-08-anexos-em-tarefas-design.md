# Anexos em tarefas — links e arquivos ricos (design)

Data: 2026-07-08

## Problema

Tarefas (inclusive dentro de quadros) só carregam texto: título, descrição,
pessoas, área, datas. O Vitor quer transformá-las em **informação rica**:
colar/soltar **links e arquivos** de forma fácil, navegar por eles e **baixar**
os principais formatos. Vale para o dono e para o convidado do quadro (paridade).

## Decisões

### Storage: Postgres `bytea` (não volume de FS)
- Bytes do arquivo vivem numa coluna `bytea` da nova tabela `tarefa_anexos`.
- Por quê, e não o volume `/audios` (padrão do áudio)?
  - **Zero mudança de infra**: deploy = imagem + migration idempotente. Não
    exige `docker service update --mount-add` no swarm (arriscado).
  - **Transacional + backup junto do `pg_dump`**.
  - **RLS de graça**: policy por `EXISTS (SELECT 1 FROM tarefas …)` — igual a
    `tarefa_pessoas`. O convidado herda via `withGuest` (tenant do dono).
  - Download idêntico p/ dono e convidado (mesmo helper de streaming).
- **Cap de 25 MB/arquivo** cobre PDFs, imagens, docs, planilhas, zips.
- Trade-off aceito: bloat de DB e leitura full-in-memory no download. OK na
  escala pessoal.

### Modelo unificado (link + arquivo na mesma tabela)
`tarefa_anexos.tipo IN ('link','arquivo')` → uma lista ordenada por tarefa,
navegável de um jeito só. Link guarda `url`+`titulo`; arquivo guarda
`filename`+`content_type`+`size_bytes`+`conteudo (bytea)`.

### Anexos embutidos no `TAREFA_SELECT`
A lista de anexos (só **metadados**, nunca o `bytea`) é agregada como `jsonb`
no `TAREFA_SELECT`. Dono e convidado já recebem `tarefa.anexos` junto — sem
endpoint de listagem separado. O `bytea` só sai pela rota de download.

### Rotas
Espelham a topologia de tarefas (owner + guest):
- Owner: `POST /api/tarefas/[id]/anexos` (link JSON ou arquivo multipart),
  `GET|DELETE /api/tarefas/[id]/anexos/[aid]` (GET = download).
- Guest: `POST /api/q/[token]/tarefas/[id]/anexos`,
  `GET|DELETE /api/q/[token]/tarefas/[id]/anexos/[aid]`. Sob `/api/q/`
  (já público no proxy), validando token + membership em `quadro_tarefas`.

### Segurança do download (anti stored-XSS)
Arquivos são servidos da **mesma origem** do app. Então:
- **Allowlist** de extensões/mime (sem `.html`, `.js`, `.exe`…).
- `X-Content-Type-Options: nosniff` sempre.
- `Content-Security-Policy: default-src 'none'` na resposta de download.
- **Inline** só p/ tipos seguros de preview (png/jpeg/gif/webp/pdf).
  SVG e o resto → `Content-Disposition: attachment` (nunca inline).
- Download forçado no cliente via atributo `download` de `<a>` (same-origin).

## UX ("inteligente e fácil")
No expand da tarefa, seção "Links e arquivos":
- Campo único: colar/digitar URL + Enter → vira link; botão clipe → arquivo.
- **Arrastar-e-soltar** arquivos na seção.
- **Colar print** (Cmd+V de imagem) → sobe como `.png`.
- Lista: link mostra ícone + rótulo (título ou host), abre em nova aba;
  arquivo mostra ícone por tipo + nome + tamanho, miniatura p/ imagem, e
  botão de baixar. `×` remove.

## Fora de escopo (v1)
- Metadados automáticos de link (title/favicon via fetch externo).
- Anexar já na criação da tarefa (só no expand por enquanto).
- Versão do app iOS.

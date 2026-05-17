# Frontend — Ações

Página web pra acompanhar as pendências extraídas das reuniões. Next.js 16 + Tailwind 4 + Postgres direto via `pg`.

## Rotas

| Path                       | O que mostra                                            |
| -------------------------- | ------------------------------------------------------- |
| `/`                        | Dashboard com tabs (Minhas, Aguardando outros, Vencendo, Todas) |
| `/reunioes`                | Lista cronológica de reuniões processadas               |
| `/reunioes/[id]`           | Detalhe: áudio player, transcrição, ações geradas      |
| `/api/health`              | `GET` retorna status do DB (usar como healthcheck)      |
| `/api/tarefas/[id]`        | `PATCH` pra editar/concluir, `GET` pra ler              |
| `/api/audio/[meetingId]`   | Stream do MP3 (suporta `Range` requests)                |

## Dev local

Precisa de `DATABASE_URL` apontando pra um Postgres acessível.

```bash
cd frontend
echo "DATABASE_URL=postgres://USER:PASS@HOST:5432/assistente_pessoal" > .env.local
bun install
bun run dev   # http://localhost:3000
```

Se quiser servir áudio local também, monte um path:
```bash
AUDIO_ROOT=/caminho/local/audios bun run dev
```

## Build & Deploy (easypanel)

```bash
bun run build
```

No easypanel, o serviço **Frontend** roda o Dockerfile incluído:
- Multi-stage com `oven/bun:1.3-alpine`
- Next.js standalone output
- Roda como user `app` não-root
- Porta 3000

### Volumes obrigatórios

- **`assistente-audios`** montado em `/audios` (mesmo volume usado pelo n8n) — pra servir os MP3s via `/api/audio/[meetingId]`

### Variáveis de ambiente

```
DATABASE_URL=postgres://...
AUDIO_ROOT=/audios          # default já está OK
```

### Auth (Basic Auth no proxy)

O app não implementa auth. Configure HTTP Basic Auth no proxy do easypanel:
- User: `vitor`
- Pass: senha forte

## Estrutura

```
app/
├── layout.tsx              # shell com nav
├── page.tsx                # dashboard /
├── reunioes/
│   ├── page.tsx
│   └── [id]/page.tsx
├── api/
│   ├── health/route.ts
│   ├── tarefas/[id]/route.ts
│   └── audio/[meetingId]/route.ts
components/
├── task-row.tsx
└── tabs.tsx
lib/
├── db.ts
└── utils.ts
```

Server components fazem `query()` direto; client components (TaskRow, Tabs) só lidam com interação. Mutações usam PATCH na API + `router.refresh()`.

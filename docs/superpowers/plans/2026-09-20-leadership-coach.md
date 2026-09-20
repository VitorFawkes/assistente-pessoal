# Leadership Coach Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Ownership is split by files; do not revert concurrent edits.

**Goal:** Publish a private personal leadership coach in Ações with grounded memory, conversations, complete incremental meeting analysis and weekly feedback.
**Architecture:** Next.js authenticated routes plus tenant-scoped Postgres tables and a VPS scheduled runner. Structured AI responses are validated before persistence.
**Tech Stack:** Next.js 16.2.6, React 19, pg/Postgres 17, Bun tests, existing OpenAI API.
**Spec:** `docs/superpowers/specs/2026-09-20-leadership-coach-design.md`

## Global constraints
- All user queries use `withTenant`; user identity is session-derived. No public coach sharing.
- Original Stanford/Korn Ferry concepts and adaptations must be distinguished.
- No silent full-history claims, invented citations or speaker attribution.
- Existing untracked screenshots/files remain untouched.

## Work packages
- [x] Research: primary sources, original terminology, adapted competency rubric. File `docs/research/2026-09-20-leadership-coach-sources.md`.
- [x] Persistence: migration `db/0028_leadership_coach.sql`, repository `frontend/lib/coach/store.ts`, real Postgres isolation/rollback checks. Consume shared types; return serializable data to runtime and UI.
- [x] Runtime: `frontend/lib/coach/{types,framework,evidence,model,service}.ts`, tests, session APIs and internal runner. First test source validation, no-loss chunking and weekly boundary; then implement. Context includes profile, active memory, historical retrieval and tasks.
- [x] UI: `frontend/app/coach/page.tsx`, `frontend/components/coach/*`, nav entry. Consume GET/POST `/api/coach` documented in types. Exercise save, chat, corrections, pause and history.
- [x] Operations: scheduled runner, deployment guide and automated checks. Validate SQL locally first; apply additive migration, deploy immutable image, exercise authenticated production route and provider, install schedule, confirm idempotence.
- [x] Independent review: tenant boundaries, evidence grounding, failure/retry/privacy and completion coverage. Fix findings and rerun impacted checks.

## API contract
`GET /api/coach` => `CoachState`. `POST /api/coach` actions:
`settings` with `{enabled,weekly_enabled,goals,context,timezone,review_day,review_hour}`; `memory` with `{content,kind}`; `correct_memory` with `{id,content,status}`; `chat` with `{message}`; `analyze`; `review`; `delete` with `{confirm:"APAGAR COACH"}`. Mutations return refreshed state except chat (state also includes new messages). Errors `{error}` with 400/409/429/503. Same origin enforced for browser mutations.

## Verification record
Record actual command outcomes and deployment evidence in `docs/coach-deployment.md`; do not treat generated files as executed checks.

## Estado de entrega

Implementação e correções integradas pelos PRs #2, #3 e #4; imagem atual `37c00ef61b6d2997e22d07339ac2e511de955b0c` publicada e verificada. Migrations aplicadas; autenticação, isolamento, memória, interface, conversa real e fontes passaram em produção. Runner executado, cron instalado e lock verificado em disparo real. Primeira revisão persistida após cobertura completa do período e idempotência confirmada em rodada posterior. A entrada agora é a conversa, com orientação direta, fundamentos acessíveis e metas declaradas guardadas como autorrelato. A imagem final passou novamente em conversa, fontes e recarga no desktop/celular. O processamento inicial terminou; a conferência final encontrou cobertura completa do material elegível naquele momento. Isso não significa que cada resposta consulte todo o acervo nem garante interpretações corretas em todos os casos. Evidências de validação e limites estão em `docs/coach-deployment.md`.

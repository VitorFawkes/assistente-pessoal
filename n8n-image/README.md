# n8n custom image

Estende `n8nio/n8n:2.20.6` com `ffmpeg` (Alpine `apk add`).

Necessário pro workflow `Acoes - Audio Ingest` rodar compressão + detecção
de silêncio + chunking antes de chamar a Whisper API.

## Easypanel — como usar

No serviço `n8n` (projeto `n8n`):

1. **Source type**: GitHub
2. **Repo**: `VitorFawkes/assistente-pessoal`
3. **Branch**: `main`
4. **Path**: `/n8n-image`
5. **Build type**: Dockerfile
6. **Dockerfile**: `Dockerfile`

Mantém todos os outros campos (env, mounts, ports, domain) iguais.

# Dockerfile multi-stage para Next.js standalone com Bun
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Sao_Paulo

# ffmpeg pra fatiamento de áudio em /api/meetings/[id]/segments.
# tzdata: sem o banco de fusos, TZ=America/Sao_Paulo é ignorado e o container
# fica em UTC — foi assim que das 21h à meia-noite o servidor já estava no dia
# seguinte. O código não depende disto (lib/data-br.ts resolve sozinho), mas
# aqui é a segunda camada.
RUN apk add --no-cache ffmpeg tzdata

RUN addgroup -S app && adduser -S app -G app
USER app

# Next.js standalone output
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

EXPOSE 3000
CMD ["bun", "server.js"]

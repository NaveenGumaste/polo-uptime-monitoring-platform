FROM node:24-trixie-slim AS base

RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
COPY next.config.ts tsconfig.json next-env.d.ts postcss.config.mjs ./
COPY src ./src
RUN bun run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV PATH="/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COPY --from=builder --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/.next/static ./.next/static

USER nonroot:nonroot
EXPOSE 3000
CMD ["server.js"]

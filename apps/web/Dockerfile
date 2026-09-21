# syntax=docker/dockerfile:1
#
# Production image for the Next.js web app. Built from the repo root context.
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so the
# API/WebSocket URLs must be passed as --build-arg (see infra/azure/deploy.sh).

# ---------- build ----------
FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WS_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_BASE_URL=$NEXT_PUBLIC_WS_BASE_URL
RUN pnpm exec turbo run build --filter=@school-transport/web

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
COPY --from=build /repo /repo
# Next resolves .next relative to the working directory, so run from apps/web.
WORKDIR /repo/apps/web

EXPOSE 3000
# Invoke Next directly rather than through pnpm: the runtime stage has no
# package manager installed (only the built workspace is copied in).
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]

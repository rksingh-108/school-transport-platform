# syntax=docker/dockerfile:1
#
# Production image for the NestJS API. Built from the repo root context
# (az acr build / docker build -f apps/api/Dockerfile .) so the pnpm
# workspace + Prisma schema are available.

# ---------- build ----------
FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
# Prisma needs OpenSSL at generate/runtime; ca-certificates for TLS to Azure
# Postgres/Redis.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate --schema=prisma/schema.prisma
# turbo builds workspace dependencies (shared-types/schemas) before the API.
RUN pnpm exec turbo run build --filter=@school-transport/api

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
ENV NODE_ENV=production
# The API listens on API_PORT (defaults to 3001). Copy the built workspace
# (including node_modules and the generated Prisma client) rather than
# re-installing, so the runtime image matches the build exactly.
COPY --from=build /repo /repo

EXPOSE 3001
# The app validates its own env at boot and fails fast if misconfigured.
CMD ["node", "apps/api/dist/main.js"]

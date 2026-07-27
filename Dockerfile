# syntax=docker/dockerfile:1.7
FROM node:22.16.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/agent-kernel/package.json packages/agent-kernel/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/content/package.json packages/content/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY tsconfig.base.json vitest.config.ts eslint.config.mjs ./
COPY apps/api apps/api
COPY packages packages
RUN npm run build:server

FROM node:22.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/agent-kernel/package.json packages/agent-kernel/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/content/package.json packages/content/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/domain/dist packages/domain/dist
COPY --from=builder /app/packages/agent-kernel/dist packages/agent-kernel/dist
COPY --from=builder /app/packages/application/dist packages/application/dist
COPY --from=builder /app/packages/content/dist packages/content/dist
COPY --from=builder /app/packages/infrastructure/dist packages/infrastructure/dist
COPY scripts scripts
COPY infra/postgres/migrations infra/postgres/migrations
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@eauto/api"]

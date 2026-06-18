# ── Stage 1: base (shared dependencies) ──────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY db ./db

# ── Stage 2: development (used by docker-compose) ─────────────────────────────
FROM base AS development
COPY src ./src
CMD ["npm", "run", "dev"]

# ── Stage 3: builder (compile TypeScript) ─────────────────────────────────────
FROM base AS builder
COPY src ./src
RUN npm run build

# ── Stage 4: production (minimal image for ECS) ───────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY package.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db   ./db
EXPOSE 3000
CMD ["node", "dist/index.js"]

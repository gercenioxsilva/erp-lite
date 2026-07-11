# ── Development stage (Docker Compose — polls SQS via localRunner) ───────────
FROM node:22-alpine AS development
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
CMD ["npx", "ts-node", "src/localRunner.ts"]

# ── Build stage (compile TypeScript for Lambda runtime) ───────────────────────
FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

# ── Production stage (AWS Lambda container image) ─────────────────────────────
FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /build/dist/ ./
CMD ["handler.handler"]

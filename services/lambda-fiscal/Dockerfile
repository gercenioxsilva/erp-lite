# ── Build stage ───────────────────────────────────────────────────────────────
FROM public.ecr.aws/lambda/nodejs:20 AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM public.ecr.aws/lambda/nodejs:20
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist/ ./
CMD ["handler.handler"]

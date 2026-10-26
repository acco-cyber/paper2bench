# Paper2Bench — container build (used by the Hugging Face Space and any Docker host).
FROM node:20-slim AS builder
WORKDIR /build

ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build
# Next.js nests standalone output under the project folder name — normalize it,
# then place static assets where server.js expects them.
RUN MV=""; \
    for d in .next/standalone/*/; do \
      if [ -f "$d/server.js" ]; then MV="$d"; break; fi; \
    done; \
    if [ -n "$MV" ]; then cp -r "$MV"/. .next/standalone/; fi; \
    mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static && \
    cp -r public .next/standalone/public

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=7860 \
    HOSTNAME=0.0.0.0

COPY --from=builder /build/.next/standalone ./

EXPOSE 7860
CMD ["node", "server.js"]

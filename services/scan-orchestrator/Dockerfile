# ============================================================
# haxvibe scan-orchestrator — Cloud Run serverless worker
# Runs the full scan pipeline (passive + Nuclei + report)
# without BullMQ/Redis. Receives jobs via HTTP POST /execute.
# ============================================================

FROM node:20-alpine

RUN apk add --no-cache tini
RUN npm install -g tsx

WORKDIR /app

# Copy worker package.json, strip workspace dep, then install
COPY apps/worker/package.json ./package.json
RUN sed -i '/"@haxvibe\/shared-types"/d' package.json \
    && sed -i '/"bullmq"/d' package.json \
    && npm install

# Copy shared-types source into node_modules (replaces workspace: link)
COPY packages/shared-types/ ./node_modules/@haxvibe/shared-types/

# Copy worker source
COPY apps/worker/src/ ./src/
COPY apps/worker/tsconfig.json ./

# Verify critical deps are installed
RUN node -e "require('pino'); require('zod'); require('@supabase/supabase-js'); console.log('deps OK')"

# Run as non-root
USER node
ENV NODE_ENV=production
ENV WORKER_MODE=http
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/http-server.ts"]

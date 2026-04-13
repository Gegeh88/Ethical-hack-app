# ============================================================
# haxvibe nuclei-runner — Cloud Run serverless scanner
# Runs Nuclei as a native binary (no Docker-in-Docker).
# ============================================================

# --- Stage 1: Install Nuclei binary + download templates ---
FROM golang:1.24-alpine AS nuclei-builder

RUN apk add --no-cache git curl unzip

# Install Nuclei from source (supports both amd64 and arm64)
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest

# Download templates at build time
RUN /root/go/bin/nuclei -update-templates -ud /opt/nuclei-templates 2>/dev/null || true

# --- Stage 2: Build Node.js server ---
FROM node:20-alpine AS node-builder

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy only the nuclei-runner service + shared-types for build
COPY services/nuclei-runner/package.json services/nuclei-runner/pnpm-lock.yaml* ./services/nuclei-runner/
COPY packages/shared-types/ ./packages/shared-types/
COPY pnpm-workspace.yaml package.json ./

# Install dependencies
WORKDIR /app/services/nuclei-runner
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod

# Copy source and build
COPY services/nuclei-runner/src/ ./src/
COPY services/nuclei-runner/tsconfig.json ./

# For dev: use tsx, for prod we'd build with tsc
# Since shared-types uses raw .ts exports, we run with tsx in the container
COPY services/nuclei-runner/package.json ./

# --- Stage 3: Runtime ---
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini

RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy Nuclei binary from builder
COPY --from=nuclei-builder /root/go/bin/nuclei /usr/local/bin/nuclei
RUN chmod +x /usr/local/bin/nuclei

# Copy templates
COPY --from=nuclei-builder /opt/nuclei-templates /opt/nuclei-templates

# Create non-root user
RUN addgroup -g 1000 scanner && adduser -u 1000 -G scanner -D scanner

# Create writable dirs for Nuclei
RUN mkdir -p /home/scanner/.config/nuclei /tmp/scanner && \
    chown -R scanner:scanner /home/scanner /tmp/scanner

WORKDIR /app

# Copy the full monorepo workspace structure needed for resolution
COPY --from=node-builder /app/ ./

WORKDIR /app/services/nuclei-runner

USER scanner
ENV NODE_ENV=production
ENV HOME=/home/scanner
ENV PORT=8080

EXPOSE 8080

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/server.ts"]

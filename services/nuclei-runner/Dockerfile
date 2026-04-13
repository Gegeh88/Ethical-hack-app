# ============================================================
# haxvibe nuclei-runner — Cloud Run serverless scanner
# Runs Nuclei as a native binary (no Docker-in-Docker).
# ============================================================

# --- Stage 1: Install Nuclei binary + download templates ---
FROM golang:1.24-alpine AS nuclei-builder

RUN apk add --no-cache git

# Install Nuclei from source (supports both amd64 and arm64)
ENV GOPATH=/go
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    ls -la /go/bin/ && \
    /go/bin/nuclei -version

# Download templates at build time
RUN /go/bin/nuclei -update-templates -ud /opt/nuclei-templates 2>/dev/null || true

# --- Stage 2: Node.js app ---
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini

# Copy Nuclei binary + templates from builder
COPY --from=nuclei-builder /go/bin/nuclei /usr/local/bin/nuclei
COPY --from=nuclei-builder /opt/nuclei-templates /opt/nuclei-templates

# Create non-root user
RUN addgroup -g 1000 scanner && adduser -u 1000 -G scanner -D scanner
RUN mkdir -p /home/scanner/.config/nuclei /tmp/scanner && \
    chown -R scanner:scanner /home/scanner /tmp/scanner

WORKDIR /app

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Copy shared-types (dependency) directly
COPY packages/shared-types/ ./node_modules/@haxvibe/shared-types/

# Copy nuclei-runner source + deps
COPY services/nuclei-runner/package.json ./
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

COPY services/nuclei-runner/src/ ./src/
COPY services/nuclei-runner/tsconfig.json ./

USER scanner
ENV NODE_ENV=production
ENV HOME=/home/scanner
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/server.ts"]

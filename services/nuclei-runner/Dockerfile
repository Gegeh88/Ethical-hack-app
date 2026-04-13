# ============================================================
# haxvibe nuclei-runner — Cloud Run serverless scanner
# Downloads pre-built Nuclei binary (no Go compilation needed).
# ============================================================

FROM node:20-alpine

RUN apk add --no-cache tini curl unzip

# Download pre-built Nuclei binary from GitHub releases
RUN NUCLEI_VERSION=$(curl -s https://api.github.com/repos/projectdiscovery/nuclei/releases/latest | grep '"tag_name"' | cut -d'"' -f4) && \
    VERSION_NUM=${NUCLEI_VERSION#v} && \
    echo "Installing Nuclei ${VERSION_NUM}" && \
    curl -sSL "https://github.com/projectdiscovery/nuclei/releases/download/${NUCLEI_VERSION}/nuclei_${VERSION_NUM}_linux_amd64.zip" -o /tmp/nuclei.zip && \
    unzip /tmp/nuclei.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/nuclei && \
    rm /tmp/nuclei.zip && \
    nuclei -version

# Create non-root user
RUN addgroup -g 1000 scanner && adduser -u 1000 -G scanner -D scanner
RUN mkdir -p /home/scanner/.config/nuclei /opt/nuclei-templates /tmp/scanner && \
    chown -R scanner:scanner /home/scanner /opt/nuclei-templates /tmp/scanner

# Download templates as scanner user
USER scanner
RUN nuclei -update-templates -ud /opt/nuclei-templates 2>&1 || true

# Switch back to root for app setup
USER root
WORKDIR /app

# Install tsx globally
RUN npm install -g tsx

# Copy shared-types (workspace dependency) directly into node_modules
COPY packages/shared-types/ ./node_modules/@haxvibe/shared-types/

# Copy nuclei-runner package and install deps
COPY services/nuclei-runner/package.json ./
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

# Copy source
COPY services/nuclei-runner/src/ ./src/
COPY services/nuclei-runner/tsconfig.json ./

# Run as non-root
USER scanner
ENV NODE_ENV=production
ENV HOME=/home/scanner
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/server.ts"]

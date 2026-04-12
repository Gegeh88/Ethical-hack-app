#!/usr/bin/env bash
# Pre-download Nuclei templates to /opt/nuclei-templates on the VM.
# Run once after VM setup, or periodically to update templates.
# Usage: ssh opc@VM 'bash -s' < scripts/setup-nuclei-templates.sh
set -euo pipefail

TEMPLATE_DIR="/opt/nuclei-templates"

echo "==> Downloading Nuclei templates to $TEMPLATE_DIR..."
sudo mkdir -p "$TEMPLATE_DIR"

# Run nuclei in Docker just to download templates, then copy them out
docker run --rm \
  --tmpfs /tmp:rw,size=512m \
  -e HOME=/tmp \
  -v "$TEMPLATE_DIR:/host-templates:rw" \
  projectdiscovery/nuclei:v3 \
  -update-templates -ud /tmp/nuclei-templates

# Copy from container tmp to host (the -ud flag stores them in /tmp/nuclei-templates)
# Actually nuclei auto-downloads on first run, so let's do it differently:
docker run --rm \
  --tmpfs /tmp:rw,size=512m \
  -e HOME=/tmp \
  -v "$TEMPLATE_DIR:/output:rw" \
  --entrypoint sh \
  projectdiscovery/nuclei:v3 \
  -c "nuclei -update-templates -ud /tmp/nt && cp -r /tmp/nt/* /output/ && echo 'Templates copied'"

# Fix permissions so Docker user 1000:1000 can read
sudo chmod -R 755 "$TEMPLATE_DIR"
sudo chown -R 1000:1000 "$TEMPLATE_DIR"

echo "==> Templates installed at $TEMPLATE_DIR"
ls "$TEMPLATE_DIR" | head -20
echo "==> Done!"

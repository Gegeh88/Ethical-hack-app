#!/usr/bin/env bash
# Create isolated Docker network for Nuclei scanner containers.
# Run once before starting the worker.
# ICC (inter-container communication) is disabled to prevent
# concurrent scanner containers from communicating with each other.

set -euo pipefail

NETWORK_NAME="${NUCLEI_NETWORK:-nuclei-outbound}"

if docker network inspect "$NETWORK_NAME" &>/dev/null; then
  echo "[nuclei-setup] Network '$NETWORK_NAME' already exists"
else
  docker network create \
    --driver bridge \
    --subnet 172.30.0.0/24 \
    --opt com.docker.network.bridge.enable_icc=false \
    "$NETWORK_NAME"
  echo "[nuclei-setup] Created network '$NETWORK_NAME' (ICC disabled)"
fi

# Pre-pull Nuclei image
IMAGE="${NUCLEI_IMAGE:-projectdiscovery/nuclei:v3}"
echo "[nuclei-setup] Pulling $IMAGE..."
docker pull "$IMAGE"
echo "[nuclei-setup] Done"

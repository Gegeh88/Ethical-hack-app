#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Deploy the nuclei-runner service to Google Cloud Run.
#
# Prerequisites:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - A GCP project with Cloud Run API enabled
#   - Artifact Registry repo created (or use Cloud Build auto-push)
#
# Usage:
#   ./scripts/deploy-cloudrun.sh [PROJECT_ID] [REGION]
#
# Environment variables (set before running or in .env.cloudrun):
#   SCANNER_AUTH_TOKEN     — shared secret (min 20 chars)
#   GCP_PROJECT            — GCP project ID
#   GCP_REGION             — Cloud Run region (default: europe-west1)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Config
GCP_PROJECT="${1:-${GCP_PROJECT:-}}"
GCP_REGION="${2:-${GCP_REGION:-europe-west1}}"
SERVICE_NAME="nuclei-runner"
IMAGE_NAME="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/haxvibe/${SERVICE_NAME}"

if [[ -z "$GCP_PROJECT" ]]; then
  echo "Error: GCP project ID required. Pass as argument or set GCP_PROJECT env var."
  echo "Usage: $0 <project-id> [region]"
  exit 1
fi

if [[ -z "${SCANNER_AUTH_TOKEN:-}" ]]; then
  echo "Error: SCANNER_AUTH_TOKEN env var required."
  exit 1
fi

echo "=== Deploying ${SERVICE_NAME} to Cloud Run ==="
echo "  Project:  ${GCP_PROJECT}"
echo "  Region:   ${GCP_REGION}"
echo "  Image:    ${IMAGE_NAME}"
echo ""

# Step 1: Build and push with Cloud Build (builds in the cloud, no local Docker needed)
echo "--- Building container image via Cloud Build ---"
cd "$REPO_ROOT"
gcloud builds submit \
  --project="$GCP_PROJECT" \
  --tag="$IMAGE_NAME" \
  --dockerfile="services/nuclei-runner/Dockerfile" \
  .

# Step 2: Deploy to Cloud Run
echo "--- Deploying to Cloud Run ---"
gcloud run deploy "$SERVICE_NAME" \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --image="$IMAGE_NAME" \
  --memory=2Gi \
  --cpu=1 \
  --timeout=3600 \
  --max-instances=5 \
  --min-instances=0 \
  --concurrency=1 \
  --no-allow-unauthenticated \
  --set-env-vars="SCANNER_AUTH_TOKEN=${SCANNER_AUTH_TOKEN},NODE_ENV=production,LOG_LEVEL=info"

# Step 3: Get the service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --format='value(status.url)')

echo ""
echo "=== Deployment complete ==="
echo "  Service URL: ${SERVICE_URL}"
echo ""
echo "  Set these env vars in your worker:"
echo "    SCANNER_MODE=cloudrun"
echo "    CLOUDRUN_SCANNER_URL=${SERVICE_URL}"
echo "    CLOUDRUN_SCANNER_AUTH_TOKEN=<your-token>"
echo "    CLOUDRUN_CALLBACK_URL=<your-api-url>"
echo ""
echo "  And in your API:"
echo "    SCANNER_AUTH_TOKEN=<same-token>"

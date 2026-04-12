#!/usr/bin/env bash
# Deploy haxvibe to Oracle Cloud VM via rsync (Windows: runs through WSL)
# Usage: bash scripts/deploy-vm.sh
set -euo pipefail

VM_HOST="opc@92.5.80.173"
VM_DIR="~/haxvibe"
WIN_KEY="$HOME/.ssh/haxvibe-prod.key"

echo "==> Syncing code to VM via WSL rsync..."
wsl.exe bash -c "
  cp /mnt/c/Users/horva/.ssh/haxvibe-prod.key /tmp/haxvibe-prod.key 2>/dev/null
  chmod 600 /tmp/haxvibe-prod.key
  rsync -avz --delete \
    -e 'ssh -i /tmp/haxvibe-prod.key -o StrictHostKeyChecking=no' \
    --exclude node_modules --exclude .next --exclude .git \
    --exclude .env.local --exclude .claude --exclude .playwright-mcp \
    /mnt/d/work/aiDream/Ethical_hack_app/ $VM_HOST:$VM_DIR/
"

echo "==> Installing dependencies + restarting services..."
ssh -i "$WIN_KEY" -o StrictHostKeyChecking=no $VM_HOST \
  "cd $VM_DIR && pnpm install --frozen-lockfile 2>&1 | tail -3 && pm2 restart haxvibe-api haxvibe-worker && pm2 ls"

echo "==> Deploy complete!"

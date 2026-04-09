#!/usr/bin/env bash
# Sample UAT deployment script — place on EC2 at /opt/deploy/scripts/uat_deployment.sh
# chmod +x; ensure SSM runs as a user that can execute (often root via SSM).
set -euo pipefail
RELEASE="${1:?release folder argument required}"
echo "[UAT] Starting deployment for release: ${RELEASE}"
echo "[UAT] Simulated deploy steps complete."
exit 0

#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SSH_PRIVATE_KEY:?EC2_SSH_KEY is missing}"
: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is missing}"
: "${AWS_REGION:?AWS_REGION is missing}"
: "${RUNNER_TEMP:?RUNNER_TEMP is missing}"

printf '%s\n' "$SSH_PRIVATE_KEY" | tr -d '\r' > "$RUNNER_TEMP/polo-key"
if ! ssh-keygen -y -P "" -f "$RUNNER_TEMP/polo-key" >/dev/null 2>&1; then
  echo "::error::EC2_SSH_KEY must contain a valid, unencrypted private key."
  exit 1
fi

aws ec2 get-console-output --region "$AWS_REGION" \
  --instance-id "$EC2_INSTANCE_ID" --latest --output json \
  > "$RUNNER_TEMP/ec2-console.json"

python3 - <<'PY'
import json
import os
import re
from pathlib import Path

root = Path(os.environ["RUNNER_TEMP"])
console = json.loads((root / "ec2-console.json").read_text(encoding="utf-8"))
match = re.search(r"\bssh-ed25519\s+([A-Za-z0-9+/]+={0,3})(?=\s|$)", console.get("Output", ""))
if not match:
    raise SystemExit("No ED25519 host key found in authenticated AWS console output")
(root / "polo-known-hosts").write_text(f"polo-server ssh-ed25519 {match.group(1)}\n", encoding="utf-8")
PY

cat > "$RUNNER_TEMP/polo-ssh-config" <<EOF
Host polo-server
  HostName ${EC2_INSTANCE_ID}
  HostKeyAlias polo-server
  User ubuntu
  IdentityFile ${RUNNER_TEMP}/polo-key
  IdentitiesOnly yes
  UserKnownHostsFile ${RUNNER_TEMP}/polo-known-hosts
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 30
  ServerAliveInterval 15
  ServerAliveCountMax 3
  ProxyCommand aws ssm start-session --region ${AWS_REGION} --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p
EOF

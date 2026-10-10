#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Avalanche Primary Network node initialization (AvalancheGo, Docker).
#
# Protocol-level setup only — no client version lives here. The AvalancheGo
# image tag and the per-network settings come from the configuration marker
# (/opt/blueprints/configurations/$CLIENT_CONFIG), read below as the single
# source of truth. node.sh branches on BC_NETWORK:
#   mainnet : --network-id=mainnet
#   fuji    : --network-id=fuji
#
# Networking:
#   9650 HTTP API (RPC, info, health, metrics) -> EC2 internal IP, VPC-internal
#   9651 staking/P2P                          -> 0.0.0.0, public; advertises the
#        instance public IPv4 from IMDSv2 (fail closed when there is none)
#
# Bootstrap: no database snapshot. P-Chain and X-Chain bootstrap from peers and
# the C-Chain state-syncs (default on Mainnet/Fuji). See the README.
#
# Identity: AvalancheGo generates staking/staker.key, staker.crt and signer.key
# under the data dir on first start. They are the node's identity (NodeID + BLS
# key), not funds. This script never deletes, moves or regenerates them, and
# AvalancheGo itself never overwrites an existing staker.key.

set -euo pipefail

echo "Starting Avalanche node setup..."

# Source environment variables written by the framework
source /etc/cdk_environment

# --- Validate required variables (fail closed) ---
if [ -z "${BC_NETWORK:-}" ]; then
    echo "ERROR: BC_NETWORK is not set" >&2
    exit 1
fi
if [ -z "${CLIENT_CONFIG:-}" ]; then
    echo "ERROR: CLIENT_CONFIG is not set" >&2
    exit 1
fi
case "$BC_NETWORK" in
    mainnet|fuji) ;;
    *) echo "ERROR: unsupported BC_NETWORK '$BC_NETWORK' (expected 'mainnet' or 'fuji')" >&2; exit 1 ;;
esac

# Ports are fixed: they must match requiredPorts in package.json, which the
# framework turns into security group rules and the HA ALB listener.
HTTP_PORT="9650"
STAKING_PORT="9651"

# --- IMDSv2: internal IP (HTTP bind) and public IP (P2P advertisement) ---
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
if [ -z "$TOKEN" ]; then
    echo "ERROR: could not obtain an IMDSv2 token" >&2
    exit 1
fi
EC2_INTERNAL_IP=$(curl -s -f -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4 || true)
if [ -z "$EC2_INTERNAL_IP" ]; then
    echo "ERROR: could not resolve EC2 internal IP from IMDS" >&2
    exit 1
fi
# public-ipv4 returns 404 when the instance has no public IPv4. Peers must be
# able to dial the advertised IP on 9651, so refuse to start without one rather
# than advertise an unreachable private address.
EC2_PUBLIC_IP=$(curl -s -f -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
if ! printf '%s' "$EC2_PUBLIC_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    echo "ERROR: instance has no public IPv4 address (IMDS public-ipv4 returned '${EC2_PUBLIC_IP}')." >&2
    echo "ERROR: AvalancheGo must advertise a reachable public IP on port ${STAKING_PORT}; launch in a public subnet with a public IP." >&2
    exit 1
fi
echo "EC2 Internal IP: $EC2_INTERNAL_IP"
echo "EC2 Public IP:   $EC2_PUBLIC_IP"
echo "Network: $BC_NETWORK"
echo "Client Configuration: $CLIENT_CONFIG"

# --- Read the configuration marker (single source of truth) ---
CONFIG_FILE="/opt/blueprints/configurations/${CLIENT_CONFIG}"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: configuration marker not found: $CONFIG_FILE" >&2
    exit 1
fi

cfg() {
    # Read a "key: value" scalar from the YAML marker (quotes optional).
    # A missing key yields an empty string (callers decide whether that is fatal).
    { grep -E "^$1:" "$CONFIG_FILE" || true; } | head -n1 | sed -E "s/^$1:[[:space:]]*\"?([^\"]+)\"?.*/\1/"
}

require_cfg() {
    local value
    value="$(cfg "$1")"
    if [ -z "$value" ]; then
        echo "ERROR: '$1' missing from configuration marker $CONFIG_FILE" >&2
        exit 1
    fi
    printf '%s' "$value"
}

require_bool() {
    case "$2" in
        true|false) ;;
        *) echo "ERROR: '$1' must be true or false (got '$2')" >&2; exit 1 ;;
    esac
}

AVALANCHEGO_IMAGE="$(require_cfg avalanchego_image)"
AVALANCHEGO_BINARY="$(require_cfg avalanchego_binary)"
NETWORK_ID="$(require_cfg "${BC_NETWORK}_network_id")"
API_ADMIN_ENABLED="$(require_cfg api_admin_enabled)"
API_INFO_ENABLED="$(require_cfg api_info_enabled)"
API_HEALTH_ENABLED="$(require_cfg api_health_enabled)"
API_METRICS_ENABLED="$(require_cfg api_metrics_enabled)"
INDEX_ENABLED="$(require_cfg index_enabled)"
C_STATE_SYNC_ENABLED="$(require_cfg c_chain_state_sync_enabled)"
C_PRUNING_ENABLED="$(require_cfg c_chain_pruning_enabled)"
C_APIS="$(require_cfg c_chain_apis)"
LOG_LEVEL="$(require_cfg log_level)"

for pair in "api_admin_enabled:$API_ADMIN_ENABLED" "api_info_enabled:$API_INFO_ENABLED" \
            "api_health_enabled:$API_HEALTH_ENABLED" "api_metrics_enabled:$API_METRICS_ENABLED" \
            "index_enabled:$INDEX_ENABLED" "c_chain_state_sync_enabled:$C_STATE_SYNC_ENABLED" \
            "c_chain_pruning_enabled:$C_PRUNING_ENABLED"; do
    require_bool "${pair%%:*}" "${pair#*:}"
done
if [ "$API_ADMIN_ENABLED" != "false" ]; then
    echo "ERROR: api_admin_enabled must stay false on a node whose HTTP port is reachable from the VPC" >&2
    exit 1
fi

# Image must carry an explicit, immutable release tag (or digest).
IMAGE_REF="${AVALANCHEGO_IMAGE##*/}"
case "$IMAGE_REF" in
    *@sha256:*) ;;
    *:latest|*:master|*:master-r) echo "ERROR: avalanchego_image must be a pinned release tag (got '$AVALANCHEGO_IMAGE')" >&2; exit 1 ;;
    *:*) ;;
    *) echo "ERROR: avalanchego_image has no tag (got '$AVALANCHEGO_IMAGE')" >&2; exit 1 ;;
esac

# --- Install Docker if not present (host is Ubuntu 24.04) ---
# Idempotent: skips the apt repo setup when docker is already on PATH, so a
# re-run (or a boot where the AMI already ships docker) is a no-op.
if ! command -v docker &> /dev/null; then
    echo "Installing Docker (Ubuntu)..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.asc ]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
    fi
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
    echo "Docker is already installed"
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKER_EOF'
{
  "log-driver": "syslog",
  "log-opts": {
    "syslog-address": "unixgram:///dev/log",
    "tag": "{{.Name}}"
  }
}
DOCKER_EOF
systemctl enable docker
systemctl restart docker

# bcuser owns the data and runs the service
usermod -aG docker bcuser
BCUSER_UID="$(id -u bcuser)"
BCUSER_GID="$(id -g bcuser)"

# --- Data directory layout ---
# The container sees the same path as the host, so the paths AvalancheGo logs
# are the paths an operator finds on disk.
DATA_DIR="/data/avalanchego"
STAKING_DIR="${DATA_DIR}/staking"
NODE_CONFIG="${DATA_DIR}/configs/node.json"
C_CHAIN_CONFIG_DIR="${DATA_DIR}/configs/chains/C"
mkdir -p "${DATA_DIR}/configs" "$C_CHAIN_CONFIG_DIR"

# --- Staking identity: preserve, never regenerate ---
if [ -f "${STAKING_DIR}/staker.key" ]; then
    echo "Existing staking identity found in ${STAKING_DIR}; keeping it unchanged."
    chmod 700 "$STAKING_DIR"
else
    echo "No staking identity yet; AvalancheGo will generate one in ${STAKING_DIR} on first start."
fi

# --- Node config (rewritten each run; holds no secrets) ---
# http-allowed-hosts="*": requests through the HA ALB carry the ALB DNS name in
# the Host header, which the default ("localhost") answers with 403. The port
# itself binds to the internal IP and the security group limits it to the VPC.
cat > "$NODE_CONFIG" <<EOF
{
  "network-id": "${NETWORK_ID}",
  "data-dir": "${DATA_DIR}",
  "http-host": "${EC2_INTERNAL_IP}",
  "http-port": ${HTTP_PORT},
  "http-allowed-hosts": "*",
  "staking-host": "0.0.0.0",
  "staking-port": ${STAKING_PORT},
  "public-ip": "${EC2_PUBLIC_IP}",
  "api-admin-enabled": ${API_ADMIN_ENABLED},
  "api-info-enabled": ${API_INFO_ENABLED},
  "api-health-enabled": ${API_HEALTH_ENABLED},
  "api-metrics-enabled": ${API_METRICS_ENABLED},
  "index-enabled": ${INDEX_ENABLED},
  "log-level": "${LOG_LEVEL}",
  "log-display-level": "${LOG_LEVEL}"
}
EOF

# --- C-Chain config ---
C_APIS_JSON=$(printf '%s' "$C_APIS" | awk -F',' '{for (i = 1; i <= NF; i++) { gsub(/[[:space:]]/, "", $i); printf "%s\"%s\"", (i > 1 ? ", " : ""), $i }}')
cat > "${C_CHAIN_CONFIG_DIR}/config.json" <<EOF
{
  "state-sync-enabled": ${C_STATE_SYNC_ENABLED},
  "pruning-enabled": ${C_PRUNING_ENABLED},
  "apis": [${C_APIS_JSON}]
}
EOF

if command -v python3 &> /dev/null; then
    python3 -m json.tool "$NODE_CONFIG" > /dev/null
    python3 -m json.tool "${C_CHAIN_CONFIG_DIR}/config.json" > /dev/null
fi

# chown changes ownership only; it never alters the staking files' contents.
chown -R bcuser:bcuser /data /home/bcuser

# --- systemd service: name MUST be "node"; container runs the pinned image ---
# The container runs as bcuser's UID/GID (not root). --stop-timeout and
# TimeoutStopSec give AvalancheGo time to close its databases cleanly. A
# fully connected node keeps thousands of TCP connections, hence the nofile
# limit.
cat > /etc/systemd/system/node.service <<EOF
[Unit]
Description=Avalanche ${BC_NETWORK} AvalancheGo Node
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
User=bcuser
Group=bcuser
Restart=always
RestartSec=30
TimeoutStartSec=0
TimeoutStopSec=180
EnvironmentFile=/etc/cdk_environment
ExecStartPre=-/usr/bin/docker rm -f avalanchego
ExecStart=/usr/bin/docker run --rm --name avalanchego --network=host \\
  --user ${BCUSER_UID}:${BCUSER_GID} \\
  --ulimit nofile=65536:65536 \\
  --stop-timeout 120 \\
  --security-opt no-new-privileges \\
  -e HOME=${DATA_DIR} \\
  -v ${DATA_DIR}:${DATA_DIR} \\
  ${AVALANCHEGO_IMAGE} \\
  ${AVALANCHEGO_BINARY} \\
  --data-dir=${DATA_DIR} \\
  --config-file=${NODE_CONFIG}
ExecStop=/usr/bin/docker stop -t 120 avalanchego

[Install]
WantedBy=multi-user.target
EOF

# Pre-pull the pinned image (with retries) so the service starts promptly
# instead of crash-looping while a cold pull is in flight. Docker selects the
# amd64 or arm64 variant from the multi-arch index automatically.
echo "Pulling ${AVALANCHEGO_IMAGE} ..."
PULLED="false"
for attempt in 1 2 3 4 5; do
    if docker pull "${AVALANCHEGO_IMAGE}"; then
        echo "Image pulled"
        PULLED="true"
        break
    fi
    echo "Pull attempt ${attempt} failed; retrying in 15s..."
    sleep 15
done
if [ "$PULLED" != "true" ]; then
    echo "WARNING: could not pre-pull ${AVALANCHEGO_IMAGE}; the node service will retry the pull on start" >&2
fi

systemctl daemon-reload
systemctl enable node.service
systemctl start node.service

echo "Avalanche node service started"

# Sentinel for the framework/health tooling
touch /data/init-completed
echo "Avalanche node setup completed successfully"

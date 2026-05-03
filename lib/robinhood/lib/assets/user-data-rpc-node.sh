#!/bin/bash
set -e

echo "Starting Robinhood Chain RPC node initialization..."

# Update system and install dependencies
yum update -y
yum install -y docker wget tar gzip amazon-cloudwatch-agent jq

# Start Docker service
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
until docker info >/dev/null 2>&1; do
    echo "Waiting for Docker to start..."
    sleep 2
done

# Create data directory
mkdir -p /data/nitro
chown -R 1000:1000 /data/nitro

# Download Robinhood Chain config
echo "Downloading Robinhood Chain testnet config..."
wget -O /data/nitro/robinhood-chain-testnet-config.json https://cdn.robinhood.com/chain/testnet/robinhood-chain-testnet-config.json

if [ $? -ne 0 ]; then
    echo "Failed to download Robinhood Chain config"
    exit 1
fi

# Pull Nitro Docker image
echo "Pulling Nitro ${_NITRO_VERSION_}..."
docker pull offchainlabs/nitro-node:${_NITRO_VERSION_}

# Create systemd service for Nitro
cat > /etc/systemd/system/nitro.service << 'EOF'
[Unit]
Description=Robinhood Chain Nitro Node
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
TimeoutStartSec=0
ExecStartPre=-/usr/bin/docker stop nitro
ExecStartPre=-/usr/bin/docker rm nitro
ExecStart=/usr/bin/docker run --rm --name nitro \
  -v /data/nitro:/data \
  -p ${_RPC_PORT_}:${_RPC_PORT_} \
  -p ${_WS_PORT_}:${_WS_PORT_} \
  -p ${_METRICS_PORT_}:${_METRICS_PORT_} \
  offchainlabs/nitro-node:${_NITRO_VERSION_} \
  --conf.file /data/robinhood-chain-testnet-config.json \
  --chain.id ${_CHAIN_ID_} \
  --persistent.chain /data \
  --parent-chain.connection.url ${_L1_RPC_URL_} \
  --parent-chain.blob-client.beacon-url ${_L1_BEACON_URL_} \
  --node.sequencer-inbox-address 0x96295BDad104eaD97cC08797b3dC68efF59CcF30 \
  --node.staker.enable=false \
  --http.addr 0.0.0.0 \
  --http.port ${_RPC_PORT_} \
  --http.vhosts=* \
  --http.corsdomain=* \
  --http.api=eth,net,web3,arb \
  --ws.addr 0.0.0.0 \
  --ws.port ${_WS_PORT_} \
  --ws.origins=* \
  --ws.api=eth,net,web3,arb \
  --metrics \
  --metrics-server.addr 0.0.0.0 \
  --metrics-server.port ${_METRICS_PORT_} \
  --log-level info

ExecStop=/usr/bin/docker stop nitro

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and start Nitro service
systemctl daemon-reload
systemctl enable nitro
systemctl start nitro

# Wait for node to start responding
echo "Waiting for Nitro node to start..."
RETRIES=30
COUNT=0
while [ $COUNT -lt $RETRIES ]; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' \
        http://localhost:${_RPC_PORT_} | grep -q "result"; then
        echo "Nitro node is responding to RPC calls"
        break
    fi
    COUNT=$((COUNT + 1))
    echo "Waiting for node to respond... ($COUNT/$RETRIES)"
    sleep 10
done

if [ $COUNT -eq $RETRIES ]; then
    echo "Warning: Node did not respond after $RETRIES attempts, but continuing..."
fi

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json << EOF
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "/aws/ec2/${_STACK_NAME_}",
            "log_stream_name": "{instance_id}/cloud-init-output.log"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "RobinhoodChainNode",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          {
            "name": "cpu_usage_idle",
            "rename": "CPU_IDLE",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "totalcpu": false
      },
      "disk": {
        "measurement": [
          {
            "name": "used_percent",
            "rename": "DISK_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "/data"
        ]
      },
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MEM_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json

# Complete the lifecycle hook to signal node is ready
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

aws autoscaling complete-lifecycle-action \
    --lifecycle-action-result CONTINUE \
    --lifecycle-hook-name ${_LIFECYCLE_HOOK_NAME_} \
    --auto-scaling-group-name ${_AUTOSCALING_GROUP_NAME_} \
    --instance-id $INSTANCE_ID \
    --region ${_REGION_} || echo "Lifecycle hook completion failed, but continuing"

echo "Robinhood Chain RPC node initialization complete!"

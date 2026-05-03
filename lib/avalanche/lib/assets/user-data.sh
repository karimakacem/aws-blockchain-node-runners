#!/bin/bash
set -e

exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "Starting Avalanche node setup..."

# Variables from CDK (will be replaced at deploy time)
AWS_REGION=\${_AWS_REGION_}
ASSETS_S3_PATH=\${_ASSETS_S3_PATH_}
STACK_NAME=\${_STACK_NAME_}
STACK_ID=\${_STACK_ID_}
NODE_CF_LOGICAL_ID=\${_NODE_CF_LOGICAL_ID_}
DATA_VOLUME_TYPE=\${_DATA_VOLUME_TYPE_}
AVALANCHEGO_VERSION=\${_AVALANCHEGO_VERSION_}
AVALANCHE_NETWORK=\${_AVALANCHE_NETWORK_}
AVALANCHE_NODE_TYPE=\${_AVALANCHE_NODE_TYPE_}
HTTP_PORT=\${_HTTP_PORT_}
STAKING_PORT=\${_STAKING_PORT_}

# Update system
echo "Updating system packages..."
yum update -y
yum install -y wget curl jq amazon-cloudwatch-agent

# Download assets from S3
echo "Downloading assets from S3..."
mkdir -p /opt/avalanche-setup
aws s3 cp \${ASSETS_S3_PATH} /opt/avalanche-setup/ --recursive --region \${AWS_REGION}
chmod +x /opt/avalanche-setup/*.sh

# Create avalanche user
echo "Creating avalanche user..."
useradd -r -s /bin/false avalanche || true
mkdir -p /opt/avalanche /var/lib/avalanche /var/log/avalanche
chown avalanche:avalanche /var/lib/avalanche /var/log/avalanche

# Setup CloudWatch agent
echo "Setting up CloudWatch agent..."
cat /opt/avalanche-setup/cw-agent.json | \
    sed "s|<INSTANCE_ID>|$(ec2-metadata --instance-id | cut -d ' ' -f 2)|g" | \
    sed "s|<STACK_NAME>|${STACK_NAME}|g" \
    > /opt/aws/amazon-cloudwatch-agent/etc/config.json

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json

# Detect and mount data volume
echo "Detecting and mounting data volume..."
DEVICE=""
for i in {1..30}; do
    echo "Attempt $i/30: Looking for data volume..."
    if [ -e /dev/nvme1n1 ]; then
        DEVICE="/dev/nvme1n1"
        echo "Found NVMe device: $DEVICE"
        break
    fi
    if [ -e /dev/xvdf ]; then
        DEVICE="/dev/xvdf"
        echo "Found traditional device: $DEVICE"
        break
    fi
    lsblk
    sleep 10
done

if [ -z "$DEVICE" ]; then
    echo "ERROR: Data volume not found after 5 minutes"
    lsblk
    exit 1
fi

echo "Found data volume at $DEVICE"

# Format and mount if needed
if ! blkid $DEVICE; then
    echo "Formatting data volume with ext4..."
    mkfs -t ext4 $DEVICE
else
    echo "Volume is already formatted"
fi

mkdir -p /var/lib/avalanche/data
mount $DEVICE /var/lib/avalanche/data
chown -R avalanche:avalanche /var/lib/avalanche/data
echo "$DEVICE /var/lib/avalanche/data ext4 defaults,nofail 0 2" >> /etc/fstab
echo "Data volume mounted successfully"

# Download AvalancheGo
echo "Downloading AvalancheGo ${AVALANCHEGO_VERSION}..."
cd /opt/avalanche

# Determine architecture
ARCH=\$(uname -m)
if [ "\${ARCH}" = "aarch64" ]; then
    AVALANCHE_ARCH="arm64"
else
    AVALANCHE_ARCH="amd64"
fi

wget -q "https://github.com/ava-labs/avalanchego/releases/download/\${AVALANCHEGO_VERSION}/avalanchego-linux-\${AVALANCHE_ARCH}-\${AVALANCHEGO_VERSION}.tar.gz"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to download AvalancheGo"
    exit 1
fi

tar -xzf "avalanchego-linux-\${AVALANCHE_ARCH}-\${AVALANCHEGO_VERSION}.tar.gz"
mv "avalanchego-\${AVALANCHEGO_VERSION}" current
chmod +x current/avalanchego
chown -R avalanche:avalanche /opt/avalanche

# Test the binary
echo "Testing AvalancheGo binary..."
/opt/avalanche/current/avalanchego --version
if [ $? -ne 0 ]; then
    echo "ERROR: AvalancheGo binary test failed"
    exit 1
fi

# Create systemd service
echo "Creating systemd service..."
NETWORK_FLAG=""
if [ "\${AVALANCHE_NETWORK}" != "mainnet" ]; then
    NETWORK_FLAG="--network-id=\${AVALANCHE_NETWORK}"
fi

cat > /etc/systemd/system/avalanchego.service << EOF
[Unit]
Description=AvalancheGo Node
After=network.target
Wants=network.target

[Service]
Type=simple
User=avalanche
Group=avalanche
WorkingDirectory=/var/lib/avalanche
ExecStart=/opt/avalanche/current/avalanchego \\
  --data-dir=/var/lib/avalanche/data \\
  --log-dir=/var/log/avalanche \\
  --http-host=0.0.0.0 \\
  --http-port=\${HTTP_PORT} \\
  --staking-port=\${STAKING_PORT} \\
  --public-ip-resolution-service=opendns \\
  --log-level=info \\
  \${NETWORK_FLAG}
Restart=always
RestartSec=30
TimeoutStopSec=60
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=avalanchego

[Install]
WantedBy=multi-user.target
EOF

# Start service
echo "Starting AvalancheGo service..."
systemctl daemon-reload
systemctl enable avalanchego
systemctl start avalanchego

# Wait and check status
sleep 15
if systemctl is-active --quiet avalanchego; then
    echo "✓ AvalancheGo service is running"

    # Signal success to CloudFormation
    /opt/aws/bin/cfn-signal --stack \${STACK_NAME} --resource \${NODE_CF_LOGICAL_ID} --region \${AWS_REGION} --success true
else
    echo "✗ AvalancheGo service failed to start"
    systemctl status avalanchego
    journalctl -u avalanchego -n 50

    # Signal failure to CloudFormation
    /opt/aws/bin/cfn-signal --stack \${STACK_NAME} --resource \${NODE_CF_LOGICAL_ID} --region \${AWS_REGION} --success false --reason "AvalancheGo service failed to start"
    exit 1
fi

echo "Avalanche node setup completed successfully!"
echo "Check status: systemctl status avalanchego"
echo "View logs: journalctl -u avalanchego -f"

#!/bin/bash
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "Starting Circle ARC RPC node initialization..."

# Install required packages (--allowerasing needed to replace curl-minimal with curl)
dnf install -y --allowerasing docker wget curl jq amazon-cloudwatch-agent unzip

# Install Docker Compose v2
DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker}
mkdir -p $DOCKER_CONFIG/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.32.1/docker-compose-linux-x86_64 -o $DOCKER_CONFIG/cli-plugins/docker-compose
chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
ln -sf $DOCKER_CONFIG/cli-plugins/docker-compose /usr/local/bin/docker-compose

# Start Docker
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
until docker info >/dev/null 2>&1; do
    echo "Waiting for Docker to start..."
    sleep 2
done

# Create data directories
mkdir -p /data/arc-execution /data/arc-consensus /data/arc-run /opt/arc
chmod 777 /data/arc-execution /data/arc-consensus /data/arc-run

# Download assets from S3
aws s3 cp ${_ASSETS_S3_PATH_} /tmp/assets.zip
cd /tmp && unzip -q assets.zip
cp docker-compose.yml /opt/arc/
chmod +x download-snapshot.sh

# Download snapshot or initialize consensus layer
if [ "${_SNAPSHOT_DOWNLOAD_}" = "true" ]; then
    echo "Downloading ARC snapshot (this may take 30-60 minutes)..."
    ./download-snapshot.sh ${_ARC_NETWORK_} /data/arc-execution /data/arc-consensus
else
    echo "Initializing consensus layer..."
    docker run --rm -v /data/arc-consensus:/home docker.cloudsmith.io/circle/arc-network/arc-consensus:${_ARC_VERSION_} init --home /home
fi

# Set environment variables
echo "ARC_VERSION=${_ARC_VERSION_}" > /opt/arc/.env

# Pull Docker images
echo "Pulling Docker images..."
docker pull docker.cloudsmith.io/circle/arc-network/arc-execution:${_ARC_VERSION_}
docker pull docker.cloudsmith.io/circle/arc-network/arc-consensus:${_ARC_VERSION_}

# Start services with Docker Compose
echo "Starting ARC services..."
cd /opt/arc
docker compose up -d

# Wait for arc-execution container to be running
RETRIES=40
COUNT=0
while [ $COUNT -lt $RETRIES ]; do
    STATUS=$(docker inspect --format="{{.State.Status}}" arc-execution 2>/dev/null || echo "missing")
    if [ "$STATUS" = "running" ]; then break; fi
    if [ "$STATUS" = "exited" ]; then
        echo "arc-execution container exited, logs:"
        docker logs arc-execution --tail 20 2>/dev/null
        break
    fi
    COUNT=$((COUNT + 1))
    echo "Waiting for arc-execution container... ($COUNT/$RETRIES) status=$STATUS"
    sleep 15
done

EXECUTION_STATUS=$(docker inspect --format="{{.State.Status}}" arc-execution 2>/dev/null || echo "missing")
echo "Execution container status: $EXECUTION_STATUS"

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
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/aws/ec2/${_STACK_NAME_}",
            "log_stream_name": "{instance_id}/user-data.log"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "ArcNode",
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

# Complete lifecycle hook
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

if [ "$EXECUTION_STATUS" = "running" ]; then
    LIFECYCLE_RESULT="CONTINUE"
    echo "arc-execution is running, sending CONTINUE to lifecycle hook"
else
    LIFECYCLE_RESULT="ABANDON"
    echo "arc-execution is not running (status=$EXECUTION_STATUS), sending ABANDON to lifecycle hook"
    docker compose logs --tail=50
fi

aws autoscaling complete-lifecycle-action \
    --lifecycle-action-result $LIFECYCLE_RESULT \
    --lifecycle-hook-name ${_LIFECYCLE_HOOK_NAME_} \
    --auto-scaling-group-name ${_AUTOSCALING_GROUP_NAME_} \
    --instance-id $INSTANCE_ID \
    --region ${_REGION_}

echo "Circle ARC RPC node initialization complete!"

#!/bin/bash
set -e
source /etc/environment

TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)

echo "Snapshot restore started at $(date)"
SECONDS=0

# Ensure data directory exists with correct permissions
mkdir -p /var/lib/avalanche/data
chown -R avalanche:avalanche /var/lib/avalanche

# Download snapshot from S3
echo "Downloading blockchain data from S3..."
s5cmd --log error cp --exclude 'lost+found' --exclude '.snapshotted' ${SNAPSHOT_S3_PATH}/data/* /var/lib/avalanche/data/

# Fix permissions
chown -R avalanche:avalanche /var/lib/avalanche/data

echo "Snapshot restore finished at $(date)"
echo "$(($SECONDS / 60)) minutes and $(($SECONDS % 60)) seconds elapsed."

# Start AvalancheGo service
echo "Starting AvalancheGo service..."
systemctl start avalanchego

# Wait for service to be active
sleep 15

# Complete lifecycle action for ASG if this is an RPC node
if [ -n "$LIFECYCLE_HOOK_NAME" ] && [ -n "$AUTOSCALING_GROUP_NAME" ]; then
    if systemctl is-active --quiet avalanchego; then
        echo "Service is running, completing lifecycle action with CONTINUE"
        aws autoscaling complete-lifecycle-action \
            --lifecycle-action-result CONTINUE \
            --instance-id $INSTANCE_ID \
            --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME" \
            --auto-scaling-group-name "$AUTOSCALING_GROUP_NAME" \
            --region $REGION
    else
        echo "Service failed to start, completing lifecycle action with ABANDON"
        aws autoscaling complete-lifecycle-action \
            --lifecycle-action-result ABANDON \
            --instance-id $INSTANCE_ID \
            --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME" \
            --auto-scaling-group-name "$AUTOSCALING_GROUP_NAME" \
            --region $REGION
    fi
fi

echo "Snapshot restore complete!"

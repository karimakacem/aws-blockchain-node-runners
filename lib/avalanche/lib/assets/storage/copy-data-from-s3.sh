#!/bin/bash
source /etc/environment

TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)

echo "Snapshot restore started at $(date)"

# Ensure data directory exists with correct permissions
mkdir -p /var/lib/avalanche/data
chown -R avalanche:avalanche /var/lib/avalanche

# Wait for snapshot to be available in S3 (sync node may still be bootstrapping)
echo "Waiting for snapshot to be available at ${SNAPSHOT_S3_PATH}/data/ ..."
WAIT_RETRIES=720
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $WAIT_RETRIES ]; do
    OBJECT_COUNT=$(aws s3 ls "${SNAPSHOT_S3_PATH}/data/" --region "$REGION" 2>/dev/null | grep -c "PRE\|[0-9]" || true)
    if [ "$OBJECT_COUNT" -gt 0 ]; then
        echo "Snapshot found in S3 after $((WAIT_COUNT * 5 / 60)) minutes. Starting restore..."
        break
    fi
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $((WAIT_COUNT % 12)) -eq 0 ]; then
        echo "Still waiting for snapshot... ($((WAIT_COUNT * 5 / 60)) minutes elapsed)"
    fi
    sleep 5
done

if [ $WAIT_COUNT -ge $WAIT_RETRIES ]; then
    echo "ERROR: Snapshot not available after 1 hour. Starting AvalancheGo to sync from scratch."
fi

SECONDS=0

if [ $WAIT_COUNT -lt $WAIT_RETRIES ]; then
    # Download snapshot from S3
    echo "Downloading blockchain data from S3..."
    s5cmd --log error cp --exclude 'lost+found' --exclude '.snapshotted' "${SNAPSHOT_S3_PATH}/data/*" /var/lib/avalanche/data/

    # Fix permissions
    chown -R avalanche:avalanche /var/lib/avalanche/data

    echo "Snapshot restore finished at $(date)"
    echo "$((SECONDS / 60)) minutes and $((SECONDS % 60)) seconds elapsed."
fi

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
            --instance-id "$INSTANCE_ID" \
            --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME" \
            --auto-scaling-group-name "$AUTOSCALING_GROUP_NAME" \
            --region "$REGION"
    else
        echo "Service failed to start, completing lifecycle action with ABANDON"
        aws autoscaling complete-lifecycle-action \
            --lifecycle-action-result ABANDON \
            --instance-id "$INSTANCE_ID" \
            --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME" \
            --auto-scaling-group-name "$AUTOSCALING_GROUP_NAME" \
            --region "$REGION"
    fi
fi

echo "Snapshot restore complete!"

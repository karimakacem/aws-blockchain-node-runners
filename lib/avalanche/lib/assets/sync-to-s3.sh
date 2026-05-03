#!/bin/bash
set -e

SNAPSHOT_BUCKET_NAME="$1"
DATA_DIR="$2"

if [ -z "$SNAPSHOT_BUCKET_NAME" ] || [ -z "$DATA_DIR" ]; then
    echo "Usage: $0 <snapshot_bucket_name> <data_dir>"
    exit 1
fi

echo "Starting snapshot backup to S3..."
echo "Bucket: $SNAPSHOT_BUCKET_NAME"
echo "Data directory: $DATA_DIR"

# Install s5cmd if not present
if ! command -v s5cmd &> /dev/null; then
    echo "Installing s5cmd..."
    cd /tmp
    wget -q https://github.com/peak/s5cmd/releases/download/v2.2.2/s5cmd_2.2.2_Linux-64bit.tar.gz
    tar -xzf s5cmd_2.2.2_Linux-64bit.tar.gz
    mv s5cmd /usr/local/bin/
    chmod +x /usr/local/bin/s5cmd
    rm -f s5cmd_2.2.2_Linux-64bit.tar.gz
fi

echo "Uploading snapshot to S3..."
cd "$DATA_DIR"

# Sync to S3, excluding log files
s5cmd --numworkers 128 sync \
    --exclude "*.log" \
    --exclude "logs/*" \
    . "s3://${SNAPSHOT_BUCKET_NAME}/"

echo "Snapshot backup completed successfully"

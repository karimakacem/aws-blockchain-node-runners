#!/bin/bash
set -e

SNAPSHOT_BUCKET_NAME="$1"
DATA_DIR="$2"

if [ -z "$SNAPSHOT_BUCKET_NAME" ] || [ -z "$DATA_DIR" ]; then
    echo "Usage: $0 <snapshot_bucket_name> <data_dir>"
    exit 1
fi

echo "Starting snapshot restore from S3..."
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

# Check if bucket has data
OBJECT_COUNT=$(aws s3 ls "s3://${SNAPSHOT_BUCKET_NAME}/" --recursive | wc -l)
if [ "$OBJECT_COUNT" -eq 0 ]; then
    echo "No snapshot found in S3 bucket. Starting fresh sync."
    exit 0
fi

echo "Found snapshot in S3. Downloading..."
cd "$DATA_DIR"
s5cmd --numworkers 128 sync "s3://${SNAPSHOT_BUCKET_NAME}/*" .

echo "Snapshot restore completed successfully"
echo "Downloaded objects count: $(find . -type f | wc -l)"

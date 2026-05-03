#!/bin/bash
set -e

# Download and extract Arbitrum snapshot
# Snapshots provided by Offchain Labs: https://snapshot.arbitrum.io/

NETWORK=${1:-arb1}
SNAPSHOT_TYPE=${2:-pruned}
DATA_DIR=${3:-/data/nitro}

echo "=== Arbitrum Snapshot Download ==="
echo "Network: $NETWORK"
echo "Snapshot Type: $SNAPSHOT_TYPE"
echo "Data Directory: $DATA_DIR"
echo ""

# Determine snapshot URL based on network and type
case "$NETWORK" in
    arb1)
        SNAPSHOT_BASE_URL="https://snapshot.arbitrum.foundation/arb1"
        ;;
    nova)
        SNAPSHOT_BASE_URL="https://snapshot.arbitrum.foundation/nova"
        ;;
    sepolia-rollup)
        SNAPSHOT_BASE_URL="https://snapshot.arbitrum.foundation/sepolia-rollup"
        ;;
    *)
        echo "ERROR: Unknown network: $NETWORK"
        exit 1
        ;;
esac

# Create data directory
mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# Get latest snapshot filename
echo "Fetching latest $SNAPSHOT_TYPE snapshot list..."
SNAPSHOT_FILE=$(curl -s "${SNAPSHOT_BASE_URL}/${SNAPSHOT_TYPE}-list.txt" | tail -1)

if [ -z "$SNAPSHOT_FILE" ]; then
    echo "ERROR: Could not determine snapshot filename"
    exit 1
fi

SNAPSHOT_URL="${SNAPSHOT_BASE_URL}/${SNAPSHOT_FILE}"
echo "Snapshot URL: $SNAPSHOT_URL"
echo ""

# Download snapshot with progress
echo "Downloading snapshot (this may take 30-60 minutes)..."
SECONDS=0

wget -c -q --show-progress "$SNAPSHOT_URL" -O snapshot.tar || {
    echo "ERROR: Download failed"
    exit 1
}

echo ""
echo "Download completed in $(($SECONDS / 60)) minutes"
echo ""

# Extract snapshot
echo "Extracting snapshot (this may take 10-20 minutes)..."
SECONDS=0

tar -xf snapshot.tar || {
    echo "ERROR: Extraction failed"
    rm -f snapshot.tar
    exit 1
}

echo "Extraction completed in $(($SECONDS / 60)) minutes"
echo ""

# Cleanup
rm -f snapshot.tar
echo "Snapshot download and extraction complete!"
echo "Data directory: $DATA_DIR"
ls -lh "$DATA_DIR"

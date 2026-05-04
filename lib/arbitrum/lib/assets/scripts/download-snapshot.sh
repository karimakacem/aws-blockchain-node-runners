#!/bin/bash

# Download and extract Arbitrum snapshot
# Snapshots from: https://snapshot-explorer.arbitrum.io/

NETWORK=${1:-arb1}
SNAPSHOT_TYPE=${2:-pruned}
DATA_DIR=${3:-/data/nitro}

echo "=== Arbitrum Snapshot Download ==="
echo "Network: $NETWORK"
echo "Snapshot Type: $SNAPSHOT_TYPE (converted to API format)"
echo "Data Directory: $DATA_DIR"
echo ""

# Map network names for API
case "$NETWORK" in
    arb1)
        API_NETWORK="arb1"
        ;;
    nova)
        API_NETWORK="nova"
        ;;
    sepolia-rollup)
        API_NETWORK="sepolia"
        ;;
    *)
        echo "ERROR: Unknown network: $NETWORK"
        exit 1
        ;;
esac

# Map snapshot type to API format
case "$SNAPSHOT_TYPE" in
    pruned)
        API_TYPE="Pruned"
        ;;
    archive)
        API_TYPE="Archive"
        ;;
    *)
        echo "WARNING: Unknown snapshot type '$SNAPSHOT_TYPE', will sync from genesis"
        exit 0
        ;;
esac

# Create data directory
mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# Fetch latest snapshot info from API
echo "Fetching latest $API_TYPE snapshot for $API_NETWORK..."
SNAPSHOT_INFO=$(curl -s "https://snapshot-explorer.arbitrum.io/api/snapshots" | jq -r ".data[] | select(.name==\"$API_NETWORK\") | .snapshotsByType[] | select(.type==\"$API_TYPE\") | .snapshots[0]")

if [ -z "$SNAPSHOT_INFO" ] || [ "$SNAPSHOT_INFO" = "null" ]; then
    echo "WARNING: No $API_TYPE snapshot available, will sync from genesis"
    exit 0
fi

# Check if snapshot is finished
IS_FINISHED=$(echo "$SNAPSHOT_INFO" | jq -r '.isFinished // false')
if [ "$IS_FINISHED" != "true" ]; then
    echo "WARNING: Latest snapshot not finished, will sync from genesis"
    exit 0
fi

# Get snapshot parts
PARTS=$(echo "$SNAPSHOT_INFO" | jq -r '.parts[].key')
PART_COUNT=$(echo "$PARTS" | wc -l | tr -d ' ')

echo "Found $PART_COUNT part(s) to download"
echo ""

# Download all parts
SNAPSHOT_BASE="https://snapshot.arbitrum.foundation"
PART_NUM=0
SECONDS=0

for PART_KEY in $PARTS; do
    PART_URL="${SNAPSHOT_BASE}/${PART_KEY}"
    PART_FILE=$(basename "$PART_KEY")

    echo "Downloading part $((PART_NUM + 1))/$PART_COUNT: $PART_FILE"
    wget -c -q --show-progress "$PART_URL" -O "$PART_FILE" || {
        echo "ERROR: Download failed for $PART_FILE"
        rm -f *.part*
        exit 1
    }

    PART_NUM=$((PART_NUM + 1))
done

DOWNLOAD_TIME=$(($SECONDS / 60))
echo ""
echo "Download completed in $DOWNLOAD_TIME minutes"
echo ""

# Combine and extract parts
echo "Combining and extracting snapshot parts..."
SECONDS=0

# Cat all parts together and extract directly
cat *.part* | tar -xf - || {
    echo "ERROR: Extraction failed"
    rm -f *.part*
    exit 1
}

EXTRACT_TIME=$(($SECONDS / 60))
echo "Extraction completed in $EXTRACT_TIME minutes"
echo ""

# Cleanup
rm -f *.part*
echo "Snapshot download and extraction complete!"
echo "Data directory: $DATA_DIR"
ls -lh "$DATA_DIR" | head -10

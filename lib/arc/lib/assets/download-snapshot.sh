#!/bin/bash
# Download and extract Circle ARC snapshot
CHAIN=${1:-arc-testnet}
EXECUTION_DIR=${2:-/data/arc-execution}
CONSENSUS_DIR=${3:-/data/arc-consensus}

echo "=== Circle ARC Snapshot Download ==="
echo "Chain: $CHAIN"
echo "Execution Directory: $EXECUTION_DIR"
echo "Consensus Directory: $CONSENSUS_DIR"
echo ""

# Create directories
mkdir -p "$EXECUTION_DIR" "$CONSENSUS_DIR"

# arc-snapshots uses /tmp as staging area for extraction regardless of --execution-path.
# On EC2, /tmp is a 62 GB tmpfs that fills up with snapshot files (~84 GB compressed).
# Setting TMPDIR to a path on the large EBS data volume forces staging there instead.
TMPDIR_PARENT=$(dirname "$EXECUTION_DIR")
export TMPDIR="$TMPDIR_PARENT/arc-tmp"
mkdir -p "$TMPDIR"
echo "Using TMPDIR=$TMPDIR for snapshot staging"

# Install arc-snapshots tool if not present
export PATH="$HOME/.arc/bin:$PATH"
if ! command -v arc-snapshots &> /dev/null; then
    echo "Installing arc-snapshots tool..."

    INSTALL_SCRIPT=$(mktemp)
    if ! curl -fL https://raw.githubusercontent.com/circlefin/arc-node/main/arcup/install -o "$INSTALL_SCRIPT"; then
        echo "ERROR: Failed to download arcup install script"
        rm -f "$INSTALL_SCRIPT"
        exit 1
    fi

    # Verify the script looks legitimate (basic sanity check)
    if grep -q "arc-snapshots" "$INSTALL_SCRIPT" && grep -q "ARC_HOME" "$INSTALL_SCRIPT"; then
        bash "$INSTALL_SCRIPT"
        rm -f "$INSTALL_SCRIPT"
    else
        echo "ERROR: Downloaded install script appears invalid"
        rm -f "$INSTALL_SCRIPT"
        exit 1
    fi

    if [ -f "$HOME/.arc/env" ]; then
        source "$HOME/.arc/env"
    fi
    export PATH="$HOME/.arc/bin:$PATH"
fi

# Verify installation
if ! command -v arc-snapshots &> /dev/null; then
    echo "ERROR: Failed to install arc-snapshots tool"
    exit 1
fi

echo "arc-snapshots version: $(arc-snapshots --version)"
echo ""

# Download snapshots (~84 GB compressed)
echo "Downloading snapshots (this may take 30-60 minutes)..."
START_TIME=$(date +%s)

arc-snapshots download \
    --chain "$CHAIN" \
    --execution-path "$EXECUTION_DIR" \
    --consensus-path "$CONSENSUS_DIR"

EXIT_CODE=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))

# Clean up staging area
rm -rf "$TMPDIR"

if [ $EXIT_CODE -ne 0 ]; then
    echo "ERROR: arc-snapshots download failed with exit code $EXIT_CODE"
    exit $EXIT_CODE
fi

echo ""
echo "Snapshot download completed in $DURATION_MIN minutes"

# arc-snapshots extracts files as root; containers run as uid 999 (arc user).
# Without this chown the execution container fails with "permission denied on /data/db/lock".
echo "Setting ownership for container user (uid 999)..."
chown -R 999:65533 "$EXECUTION_DIR" "$CONSENSUS_DIR"

echo "Execution data: $EXECUTION_DIR"
echo "Consensus data: $CONSENSUS_DIR"
echo ""

# Display disk usage
echo "Disk usage:"
du -sh "$EXECUTION_DIR" "$CONSENSUS_DIR"

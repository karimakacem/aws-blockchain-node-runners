#!/bin/bash
set -e

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

# Install arc-snapshots tool if not present
if ! command -v arc-snapshots &> /dev/null; then
    echo "Installing arc-snapshots tool..."

    # Download and install arcup
    curl -L https://raw.githubusercontent.com/circlefin/arc-node/main/arcup/install | bash

    # Source environment
    if [ -f "$HOME/.arc/env" ]; then
        source "$HOME/.arc/env"
    fi

    # Add to PATH for current session
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

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))

echo ""
echo "Snapshot download completed in $DURATION_MIN minutes"
echo "Execution data: $EXECUTION_DIR"
echo "Consensus data: $CONSENSUS_DIR"
echo ""

# Display disk usage
echo "Disk usage:"
du -sh "$EXECUTION_DIR" "$CONSENSUS_DIR"

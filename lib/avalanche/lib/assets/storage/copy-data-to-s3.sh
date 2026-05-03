#!/bin/bash
set +e
source /etc/environment

echo "Stopping AvalancheGo service for snapshot..."
systemctl stop avalanchego

echo "Snapshot sync started at $(date)"
SECONDS=0

# Sync the blockchain data directory to S3
s5cmd --log error sync /var/lib/avalanche/data/ ${SNAPSHOT_S3_PATH}/data/

echo "Snapshot sync finished at $(date)"
echo "$(($SECONDS / 60)) minutes and $(($SECONDS % 60)) seconds elapsed."

# Mark that snapshot has been taken
touch /var/lib/avalanche/data/.snapshotted

echo "Restarting AvalancheGo service..."
systemctl start avalanchego

echo "Snapshot upload complete!"

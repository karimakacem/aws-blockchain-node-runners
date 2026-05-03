#!/bin/bash
set +e
source /etc/environment

TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S")

# Check if AvalancheGo is running
if ! systemctl is-active --quiet avalanchego; then
    echo "AvalancheGo service is not running"
    exit 1
fi

# Query the info API for bootstrapping status
API_RESPONSE=$(curl -s -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.isBootstrapped",
    "params": {
        "chain":"X"
    }
}' -H 'content-type:application/json;' http://127.0.0.1:${AVALANCHE_HTTP_PORT}/ext/info)

X_CHAIN_BOOTSTRAPPED=$(echo $API_RESPONSE | jq -r '.result.isBootstrapped // false')

API_RESPONSE=$(curl -s -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.isBootstrapped",
    "params": {
        "chain":"P"
    }
}' -H 'content-type:application/json;' http://127.0.0.1:${AVALANCHE_HTTP_PORT}/ext/info)

P_CHAIN_BOOTSTRAPPED=$(echo $API_RESPONSE | jq -r '.result.isBootstrapped // false')

API_RESPONSE=$(curl -s -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.isBootstrapped",
    "params": {
        "chain":"C"
    }
}' -H 'content-type:application/json;' http://127.0.0.1:${AVALANCHE_HTTP_PORT}/ext/info)

C_CHAIN_BOOTSTRAPPED=$(echo $API_RESPONSE | jq -r '.result.isBootstrapped // false')

# Get peer count
API_RESPONSE=$(curl -s -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.peers"
}' -H 'content-type:application/json;' http://127.0.0.1:${AVALANCHE_HTTP_PORT}/ext/info)

PEER_COUNT=$(echo $API_RESPONSE | jq -r '.result.numPeers // 0')

echo "X-Chain Bootstrapped: $X_CHAIN_BOOTSTRAPPED"
echo "P-Chain Bootstrapped: $P_CHAIN_BOOTSTRAPPED"
echo "C-Chain Bootstrapped: $C_CHAIN_BOOTSTRAPPED"
echo "Peer Count: $PEER_COUNT"

# Send metrics to CloudWatch
aws cloudwatch put-metric-data --metric-name x_chain_bootstrapped --namespace AvalancheNode --value $([ "$X_CHAIN_BOOTSTRAPPED" == "true" ] && echo 1 || echo 0) --timestamp $TIMESTAMP --dimensions InstanceId=$INSTANCE_ID --region $REGION
aws cloudwatch put-metric-data --metric-name p_chain_bootstrapped --namespace AvalancheNode --value $([ "$P_CHAIN_BOOTSTRAPPED" == "true" ] && echo 1 || echo 0) --timestamp $TIMESTAMP --dimensions InstanceId=$INSTANCE_ID --region $REGION
aws cloudwatch put-metric-data --metric-name c_chain_bootstrapped --namespace AvalancheNode --value $([ "$C_CHAIN_BOOTSTRAPPED" == "true" ] && echo 1 || echo 0) --timestamp $TIMESTAMP --dimensions InstanceId=$INSTANCE_ID --region $REGION
aws cloudwatch put-metric-data --metric-name peer_count --namespace AvalancheNode --value $PEER_COUNT --timestamp $TIMESTAMP --dimensions InstanceId=$INSTANCE_ID --region $REGION

# If this is a sync node, check if we should take a snapshot
if [[ "$NODE_ROLE" == "sync-node" ]]; then
    # Check if snapshot has already been taken
    if [ ! -f "/var/lib/avalanche/data/.snapshotted" ]; then
        # All chains must be bootstrapped before taking snapshot
        if [ "$X_CHAIN_BOOTSTRAPPED" == "true" ] && [ "$P_CHAIN_BOOTSTRAPPED" == "true" ] && [ "$C_CHAIN_BOOTSTRAPPED" == "true" ]; then
            echo "All chains are bootstrapped. Taking initial snapshot..."
            /opt/avalanche/storage/copy-data-to-s3.sh

            # Set up daily snapshot cron job (runs at 2 AM)
            (crontab -l 2>/dev/null; echo '0 2 * * * /opt/avalanche/storage/copy-data-to-s3.sh >> /var/log/avalanche/snapshot.log 2>&1') | crontab -
            echo "Daily snapshot cron job configured"
        else
            echo "Waiting for all chains to bootstrap before taking snapshot"
        fi
    else
        echo "Initial snapshot already taken. Daily cron job should handle updates."
    fi
fi

#!/bin/bash

PUBLIC_IP="$1"
if [ -z "$PUBLIC_IP" ]; then
    echo "Usage: $0 <public_ip>"
    exit 1
fi

echo "Testing Avalanche Node at $PUBLIC_IP"
echo "=================================="

# Function to make API calls with timeout
api_call() {
    local endpoint="$1"
    local data="$2"
    local description="$3"
    
    echo -n "$description... "
    result=$(timeout 10 curl -s -X POST --data "$data" \
        -H 'content-type:application/json;' \
        "http://$PUBLIC_IP:9650$endpoint" 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$result" ]; then
        echo "✓"
        echo "  Response: $result" | jq '.' 2>/dev/null || echo "  Response: $result"
        return 0
    else
        echo "✗"
        return 1
    fi
}

# Test 1: Basic connectivity
echo "1. Testing basic connectivity..."
if timeout 10 bash -c "echo > /dev/tcp/$PUBLIC_IP/9650" 2>/dev/null; then
    echo "✓ Port 9650 is accessible"
else
    echo "✗ Port 9650 is not accessible"
    echo "The node may still be starting up. Please wait a few more minutes."
    exit 1
fi

echo

# Test 2: Node ID
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' "2. Getting Node ID"

echo

# Test 3: Node Version
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.getNodeVersion"}' "3. Getting Node Version"

echo

# Test 4: Network ID
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.getNetworkID"}' "4. Getting Network ID"

echo

# Test 5: Health Check
api_call "/ext/health" '{"jsonrpc":"2.0","id":1,"method":"health.health"}' "5. Checking Node Health"

echo

# Test 6: Bootstrap Status (X-Chain)
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.isBootstrapped","params":{"chain":"X"}}' "6. Checking X-Chain Bootstrap Status"

echo

# Test 7: Bootstrap Status (P-Chain)
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.isBootstrapped","params":{"chain":"P"}}' "7. Checking P-Chain Bootstrap Status"

echo

# Test 8: Bootstrap Status (C-Chain)
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.isBootstrapped","params":{"chain":"C"}}' "8. Checking C-Chain Bootstrap Status"

echo

# Test 9: Peer Count
api_call "/ext/info" '{"jsonrpc":"2.0","id":1,"method":"info.peers"}' "9. Getting Peer Information"

echo

# Test 10: X-Chain Height (if bootstrapped)
api_call "/ext/bc/X" '{"jsonrpc":"2.0","id":1,"method":"avm.getHeight"}' "10. Getting X-Chain Height"

echo

# Test 11: C-Chain Block Number (if bootstrapped)
api_call "/ext/bc/C/rpc" '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}' "11. Getting C-Chain Block Number"

echo
echo "=================================="
echo "Test completed!"
echo
echo "Note: If bootstrap status shows 'false', the node is still syncing."
echo "This is normal and can take 30+ minutes for initial sync."

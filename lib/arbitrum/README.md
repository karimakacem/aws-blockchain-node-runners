# Sample AWS Blockchain Node Runner app for Arbitrum One

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

## Architecture Overview

This blueprint deploys Arbitrum One nodes on AWS using the Nitro stack. Arbitrum One is a Layer 2 optimistic rollup that scales Ethereum with lower costs and faster transactions.

### Deployment Options

**1. Single Node Setup (`arbitrum-one-single-node`)**

Ideal for development, testing, or personal use:
- Single EC2 instance running Arbitrum Nitro node in Docker
- EBS gp3 volume for blockchain data storage (2TB recommended)
- Automated snapshot download for fast initial sync
- Security groups with VPC-only RPC/WS access
- CloudWatch monitoring with custom dashboards
- IAM roles with Systems Manager access (no SSH required)

**2. High Availability RPC Nodes (`arbitrum-one-rpc-nodes`)**

Production-ready setup with load balancing:
- Multiple RPC nodes (2-4) behind Application Load Balancer
- Auto Scaling Group manages node lifecycle
- Each node downloads snapshot for fast initial sync
- Health checks ensure only synced nodes receive traffic
- Automatic failover if a node becomes unhealthy
- VPC-only access with ALB distributing requests

**Key Features:**
- Uses official Nitro Docker images from Offchain Labs
- Automated snapshot download from Arbitrum's API for fast initial sync
- Connects to your Ethereum L1 RPC and Beacon endpoints
- Secure RPC access restricted to VPC

## Prerequisites

### Required: Ethereum L1 Endpoints

Arbitrum nodes require connections to Ethereum mainnet (L1):
- **L1 RPC URL**: Ethereum execution client endpoint
- **L1 Beacon URL**: Ethereum consensus client beacon endpoint

**Options:**

1. **Free Public Endpoints** (testing/development):
   - [PublicNode.com](https://www.publicnode.com/) - Free, rate-limited
   - Mainnet RPC: `https://ethereum-rpc.publicnode.com`
   - Mainnet Beacon: `https://ethereum-beacon-api.publicnode.com`
   - ⚠️ Rate limits apply - suitable for testing, not production

2. **Paid Service Providers** (production):
   - [Alchemy](https://www.alchemy.com/)
   - [Infura](https://www.infura.io/)
   - [QuickNode](https://www.quicknode.com/)
   - [Ankr](https://www.ankr.com/)

3. **Self-Hosted** (most reliable):
   - Run your own Ethereum node (see [ethereum blueprint](../ethereum/README.md))

### AWS Requirements

- AWS account with permissions for IAM, EC2, EBS, VPC, and CloudFormation
- AWS CLI configured
- Node.js 16+ and npm
- AWS CDK v2 installed (`npm install -g aws-cdk`)

## Solution Walkthrough

### Clone repository and install dependencies

```bash
git clone https://github.com/aws-samples/aws-blockchain-node-runners.git
cd aws-blockchain-node-runners
npm install
```

### Prepare AWS account

Ensure you have a default VPC:

```bash
aws ec2 create-default-vpc
```

> **NOTE:** You may see an error if the default VPC already exists - that's fine.

### Configure Arbitrum One node

Navigate to the Arbitrum blueprint directory:

```bash
cd lib/arbitrum
pwd
```

Create your configuration from the sample:

```bash
cp ./sample-configs/.env-arbitrum-one-mainnet .env
nano .env
```

**Required settings:**

```bash
AWS_ACCOUNT_ID="your-account-id"
AWS_REGION="us-east-1"

# IMPORTANT: Update these with your Ethereum L1 endpoints
L1_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY"
L1_BEACON_URL="https://eth-beacon.example.com"
```

**Optional settings:**
- `NITRO_VERSION`: Nitro version (check [releases](https://github.com/OffchainLabs/nitro/releases))
- `ARBITRUM_SNAPSHOT_TYPE`: `pruned` (fast, recommended), `archive` (full history), or `none`

**Single Node options:**
- `ARBITRUM_SINGLE_NODE_INSTANCE_TYPE`: EC2 instance type (m6i.2xlarge recommended)
- `ARBITRUM_SINGLE_NODE_DATA_VOL_SIZE`: Data volume size in GiB (2000 for pruned, 4000+ for archive)

**HA RPC Nodes options:**
- `ARBITRUM_RPC_INSTANCE_TYPE`: EC2 instance type (default: m6i.2xlarge)
- `ARBITRUM_RPC_NUMBER_OF_NODES`: Number of nodes (2-4, default: 2)
- `ARBITRUM_RPC_DATA_VOL_SIZE`: Data volume size in GiB (default: 2000)
- `ARBITRUM_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN`: Health check grace period (default: 30 minutes)
- `ARBITRUM_RPC_HA_NODES_HEARTBEAT_DELAY_MIN`: Lifecycle hook timeout (default: 180 minutes)

### Deploy Arbitrum One node

1. Deploy common stack with IAM roles:

```bash
npx cdk deploy arbitrum-one-common
```

2. Choose your deployment option:

**Option A: Single Node (for testing/development)**

```bash
npx cdk deploy arbitrum-one-single-node
```

**Option B: HA RPC Nodes (for production)**

```bash
npx cdk deploy arbitrum-one-rpc-nodes
```

Deployment takes approximately:
- Stack creation: 5-10 minutes
- Snapshot download and sync: 1-2 hours

Total time to fully operational node: ~1-2 hours

> **Note:** Snapshots are downloaded from Arbitrum's API at snapshot-explorer.arbitrum.io. The download script fetches the latest snapshot in multipart format and extracts it automatically.

For HA setup, nodes come online sequentially. The ALB health checks ensure only synced nodes receive traffic.

### Verify deployment

**For Single Node:**

Get the instance ID:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name arbitrum-one-single-node --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)

aws ssm start-session --target $INSTANCE_ID
```

Check the Nitro service:

```bash
sudo systemctl status nitro
sudo docker logs nitro -f
```

**For HA RPC Nodes:**

Get the ALB URL:

```bash
ALB_URL=$(aws cloudformation describe-stacks --stack-name arbitrum-one-rpc-nodes --query 'Stacks[0].Outputs[?OutputKey==`alb-url`].OutputValue' --output text)

echo $ALB_URL
```

### Test the node

**Single Node (from within the VPC or via Systems Manager):**

```bash
# Get node info
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://localhost:8547

# Expected response: {"jsonrpc":"2.0","id":1,"result":"0xa4b1"}  (42161 in hex)

# Check sync status
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
  http://localhost:8547
```

**HA RPC Nodes (from within the VPC):**

```bash
# Get node info (replace with your ALB URL)
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://$ALB_URL:8547

# Check sync status
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
  http://$ALB_URL:8547
```

### Monitor your node

View CloudWatch dashboard:
1. Navigate to CloudWatch in AWS Console
2. Select "Dashboards"
3. Find `arbitrum-one-single-node-<instance-id>`

View logs:

```bash
# Via Systems Manager
aws ssm start-session --target $INSTANCE_ID

# Check Docker logs
sudo docker logs nitro -f --tail 100

# Check system logs
sudo journalctl -u nitro -f
```

## Configuration Reference

### Instance Type Recommendations

| Instance Type | vCPUs | Memory | Use Case | Monthly Cost* |
|--------------|-------|---------|----------|--------------|
| m6i.xlarge   | 4     | 16 GiB  | Light usage | ~$140 |
| m6i.2xlarge  | 8     | 32 GiB  | Recommended | ~$280 |
| m6i.4xlarge  | 16    | 64 GiB  | High traffic | ~$560 |
| m7g.2xlarge  | 8     | 32 GiB  | Graviton (20% cheaper) | ~$224 |

*Estimated costs in US East (N. Virginia) including EBS storage

### Storage Requirements

- **Pruned Node**: 2TB (recommended for most use cases)
- **Archive Node**: 4TB+ (full historical data)

### Cost Comparison

| Setup | Monthly Cost* | Use Case |
|-------|--------------|----------|
| Single Node (m6i.2xlarge) | ~$280 | Development, testing, personal use |
| HA RPC (2x m6i.2xlarge) | ~$560 | Production with load balancing and failover |
| HA RPC (4x m6i.2xlarge) | ~$1,120 | High traffic production environments |

*Estimated costs in US East (N. Virginia) including compute, storage (2TB gp3), and data transfer

### Snapshot Types

- **pruned**: Latest state only, faster sync, smaller storage (~400-600GB)
- **archive**: Full history, slower sync, larger storage (~2-3TB)
- **none**: Sync from genesis (not recommended, takes days)

## Clean Up

To avoid ongoing charges, delete the stacks in reverse order:

**If you deployed Single Node:**

```bash
# Delete node stack
npx cdk destroy arbitrum-one-single-node

# Delete common stack
npx cdk destroy arbitrum-one-common
```

**If you deployed HA RPC Nodes:**

```bash
# Delete RPC nodes stack
npx cdk destroy arbitrum-one-rpc-nodes

# Delete common stack
npx cdk destroy arbitrum-one-common
```

> **WARNING:** This permanently deletes your node data and all blockchain state.

## Troubleshooting

### Node not syncing

Check Docker logs:
```bash
sudo docker logs nitro --tail 100
```

Common issues:
- Invalid L1 RPC/Beacon URLs - verify endpoints are accessible
- Insufficient disk space - increase volume size
- L1 endpoint rate limiting - use paid tier or run your own node

### Snapshot download failed

Check download script:
```bash
cat /var/log/user-data.log | grep snapshot
```

Solution: Increase instance bandwidth or retry deployment

### High memory usage

This is normal during initial sync. Arbitrum Nitro requires significant memory for:
- State processing
- Transaction validation
- Block verification

Consider upgrading to m6i.4xlarge if memory is constrained.

## Arbitrum Nova Deployment

Arbitrum Nova is an AnyTrust chain designed for ultra-low transaction costs, ideal for gaming and social applications.

### Differences from Arbitrum One

- **Lower costs**: Uses AnyTrust for reduced data availability costs
- **Smaller state**: Requires less storage (~1TB vs 2TB for pruned nodes)
- **Lower instance requirements**: m6i.xlarge sufficient for most use cases
- **Same L1 endpoints**: Uses same Ethereum mainnet RPC/Beacon connections

### Deploy Arbitrum Nova

1. **Configure for Nova:**

```bash
cd lib/arbitrum
cp ./sample-configs/.env-arbitrum-nova-mainnet .env
nano .env  # Update AWS_ACCOUNT_ID
```

2. **Deploy stacks:**

```bash
# Deploy common stack
npx cdk deploy arbitrum-nova-common

# Deploy single node OR HA RPC nodes
npx cdk deploy arbitrum-nova-single-node
# OR
npx cdk deploy arbitrum-nova-rpc-nodes
```

### Nova Configuration Highlights

**Recommended instance**: m6i.xlarge (4 vCPUs, 16GB RAM)  
**Storage**: 1TB gp3 volume (sufficient for pruned node)  
**Cost**: ~$140/month for single node, ~$280/month for HA (2 nodes)

### Testing Nova Node

```bash
# Get instance ID (for single node)
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name arbitrum-nova-single-node --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)

aws ssm start-session --target $INSTANCE_ID

# Test RPC
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://localhost:8547

# Expected: {"jsonrpc":"2.0","id":1,"result":"0xa4ba"}  (42170 in hex - Nova chain ID)
```

### Clean Up Nova

```bash
npx cdk destroy arbitrum-nova-single-node  # or arbitrum-nova-rpc-nodes
npx cdk destroy arbitrum-nova-common
```

## Additional Resources

- [Arbitrum Documentation](https://docs.arbitrum.io/)
- [Nitro GitHub](https://github.com/OffchainLabs/nitro)
- [Official Snapshots](https://snapshot.arbitrum.io/)
- [Arbitrum One Explorer](https://arbiscan.io/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)

## Support

For issues specific to this blueprint:
- Open an issue in the [aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners/issues) repository

For Arbitrum-specific questions:
- Visit the [Arbitrum Discord](https://discord.gg/arbitrum)
- Check the [Arbitrum Forum](https://forum.arbitrum.foundation/)

## License

This sample code is made available under the MIT-0 license. See the LICENSE file.

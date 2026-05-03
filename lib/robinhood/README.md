# Sample AWS Blockchain Node Runner app for Robinhood Chain

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

> **⚠️ TESTNET ONLY**: This blueprint is for Robinhood Chain Sepolia testnet. Mainnet is not yet launched. This document will be updated with mainnet details when available.

## Architecture Overview

This blueprint deploys Robinhood Chain nodes on AWS using Arbitrum Orbit's Nitro stack. Robinhood Chain is an Arbitrum Orbit L2 built on Ethereum, designed for low-cost, high-performance trading and financial applications.

### Deployment Options

**1. Single Node Setup (`robinhood-single-node`)**

Ideal for development, testing, or personal use:
- Single EC2 instance running Arbitrum Nitro node in Docker
- EBS gp3 volume for blockchain data storage (1TB for testnet)
- Genesis sync from Ethereum Sepolia parent chain
- Security groups with VPC-only RPC/WS access
- CloudWatch monitoring with custom dashboards
- IAM roles with Systems Manager access (no SSH required)

**2. High Availability RPC Nodes (`robinhood-rpc-nodes`)**

Production-ready setup with load balancing:
- Multiple RPC nodes (2-4) behind Application Load Balancer
- Auto Scaling Group manages node lifecycle
- Each node syncs independently from genesis
- Health checks ensure only synced nodes receive traffic
- Automatic failover if a node becomes unhealthy
- VPC-only access with ALB distributing requests

**Key Features:**
- Uses Arbitrum Nitro Docker images from Offchain Labs
- Downloads Robinhood Chain testnet config automatically
- Connects to Ethereum Sepolia L1 (testnet parent chain)
- Secure RPC access restricted to VPC

## Prerequisites

### Required: Ethereum Sepolia L1 Endpoints

Robinhood Chain testnet requires connections to Ethereum Sepolia (not mainnet):
- **L1 RPC URL**: Ethereum Sepolia execution client endpoint
- **L1 Beacon URL**: Ethereum Sepolia consensus client beacon endpoint

**Options:**

1. **Free Public Endpoints** (testing/development):
   - [PublicNode.com](https://www.publicnode.com/) - Free, rate-limited
   - Sepolia RPC: `https://ethereum-sepolia-rpc.publicnode.com`
   - Sepolia Beacon: `https://ethereum-sepolia-beacon-api.publicnode.com`
   - ⚠️ Rate limits apply - suitable for testing, not production

2. **Paid Service Providers** (production):
   - [Alchemy](https://www.alchemy.com/) - Sepolia support
   - [Infura](https://www.infura.io/) - Sepolia support
   - [QuickNode](https://www.quicknode.com/) - Sepolia support
   - [Ankr](https://www.ankr.com/) - Sepolia support

3. **Self-Hosted** (most reliable):
   - Run your own Ethereum Sepolia node

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

### Configure Robinhood Chain node

Navigate to the Robinhood blueprint directory:

```bash
cd lib/robinhood
pwd
```

Create your configuration from the sample:

```bash
cp ./sample-configs/.env-robinhood-testnet .env
nano .env
```

**Required settings:**

```bash
AWS_ACCOUNT_ID="your-account-id"
AWS_REGION="us-east-1"

# IMPORTANT: These are Sepolia endpoints (testnet), not mainnet
L1_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
L1_BEACON_URL="https://ethereum-sepolia-beacon-api.publicnode.com"
```

**Optional settings:**
- `NITRO_VERSION`: Arbitrum Nitro version (check [releases](https://github.com/OffchainLabs/nitro/releases))
- `ROBINHOOD_SINGLE_NODE_INSTANCE_TYPE`: EC2 instance type (m6i.2xlarge recommended)
- `ROBINHOOD_SINGLE_NODE_DATA_VOL_SIZE`: Data volume size in GiB (1000 for testnet)

### Deploy Robinhood Chain node

1. Deploy common stack with IAM roles:

```bash
npx cdk deploy robinhood-common
```

2. Choose your deployment option:

**Option A: Single Node (for testing/development)**

```bash
npx cdk deploy robinhood-single-node
```

**Option B: HA RPC Nodes (for production testnet usage)**

```bash
npx cdk deploy robinhood-rpc-nodes
```

Deployment takes approximately:
- Stack creation: 5-10 minutes
- Initial genesis sync: 30-60 minutes

Total time to fully operational node: ~1 hour

For HA setup, nodes come online sequentially. The ALB health checks ensure only synced nodes receive traffic.

### Verify deployment

**For Single Node:**

Get the instance ID:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name robinhood-single-node --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)

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
ALB_URL=$(aws cloudformation describe-stacks --stack-name robinhood-rpc-nodes --query 'Stacks[0].Outputs[?OutputKey==`alb-url`].OutputValue' --output text)

echo $ALB_URL
```

### Test the node

**Single Node (from within the VPC or via Systems Manager):**

```bash
# Get node info
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://localhost:8547

# Expected response: {"jsonrpc":"2.0","id":1,"result":"0xb5f6"}  (46630 in hex - Robinhood Chain testnet)

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
3. Find `robinhood-single-node-<instance-id>` or `robinhood-rpc-nodes`

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
| m6i.xlarge   | 4     | 16 GiB  | Light testing | ~$140 |
| m6i.2xlarge  | 8     | 32 GiB  | Recommended | ~$280 |
| m6i.4xlarge  | 16    | 64 GiB  | High traffic | ~$560 |
| m7g.2xlarge  | 8     | 32 GiB  | Graviton (20% cheaper) | ~$224 |

*Estimated costs in US East (N. Virginia) including EBS storage

### Storage Requirements

- **Testnet Node**: 1TB (sufficient for current testnet state)
- **Future Mainnet**: TBD when launched

### Network Details (Testnet)

- **Chain ID**: 46630
- **Network Name**: Robinhood Chain Sepolia
- **Parent Chain**: Ethereum Sepolia (Chain ID: 11155111)
- **Sequencer**: https://sequencer.testnet.chain.robinhood.com
- **Data Feed**: wss://feed.testnet.chain.robinhood.com
- **Bridge Address**: 0x96295BDad104eaD97cC08797b3dC68efF59CcF30 (on Sepolia)
- **Config File**: https://cdn.robinhood.com/chain/testnet/robinhood-chain-testnet-config.json

## Clean Up

To avoid ongoing charges, delete the stacks in reverse order:

**If you deployed Single Node:**

```bash
# Delete node stack
npx cdk destroy robinhood-single-node

# Delete common stack
npx cdk destroy robinhood-common
```

**If you deployed HA RPC Nodes:**

```bash
# Delete RPC nodes stack
npx cdk destroy robinhood-rpc-nodes

# Delete common stack
npx cdk destroy robinhood-common
```

> **WARNING:** This permanently deletes your node data and all blockchain state.

## Troubleshooting

### Node not syncing

Check Docker logs:
```bash
sudo docker logs nitro --tail 100
```

Common issues:
- Invalid L1 RPC/Beacon URLs - verify Sepolia endpoints are accessible
- Insufficient disk space - increase volume size
- L1 endpoint rate limiting - use paid tier or run your own Sepolia node

### Config download failed

Check config file:
```bash
cat /data/nitro/robinhood-chain-testnet-config.json
```

Solution: Verify config URL is accessible:
```bash
wget https://cdn.robinhood.com/chain/testnet/robinhood-chain-testnet-config.json
```

### High memory usage

This is normal during initial sync. Arbitrum Nitro requires significant memory for:
- State processing
- Transaction validation
- Block verification

Consider upgrading to m6i.4xlarge if memory is constrained.

## Future Updates

> **📌 TODO**: This section will be updated when Robinhood Chain launches on mainnet with:
> - Mainnet configuration template
> - Ethereum mainnet L1 endpoints
> - Updated chain ID and contract addresses
> - Mainnet storage requirements
> - Production deployment best practices

## Additional Resources

- [Robinhood Chain Documentation](https://docs.robinhood.com/chain/)
- [Arbitrum Orbit Documentation](https://docs.arbitrum.io/launch-orbit-chain/orbit-gentle-introduction)
- [Arbitrum Nitro GitHub](https://github.com/OffchainLabs/nitro)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)

## Support

For issues specific to this blueprint:
- Open an issue in the [aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners/issues) repository

For Robinhood Chain-specific questions:
- Visit the [Robinhood Chain Documentation](https://docs.robinhood.com/chain/)

## License

This sample code is made available under the MIT-0 license. See the LICENSE file.

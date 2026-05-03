# Sample AWS Blockchain Node Runner app for Avalanche Nodes

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

## Architecture Overview

This blueprint provides three deployment options for Avalanche nodes on AWS:

### 1. Single Node (Development/Testing)
A standalone Avalanche node for development and testing:
- Single EC2 instance running AvalancheGo
- EBS gp3 volume for blockchain data (1TB default)
- CloudWatch monitoring
- Systems Manager access (no SSH required)

### 2. Sync Node (HA Foundation)
A dedicated node that maintains blockchain state and creates S3 snapshots:
- Single EC2 instance that syncs from genesis
- Automated daily snapshots to S3 using s5cmd
- Sync-checker monitoring (bootstrap status, peer count)
- Foundation for HA RPC deployment

### 3. HA RPC Nodes (Production)
High-availability setup with multiple nodes behind a load balancer:
- 2-4 EC2 instances in Auto Scaling Group
- Application Load Balancer for traffic distribution
- Fast startup by restoring from S3 snapshots (minutes vs days)
- Automatic scaling and self-healing
- Production-ready for high-traffic RPC workloads

![Architecture Diagram](https://via.placeholder.com/800x400?text=Avalanche+HA+Architecture)

**Security:** The HTTP API port (9650) is restricted to VPC CIDR for RPC access, while the P2P/staking port (9651) is open for network participation. Systems Manager Session Manager provides secure terminal access without SSH.

## Well-Architected

<details>
<summary>Review the pros and cons of this solution</summary>

### Well-Architected Checklist

| Pillar                  | Control                           | Question/Check                                                                   | Remarks          |
|:------------------------|:----------------------------------|:---------------------------------------------------------------------------------|:-----------------|
| Security                | Network protection                | Are there unnecessary open ports in security groups?                             | P2P/staking port (9651) is open for network participation. HTTP API (9650) is restricted to VPC only.  |
|                         | Compute protection                | Reduce attack surface                                                            | This solution uses Amazon Linux 2023 AMI. IAM roles follow least-privilege principle.  |
|                         |                                   | Enable people to perform actions at a distance                                   | This solution uses AWS Systems Manager for terminal session, not SSH ports.  |
|                         | Data protection at rest           | Use encrypted Amazon Elastic Block Store (Amazon EBS) volumes                    | This solution uses encrypted Amazon EBS gp3 volumes.  |
|                         |                                   | Use encrypted Amazon Simple Storage Service (Amazon S3) buckets                  | S3 snapshots (when enabled) use server-side encryption (SSE-S3).  |
|                         | Authorization and access control  | Use instance profile with Amazon Elastic Compute Cloud (Amazon EC2) instances    | This solution uses AWS IAM roles instead of IAM users.  |
|                         |                                   | Following principle of least privilege access                                    | Node runs as dedicated "avalanche" user, not root.  |
|                         | Application security              | Security focused development practices                                           | cdk-nag is used with appropriate suppressions.  |
| Cost optimization       | Service selection                 | Use cost effective resources                                                     | c6i instances provide good price-performance. Graviton (c7g) options available for ARM64.  |
|                         | Cost awareness                    | Estimate costs                                                                   | Single node: ~$250/month. HA setup (sync + 2 RPC nodes + ALB): ~$1,050/month. Graviton instances offer 20% cost savings. |
| Reliability             | Data backup                       | How is data backed up?                                                           | Optional S3 snapshots can be configured using s5cmd for faster node recovery.  |
|                         | Resource monitoring               | How are workload resources monitored?                                            | CloudWatch dashboards with CPU, disk, memory metrics via CloudWatch Agent.  |
| Performance efficiency  | Compute selection                 | How is compute solution selected?                                                | c6i/c7g instance families provide compute-optimized performance for Avalanche nodes.  |
|                         | Storage selection                 | How is storage solution selected?                                                | gp3 EBS volumes with 3000 IOPS provide balance of performance and cost.  |
| Operational excellence  | Workload health                   | How is health of workload determined?                                            | CloudWatch alarms, systemd service status checks, CloudFormation signals on deployment.  |
| Sustainability          | Hardware & services               | Select most efficient hardware for your workload                                 | AWS Graviton (c7g) instances offer best performance per watt of energy in EC2.  |

</details>

## Solution Walkthrough

### Prerequisites

- AWS account with permissions to create resources in IAM, EC2, EBS, VPC, S3, and CloudFormation
- AWS CLI configured with appropriate credentials
- Node.js 16+ and npm installed
- AWS CDK v2 installed (`npm install -g aws-cdk`)

### Open AWS CloudShell

From the AWS Management Console, open [AWS CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html), a web-based shell environment.

### Clone this repository and install dependencies

```bash
git clone https://github.com/aws-samples/aws-blockchain-node-runners.git
cd aws-blockchain-node-runners
npm install
```

### Prepare AWS account for deployment

1. Make sure you are in the root directory of the cloned repository

2. If you don't have a default VPC, create one:

```bash
aws ec2 create-default-vpc
```

> **NOTE:** You may see an error if the default VPC already exists - that's fine, continue with the next steps.

> **NOTE:** The default VPC must have at least one public subnet with "Auto-assign public IPv4 address" set to YES.

### Configure your Avalanche deployment

Navigate to the Avalanche blueprint directory:

```bash
cd lib/avalanche
pwd
```

Choose a sample configuration based on your deployment type:

**Option A: Single Node (Simple, No HA)**
```bash
cp ./sample-configs/.env-mainnet-x86 .env
nano .env
```

**Option B: HA Setup (Sync Node + RPC Nodes)**
```bash
cp ./sample-configs/.env-ha-rpc-mainnet .env
nano .env
# Set AVALANCHE_SNAPSHOT_TYPE="s3"
```

**Option C: Sync Node Only**
```bash
cp ./sample-configs/.env-sync-node-mainnet .env
nano .env
```

**For ARM64 (Graviton) - 20% cost savings:**
```bash
cp ./sample-configs/.env-mainnet-arm64 .env
nano .env
```

**For Fuji Testnet:**
```bash
cp ./sample-configs/.env-fuji-x86 .env
nano .env
```

Edit the `.env` file and configure:

**Required:**
- `AWS_ACCOUNT_ID`: Your AWS account ID
- `AWS_REGION`: Your target AWS region (e.g., us-east-1)

**Optional:**
- `AVALANCHEGO_VERSION`: AvalancheGo version (check [latest releases](https://github.com/ava-labs/avalanchego/releases))
- `AVALANCHE_SNAPSHOT_TYPE`: `"none"` for single node, `"s3"` for HA setup
- Instance types and storage sizes for each deployment type

### Deploy Avalanche Nodes

#### Option A: Single Node Deployment

1. Deploy common stack:
```bash
npx cdk deploy avalanche-common
```

2. Deploy single node:
```bash
npx cdk deploy avalanche-single-node
```

Deployment takes ~3-5 minutes. The node will sync from genesis (6-12 hours for mainnet).

#### Option B: HA Deployment (Production)

1. Deploy common stack with S3 bucket:
```bash
# Ensure AVALANCHE_SNAPSHOT_TYPE="s3" in .env
npx cdk deploy avalanche-common
```

2. Deploy sync node:
```bash
npx cdk deploy avalanche-sync-node
```

3. **Wait 24-48 hours** for sync node to complete mainnet sync and upload first snapshot to S3.

Monitor sync progress:
```bash
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name avalanche-sync-node-mainnet --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)
aws ssm start-session --target $INSTANCE_ID
sudo journalctl -u avalanchego -f
```

4. Once sync completes, deploy HA RPC nodes:
```bash
npx cdk deploy avalanche-rpc-nodes
```

RPC nodes will:
- Restore from S3 snapshot (fast startup in minutes)
- Join Auto Scaling Group and ALB
- Serve RPC traffic with high availability

Access RPC via ALB:
```bash
ALB_DNS=$(aws cloudformation describe-stacks --stack-name avalanche-rpc-nodes-mainnet --query 'Stacks[0].Outputs[?OutputKey==`alburl`].OutputValue' --output text)
curl -X POST --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeVersion"}' -H 'content-type:application/json;' $ALB_DNS/ext/info
```

### Verify deployment

After deployment completes, CDK will output the instance ID. Use Systems Manager to connect:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name avalanche-single-node-mainnet --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)

aws ssm start-session --target $INSTANCE_ID
```

Once connected, check the Avalanche service status:

```bash
sudo systemctl status avalanchego
sudo journalctl -u avalanchego -f
```

### Test the node

You can test the node using the provided test script (requires the public IP):

```bash
# Get the instance public IP
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name avalanche-single-node-mainnet --query 'Stacks[0].Outputs[?OutputKey==`nodeinstanceid`].OutputValue' --output text)
PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# Run the test script
./test-avalanche-node.sh $PUBLIC_IP
```

Or test manually with curl from within the VPC:

```bash
# Get node version
curl -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.getNodeVersion"
}' -H 'content-type:application/json;' http://localhost:9650/ext/info

# Check if node is bootstrapped
curl -X POST --data '{
    "jsonrpc":"2.0",
    "id"     :1,
    "method" :"info.isBootstrapped",
    "params": {"chain":"X"}
}' -H 'content-type:application/json;' http://localhost:9650/ext/info
```

> **NOTE:** Initial sync can take 6-12 hours for mainnet depending on network conditions and instance type.

### Monitor your node

View the CloudWatch dashboard:

1. Navigate to CloudWatch in AWS Console
2. Select "Dashboards" from the left menu
3. Find the dashboard named `avalanche-single-node-mainnet-<instance-id>`

View logs:

```bash
# Connect via Systems Manager
aws ssm start-session --target $INSTANCE_ID

# View live logs
sudo journalctl -u avalanchego -f

# Check specific time range
sudo journalctl -u avalanchego --since "1 hour ago"
```

## Configuration Reference

### Network Options

- `mainnet`: Avalanche mainnet (production)
- `fuji`: Fuji testnet (testing)

### Instance Type Recommendations

| Instance Type | vCPUs | Memory | Network | Use Case | Monthly Cost* |
|--------------|-------|---------|---------|----------|--------------|
| c6i.xlarge   | 4     | 8 GiB   | Up to 12.5 Gbps | Fuji testnet | ~$125 |
| c6i.2xlarge  | 8     | 16 GiB  | Up to 12.5 Gbps | Single node / RPC node | ~$245 |
| c7g.2xlarge  | 8     | 16 GiB  | Up to 15 Gbps | Single/RPC (Graviton, 20% cheaper) | ~$195 |
| c6i.4xlarge  | 16    | 32 GiB  | Up to 12.5 Gbps | Sync node / Validator | ~$490 |

*Estimated costs in US East (N. Virginia) including EBS storage

### Deployment Cost Comparison

| Deployment Type | Components | Monthly Cost (us-east-1)* |
|----------------|------------|--------------------------|
| Single Node | 1x c6i.2xlarge + 1TB storage | ~$245 |
| HA Setup | Sync node (c6i.4xlarge) + 2x RPC nodes (c6i.2xlarge) + ALB + S3 | ~$1,050 |

*Includes compute, storage, data transfer, and ALB costs

### Storage Requirements

- **Mainnet**: Minimum 1000 GiB (1 TB)
- **Fuji Testnet**: Minimum 500 GiB

### Architecture Types Supported

- **X86_64**: Intel/AMD instances (c6i, c5, m5, etc.)
- **ARM_64**: AWS Graviton instances (c7g, m7g, etc.) - 20% cost savings

## Clean Up

To avoid ongoing charges, delete the stacks:

**For Single Node:**
```bash
npx cdk destroy avalanche-single-node
npx cdk destroy avalanche-common
```

**For HA Setup:**
```bash
# Delete in reverse order
npx cdk destroy avalanche-rpc-nodes
npx cdk destroy avalanche-sync-node
npx cdk destroy avalanche-common

# Optionally delete S3 snapshots
aws s3 rm s3://avalanche-nodes-common-<account-id>-<region> --recursive
aws s3 rb s3://avalanche-nodes-common-<account-id>-<region>
```

> **WARNING:** This will permanently delete your node data and S3 snapshots. Backup important data before destroying.

## Troubleshooting

### Node not syncing

Check the logs:
```bash
sudo journalctl -u avalanchego -n 100
```

Common issues:
- P2P port (9651) not accessible - check security group rules
- Insufficient disk space - increase data volume size
- Network connectivity issues - verify VPC routing and NAT gateway

### Service failed to start

Check system logs:
```bash
sudo journalctl -u avalanchego -xe
cat /var/log/user-data.log
```

Common issues:
- AvalancheGo binary download failed - check internet connectivity
- Data volume not mounted - verify EBS volume attachment
- Incorrect network configuration - verify .env settings

### High CPU usage

This is normal during initial sync. Avalanche nodes require significant CPU for:
- State verification
- Signature validation
- P2P communication

Consider upgrading to c6i.4xlarge or c7g.4xlarge if sync is too slow.

## Additional Resources

- [Avalanche Documentation](https://docs.avax.network/)
- [AvalancheGo GitHub](https://github.com/ava-labs/avalanchego)
- [Avalanche Node Requirements](https://docs.avax.network/nodes/run/node-manually#hardware-and-os-requirements)
- [Detailed Deployment Guide](./DEPLOYMENT.md) - Comprehensive guide with monitoring and troubleshooting
- [AWS Blog: Run Ethereum Nodes on AWS](https://aws.amazon.com/blogs/web3/run-ethereum-nodes-on-aws/) - Similar HA architecture pattern
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)

## Support

For issues specific to this blueprint:
- Open an issue in the [aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners/issues) repository

For Avalanche-specific questions:
- Visit the [Avalanche Forum](https://forum.avax.network/)
- Join the [Avalanche Discord](https://chat.avax.network/)

## License

This sample code is made available under the MIT-0 license. See the LICENSE file.

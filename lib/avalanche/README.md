# Sample AWS Blockchain Node Runner app for Avalanche Nodes

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

## Architecture Overview

This blueprint deploys a single Avalanche node on AWS. The solution is designed for development, testing, and production use cases.

### Single Node Setup

The solution deploys:
- Single EC2 instance running AvalancheGo
- EBS gp3 volume for blockchain data storage (1TB default for mainnet)
- Security groups allowing P2P traffic (port 9651) and internal VPC access to HTTP API (port 9650)
- CloudWatch monitoring with custom dashboards
- IAM roles with Systems Manager access (no SSH required)
- Optional S3 bucket for data snapshots (future HA setup)

![Architecture Diagram](https://via.placeholder.com/800x400?text=Avalanche+Single+Node+Architecture)

The HTTP API port (9650) is restricted to the VPC CIDR range for security, while the P2P/staking port (9651) is open to enable network participation. Systems Manager Session Manager is used for secure terminal access instead of SSH.

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
|                         | Cost awareness                    | Estimate costs                                                                   | Single node with c6i.2xlarge (1TB gp3) costs ~$250-300/month in US East (N. Virginia). Graviton instances offer 20% cost savings. |
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

### Configure your Avalanche node

Navigate to the Avalanche blueprint directory and create your configuration:

```bash
cd lib/avalanche
pwd
```

Choose a sample configuration based on your needs:

**For Mainnet on x86_64 instances:**
```bash
cp ./sample-configs/.env-mainnet-x86 .env
nano .env
```

**For Mainnet on ARM64 (Graviton) instances (20% cost savings):**
```bash
cp ./sample-configs/.env-mainnet-arm64 .env
nano .env
```

**For Fuji Testnet:**
```bash
cp ./sample-configs/.env-fuji-x86 .env
nano .env
```

Edit the `.env` file and set at minimum:
- `AWS_ACCOUNT_ID`: Your AWS account ID
- `AWS_REGION`: Your target AWS region (e.g., us-east-1)

Optional configurations:
- `AVALANCHEGO_VERSION`: AvalancheGo version to deploy (check [latest releases](https://github.com/ava-labs/avalanchego/releases))
- `AVALANCHE_SINGLE_NODE_INSTANCE_TYPE`: EC2 instance type (c6i.2xlarge, c7g.2xlarge, etc.)
- `AVALANCHE_SINGLE_NODE_DATA_VOL_SIZE`: Data volume size in GiB (1000 for mainnet, 500 for Fuji)

### Deploy the Avalanche node

1. Deploy common stack with IAM roles and optional S3 bucket:

```bash
npx cdk deploy avalanche-common
```

2. Deploy the single Avalanche node:

```bash
npx cdk deploy avalanche-single-node
```

The deployment will take approximately 10-15 minutes. CloudFormation will provision:
- EC2 instance with Amazon Linux 2023
- Encrypted EBS gp3 data volume
- Security groups
- CloudWatch monitoring and dashboard
- IAM roles for Systems Manager access

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
| c6i.2xlarge  | 8     | 16 GiB  | Up to 12.5 Gbps | Mainnet | ~$250 |
| c7g.2xlarge  | 8     | 16 GiB  | Up to 15 Gbps | Mainnet (Graviton, 20% cheaper) | ~$200 |
| c6i.4xlarge  | 16    | 32 GiB  | Up to 12.5 Gbps | Validator | ~$500 |

*Estimated costs in US East (N. Virginia) including EBS storage

### Storage Requirements

- **Mainnet**: Minimum 1000 GiB (1 TB)
- **Fuji Testnet**: Minimum 500 GiB

### Architecture Types Supported

- **X86_64**: Intel/AMD instances (c6i, c5, m5, etc.)
- **ARM_64**: AWS Graviton instances (c7g, m7g, etc.) - 20% cost savings

## Clean Up

To avoid ongoing charges, delete the stacks:

```bash
# Delete the node stack first
npx cdk destroy avalanche-single-node

# Then delete the common stack
npx cdk destroy avalanche-common
```

> **WARNING:** This will permanently delete your node data. Backup important data before destroying.

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

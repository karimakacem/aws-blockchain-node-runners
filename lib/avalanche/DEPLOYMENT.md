# Avalanche Node Runner Deployment Guide

## Architecture Overview

The Avalanche node runner supports three deployment patterns:

### 1. Single Node (Development/Testing)
- Single EC2 instance
- Syncs from genesis or state-sync
- No high availability
- Simple setup for testing

### 2. Sync Node (HA Foundation)
- Dedicated node that maintains full blockchain sync
- Uploads daily snapshots to S3 using s5cmd
- Automatic cron job for snapshot updates
- Required for HA RPC deployment

### 3. HA RPC Nodes (Production)
- 2-4 nodes behind Application Load Balancer
- Auto Scaling Group for high availability
- Fast startup by restoring from S3 snapshots
- Lifecycle hooks ensure nodes are synced before joining ALB

## Deployment Steps

### Prerequisites
```bash
cd lib/avalanche
npm install
```

### Option A: Single Node Deployment
```bash
# 1. Configure
cp sample-configs/.env-mainnet-x86 .env
# Edit .env: Set AWS_ACCOUNT_ID and AWS_REGION

# 2. Deploy
cdk deploy avalanche-common
cdk deploy avalanche-single-node

# 3. Access
INSTANCE_ID=$(aws cloudformation describe-stack-resources --stack-name avalanche-single-node-mainnet --logical-resource-id avalanchenodesinglenodeBD8ADA2B --query 'StackResources[0].PhysicalResourceId' --output text)
aws ssm start-session --target $INSTANCE_ID
```

### Option B: HA Production Deployment
```bash
# 1. Configure for S3 snapshots
cp sample-configs/.env-ha-rpc-mainnet .env
# Edit .env: Set AWS_ACCOUNT_ID, AWS_REGION, and AVALANCHE_SNAPSHOT_TYPE="s3"

# 2. Deploy common resources (S3 bucket, IAM roles)
cdk deploy avalanche-common

# 3. Deploy sync node
cdk deploy avalanche-sync-node

# Wait 24-48 hours for initial sync to complete
# Monitor: aws logs tail /var/log/avalanche --follow
# Check sync status: watch 'bash /tmp/monitor-avalanche-sync.sh'

# 4. Verify first snapshot uploaded to S3
aws s3 ls s3://avalanche-nodes-common-<account-id>-<region>/data/ --recursive

# 5. Deploy HA RPC nodes (fast startup from snapshot)
cdk deploy avalanche-rpc-nodes

# 6. Access via ALB
ALB_DNS=$(aws cloudformation describe-stacks --stack-name avalanche-rpc-nodes-mainnet --query 'Stacks[0].Outputs[?OutputKey==`alburl`].OutputValue' --output text)
curl -X POST --data '{"jsonrpc":"2.0","id":1,"method":"info.getNetworkID"}' -H 'content-type:application/json;' $ALB_DNS/ext/info
```

## Monitoring

### Check Sync Node Progress
```bash
# View logs
aws logs tail /var/log/avalanche --follow

# Check bootstrap status
INSTANCE_ID=<sync-node-instance-id>
aws ssm start-session --target $INSTANCE_ID
sudo tail -f /var/log/avalanche/syncchecker.log

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AvalancheNode \
  --metric-name x_chain_bootstrapped \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 900 \
  --statistics Average
```

### Check S3 Snapshots
```bash
# List snapshots
aws s3 ls s3://avalanche-nodes-common-<account-id>-<region>/data/ --recursive --human-readable

# Check snapshot size
aws s3 ls s3://avalanche-nodes-common-<account-id>-<region>/data/ --recursive --summarize
```

### Check HA RPC Nodes
```bash
# View ALB health
aws elbv2 describe-target-health --target-group-arn <tg-arn>

# Check Auto Scaling Group
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names avalanche-rpc-nodes-mainnet

# Test RPC endpoint
ALB_DNS=<your-alb-dns>
curl -X POST --data '{"jsonrpc":"2.0","id":1,"method":"info.isBootstrapped","params":{"chain":"X"}}' -H 'content-type:application/json;' http://$ALB_DNS:9650/ext/info
```

## Configuration Reference

### Instance Sizing Recommendations

| Deployment Type | Instance Type | vCPUs | RAM | Data Volume | Notes |
|----------------|---------------|-------|-----|-------------|-------|
| Sync Node (Mainnet) | c6i.4xlarge | 16 | 32GB | 2000GB | Handles full sync + snapshot uploads |
| RPC Node (Mainnet) | c6i.2xlarge | 8 | 16GB | 1500GB | Restores from snapshot |
| Single Node (Mainnet) | c6i.2xlarge | 8 | 16GB | 1000GB | Development/testing |
| Fuji Testnet | c6i.xlarge | 4 | 8GB | 500GB | Smaller for testnet |

### Key Configuration Parameters

```bash
# Network
AVALANCHE_NETWORK="mainnet"          # or "fuji"
AVALANCHEGO_VERSION="v1.14.2"        # Latest stable

# Snapshot Strategy
AVALANCHE_SNAPSHOT_TYPE="s3"         # Required for HA
# or
AVALANCHE_SNAPSHOT_TYPE="none"       # For single node

# HA Configuration
AVALANCHE_RPC_NUMBER_OF_NODES="2"                     # 2-4 recommended
AVALANCHE_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN="15"   # Time to download snapshot
AVALANCHE_RPC_HA_NODES_HEARTBEAT_DELAY_MIN="180"      # ASG lifecycle hook timeout (3 hours)
```

## Cleanup

```bash
# Destroy HA setup
cdk destroy avalanche-rpc-nodes
cdk destroy avalanche-sync-node
cdk destroy avalanche-common

# Or single node
cdk destroy avalanche-single-node
cdk destroy avalanche-common
```

**Note:** S3 bucket with snapshots will be retained by default. Delete manually if needed:
```bash
aws s3 rm s3://avalanche-nodes-common-<account-id>-<region> --recursive
aws s3 rb s3://avalanche-nodes-common-<account-id>-<region>
```

## Troubleshooting

### Sync Node Not Taking Snapshot
- Check `/var/log/avalanche/syncchecker.log`
- Verify all chains are bootstrapped: `sudo journalctl -u avalanchego -f`
- Ensure S3 permissions: `aws s3 ls s3://avalanche-nodes-common-<account-id>-<region>/`

### RPC Nodes Not Starting
- Check ASG lifecycle hooks: `aws autoscaling describe-lifecycle-hooks`
- View instance console output for errors
- Verify snapshot exists in S3 before deploying RPC nodes

### ALB Health Checks Failing
- Increase `AVALANCHE_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN`
- Check security group allows ALB -> instances on port 9650
- Verify AvalancheGo service is running: `systemctl status avalanchego`

## Cost Estimation

| Component | Monthly Cost (us-east-1) |
|-----------|-------------------------|
| Sync Node (c6i.4xlarge) | ~$490/month |
| RPC Node x2 (c6i.2xlarge) | ~$490/month |
| ALB | ~$22/month |
| S3 Storage (2TB snapshot) | ~$46/month |
| **Total HA Setup** | **~$1,048/month** |

Single node (c6i.2xlarge): ~$245/month

## Support

- Avalanche Documentation: https://docs.avax.network/
- AvalancheGo Releases: https://github.com/ava-labs/avalanchego/releases
- AWS Blockchain Node Runners: https://github.com/aws-samples/aws-blockchain-node-runners

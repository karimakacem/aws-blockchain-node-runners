import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as nag from "cdk-nag";
import { SingleNodeConstruct } from "../../constructs/single-node";
import * as configTypes from "./config/robinhood-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";

export interface RobinhoodSingleNodeStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    network: configTypes.RobinhoodNetwork;
    nitroVersion: string;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
    chainId: number;
    sequencerUrl: string;
    feedUrl: string;
}

export class RobinhoodSingleNodeStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: RobinhoodSingleNodeStackProps) {
        super(scope, id, props);

        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const availabilityZones = cdk.Stack.of(this).availabilityZones;
        const chosenAvailabilityZone = availabilityZones.slice(0, 1)[0];

        const {
            instanceType,
            instanceCpuType,
            network,
            nitroVersion,
            l1RpcUrl,
            l1BeaconUrl,
            dataVolume,
            rpcPort,
            wsPort,
            metricsPort,
            chainId,
            sequencerUrl,
            feedUrl,
        } = props;

        // Validate L1 endpoints (Sepolia required for testnet)
        if (!l1RpcUrl || l1RpcUrl === "") {
            throw new Error("L1_RPC_URL is required. Please provide an Ethereum Sepolia RPC endpoint.");
        }
        if (!l1BeaconUrl || l1BeaconUrl === "") {
            throw new Error("L1_BEACON_URL is required. Please provide an Ethereum Sepolia beacon chain endpoint.");
        }

        const vpc = ec2.Vpc.fromLookup(this, "vpc", {
            isDefault: true,
        });

        // Security group for Robinhood Chain node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Robinhood Chain Node",
            allowAllOutbound: true,
        });

        // Allow RPC access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(rpcPort),
            "Robinhood Chain RPC"
        );

        // Allow WebSocket access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(wsPort),
            "Robinhood Chain WebSocket"
        );

        // Allow metrics access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(metricsPort),
            "Robinhood Chain Metrics"
        );

        // Get IAM role from common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("RobinhoodNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Get assets info from common stack
        const assetsBucket = cdk.Fn.importValue(`RobinhoodAssetsBucket`);
        const assetsKey = cdk.Fn.importValue(`RobinhoodAssetsKey`);

        // Use Amazon Linux 2023 image
        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        const node = new SingleNodeConstruct(this, "robinhood-node", {
            instanceName: STACK_NAME,
            instanceType,
            dataVolumes: [dataVolume],
            rootDataVolumeDeviceName: "/dev/xvda",
            machineImage,
            vpc,
            availabilityZone: chosenAvailabilityZone,
            role: instanceRole,
            securityGroup: instanceSG,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
        });

        // Override creation policy timeout for genesis sync (testnet takes 2-3 hours)
        const cfnInstance = node.instance.node.defaultChild as ec2.CfnInstance;
        cfnInstance.cfnOptions.creationPolicy = {
            resourceSignal: {
                count: 1,
                timeout: "PT180M",  // 180 minutes (3 hours) for genesis sync from Sepolia
            },
        };

        // User data for Robinhood Chain setup
        node.instance.addUserData(
            '#!/bin/bash',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Robinhood Chain node setup..."',
            '',
            '# Install required packages',
            'dnf install -y docker wget jq amazon-cloudwatch-agent aws-cfn-bootstrap unzip',
            'systemctl enable docker',
            'systemctl start docker',
            '',
            '# Wait for and mount data volume',
            'DEVICE=""',
            'for i in {1..30}; do',
            '  if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; break; fi',
            '  if [ -e /dev/xvdf ]; then DEVICE="/dev/xvdf"; break; fi',
            '  sleep 10',
            'done',
            '[ -z "$DEVICE" ] && echo "ERROR: data volume not found" && exit 1',
            'if ! blkid $DEVICE; then mkfs -t ext4 $DEVICE; fi',
            'mkdir -p /data',
            'mount $DEVICE /data',
            'echo "$DEVICE /data ext4 defaults,nofail 0 2" >> /etc/fstab',
            '',
            '# Create directories on mounted volume',
            'mkdir -p /data/nitro',
            '',
            '# Download Robinhood Chain config onto mounted volume',
            `echo "Downloading Robinhood Chain testnet config..."`,
            'wget -O /data/nitro/robinhood-chain-testnet-config.json https://cdn.robinhood.com/chain/testnet/robinhood-chain-testnet-config.json',
            '',
            '# Pull Nitro Docker image',
            `echo "Pulling Nitro ${nitroVersion}..."`,
            `docker pull offchainlabs/nitro-node:${nitroVersion}`,
            '',
            '# Create systemd service',
            'cat > /etc/systemd/system/nitro.service << EOF',
            '[Unit]',
            'Description=Robinhood Chain Nitro Node',
            'After=docker.service',
            'Requires=docker.service',
            '',
            '[Service]',
            'Type=simple',
            'Restart=always',
            'RestartSec=30',
            'TimeoutStartSec=0',
            `ExecStart=/usr/bin/docker run --rm --name nitro \\`,
            '  -v /data/nitro:/data \\',
            `  -p ${rpcPort}:${rpcPort} \\`,
            `  -p ${wsPort}:${wsPort} \\`,
            `  -p ${metricsPort}:${metricsPort} \\`,
            `  offchainlabs/nitro-node:${nitroVersion} \\`,
            '  --conf.file /data/robinhood-chain-testnet-config.json \\',
            '  --persistent.chain /data \\',
            `  --parent-chain.connection.url ${l1RpcUrl} \\`,
            `  --parent-chain.blob-client.beacon-url ${l1BeaconUrl} \\`,
            '  --node.staker.enable=false \\',
            '  --http.addr 0.0.0.0 \\',
            `  --http.port ${rpcPort} \\`,
            '  --http.vhosts=* \\',
            '  --http.corsdomain=* \\',
            '  --http.api=eth,net,web3,arb \\',
            '  --ws.addr 0.0.0.0 \\',
            `  --ws.port ${wsPort} \\`,
            '  --ws.origins=* \\',
            '  --ws.api=eth,net,web3,arb \\',
            '  --metrics \\',
            '  --metrics-server.addr 0.0.0.0 \\',
            `  --metrics-server.port ${metricsPort} \\`,
            '  --log-level info',
            'ExecStop=/usr/bin/docker stop nitro',
            '',
            '[Install]',
            'WantedBy=multi-user.target',
            'EOF',
            '',
            '# Start service',
            'systemctl daemon-reload',
            'systemctl enable nitro',
            'systemctl start nitro',
            '',
            '# Wait for nitro to become active (Docker pull + startup can take several minutes)',
            'RETRIES=40',
            'COUNT=0',
            'while [ $COUNT -lt $RETRIES ]; do',
            '  STATUS=$(systemctl is-active nitro 2>/dev/null)',
            '  if [ "$STATUS" = "active" ]; then break; fi',
            '  if [ "$STATUS" = "failed" ]; then break; fi',
            '  COUNT=$((COUNT + 1))',
            '  echo "Waiting for nitro service... ($COUNT/$RETRIES) status=$STATUS"',
            '  sleep 15',
            'done',
            '',
            '# Signal CloudFormation',
            'if [ "$(systemctl is-active nitro)" = "active" ]; then',
            `  cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success true`,
            '  echo "✓ Setup complete"',
            'else',
            '  journalctl -u nitro -n 20 --no-pager',
            `  cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success false`,
            '  echo "✗ Service failed"',
            'fi'
        );

        // CloudWatch Dashboard
        new cw.CfnDashboard(this, 'robinhood-dashboard', {
            dashboardName: `${STACK_NAME}-${node.instanceId}`,
            dashboardBody: JSON.stringify({
                widgets: [
                    {
                        type: "metric",
                        properties: {
                            metrics: [
                                ["AWS/EC2", "CPUUtilization", { stat: "Average", label: "CPU Average" }],
                            ],
                            view: "timeSeries",
                            region: REGION,
                            title: "EC2 CPU Utilization",
                            period: 300,
                        }
                    },
                ]
            })
        });

        // Outputs
        new cdk.CfnOutput(this, "node-instance-id", {
            value: node.instanceId,
        });

        // Suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-EC28",
                    reason: "Using basic monitoring to save costs",
                },
                {
                    id: "AwsSolutions-EC29",
                    reason: "Termination protection not required for development node",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Security group restricted to VPC CIDR range",
                },
            ],
            true
        );
    }
}

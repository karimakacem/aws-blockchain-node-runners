import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as nag from "cdk-nag";
import { SingleNodeConstruct } from "../../constructs/single-node";
import * as configTypes from "./config/arbitrum-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";

export interface ArbitrumNovaSingleNodeStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    network: configTypes.ArbitrumNetwork;
    nitroVersion: string;
    snapshotType: configTypes.ArbitrumSnapshotType;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
}

export class ArbitrumNovaSingleNodeStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: ArbitrumNovaSingleNodeStackProps) {
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
            snapshotType,
            l1RpcUrl,
            l1BeaconUrl,
            dataVolume,
            rpcPort,
            wsPort,
            metricsPort,
        } = props;

        // Validate L1 endpoints
        if (!l1RpcUrl || l1RpcUrl === "") {
            throw new Error("L1_RPC_URL is required. Please provide an Ethereum mainnet RPC endpoint.");
        }
        if (!l1BeaconUrl || l1BeaconUrl === "") {
            throw new Error("L1_BEACON_URL is required. Please provide an Ethereum beacon chain endpoint.");
        }

        // Validate network is Nova
        if (network !== "nova") {
            throw new Error(`This stack is for Arbitrum Nova. Network '${network}' is not supported.`);
        }

        const vpc = ec2.Vpc.fromLookup(this, "vpc", {
            isDefault: true,
        });

        // Security group for Arbitrum Nova node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Arbitrum Nova Node",
            allowAllOutbound: true,
        });

        // Allow RPC access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(rpcPort),
            "Arbitrum Nova RPC"
        );

        // Allow WebSocket access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(wsPort),
            "Arbitrum Nova WebSocket"
        );

        // Allow metrics access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(metricsPort),
            "Arbitrum Nova Metrics"
        );

        // Get IAM role from common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("ArbitrumNovaNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Get assets info from common stack
        const assetsBucket = cdk.Fn.importValue(`ArbitrumNovaAssetsBucket`);
        const assetsKey = cdk.Fn.importValue(`ArbitrumNovaAssetsKey`);

        // Use Amazon Linux 2023 image
        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        const node = new SingleNodeConstruct(this, "arbitrum-nova-node", {
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
            skipVolumeAttachment: true,
        });

        // Get the volume ID for manual attachment in user-data
        const dataVolumeId = (node.node.findChild('data-volume-1').node.defaultChild as ec2.CfnVolume).ref;

        // Override creation policy timeout for snapshot download (30-90 minutes)
        const cfnInstance = node.instance.node.defaultChild as ec2.CfnInstance;
        cfnInstance.cfnOptions.creationPolicy = {
            resourceSignal: {
                count: 1,
                timeout: "PT90M",  // 90 minutes for snapshot download + sync
            },
        };

        // User data for Arbitrum Nova setup
        node.instance.addUserData(
            '#!/bin/bash',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Arbitrum Nova node setup..."',
            '',
            '# Install required packages',
            'dnf install -y docker wget jq amazon-cloudwatch-agent aws-cfn-bootstrap unzip',
            'systemctl enable docker',
            'systemctl start docker',
            '',
            '# Attach and mount data volume',
            `VOLUME_ID="${dataVolumeId}"`,
            'INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)',
            `aws ec2 attach-volume --region ${REGION} --volume-id $VOLUME_ID --instance-id $INSTANCE_ID --device /dev/sdf`,
            'DEVICE=""',
            'for i in {1..30}; do',
            '  if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; break; fi',
            '  if [ -e /dev/xvdf ]; then DEVICE="/dev/xvdf"; break; fi',
            '  sleep 10',
            'done',
            '[ -z "$DEVICE" ] && echo "ERROR: data volume not found after 5 minutes" && exit 1',
            'echo "Found data volume: $DEVICE"',
            'if ! blkid $DEVICE; then mkfs -t ext4 $DEVICE; fi',
            'mkdir -p /data',
            'mount $DEVICE /data',
            'echo "$DEVICE /data ext4 defaults,nofail 0 2" >> /etc/fstab',
            '',
            '# Create directories on mounted volume',
            'mkdir -p /data/nitro /opt/arbitrum/scripts',
            'chmod 777 /data/nitro',
            '',
            '# Download assets',
            `aws s3 cp s3://${assetsBucket}/${assetsKey} /tmp/assets.zip`,
            'cd /tmp && unzip -q assets.zip',
            'cp scripts/*.sh /opt/arbitrum/scripts/',
            'chmod +x /opt/arbitrum/scripts/*.sh',
            '',
            '# Download snapshot if requested',
            snapshotType !== "none" ? `echo "Downloading ${snapshotType} snapshot..."` : 'echo "Skipping snapshot download"',
            snapshotType !== "none" ? `/opt/arbitrum/scripts/download-snapshot.sh ${network} ${snapshotType} /data/nitro` : '',
            '',
            '# Pull Nitro Docker image',
            `echo "Pulling Nitro ${nitroVersion}..."`,
            `docker pull offchainlabs/nitro-node:${nitroVersion}`,
            '',
            '# Create systemd service',
            'cat > /etc/systemd/system/nitro.service << EOF',
            '[Unit]',
            'Description=Arbitrum Nitro Node (Nova)',
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
            '  --persistent.chain /data \\',
            '  --persistent.global-config /data \\',
            `  --parent-chain.connection.url ${l1RpcUrl} \\`,
            `  --parent-chain.blob-client.beacon-url ${l1BeaconUrl} \\`,
            `  --chain.name ${network} \\`,
            '  --node.staker.enable=false \\',
            '  --http.addr 0.0.0.0 \\',
            `  --http.port ${rpcPort} \\`,
            '  --http.vhosts=* \\',
            '  --http.corsdomain=* \\',
            '  --http.rpcprefix=/ \\',
            '  --ws.addr 0.0.0.0 \\',
            `  --ws.port ${wsPort} \\`,
            '  --ws.origins=* \\',
            '  --ws.rpcprefix=/ \\',
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
        new cw.CfnDashboard(this, 'arbitrum-nova-dashboard', {
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

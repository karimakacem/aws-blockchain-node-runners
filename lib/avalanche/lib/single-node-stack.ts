import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as path from "path";
import * as fs from "fs";
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as nag from "cdk-nag";
import { SingleNodeConstruct } from "../../constructs/single-node"
import * as configTypes from "./config/avalanche-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";
import * as constants from "../../constructs/constants";

export interface AvalancheSingleNodeStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    avalancheNetwork: configTypes.AvalancheNetwork;
    avalanchegoVersion: string;
    nodeType: configTypes.AvalancheNodeType;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    httpPort: number;
    stakingPort: number;
}

export class AvalancheSingleNodeStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: AvalancheSingleNodeStackProps) {
        super(scope, id, props);

        // Setting up necessary environment variables
        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const STACK_ID = cdk.Stack.of(this).stackId;
        const availabilityZones = cdk.Stack.of(this).availabilityZones;
        const chosenAvailabilityZone = availabilityZones.slice(0, 1)[0];

        // Getting our config from initialization properties
        const {
            instanceType,
            instanceCpuType,
            avalancheNetwork,
            avalanchegoVersion,
            nodeType,
            dataVolume,
            httpPort,
            stakingPort,
        } = props;

        // Using default VPC
        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Setting up the security group for the node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security group for Avalanche node",
            allowAllOutbound: true,
        });

        // P2P staking port
        instanceSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(stakingPort),
            "Avalanche P2P/Staking"
        );

        // HTTP API port - restricted to VPC only for security
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(httpPort),
            "Avalanche HTTP API (VPC only)"
        );

        // Making our scripts and configs from the local "assets" directory available for instance to download
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // Getting the IAM role ARN from the common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("AvalancheNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Making sure our instance will be able to read the assets
        asset.bucket.grantRead(instanceRole);

        // Use Amazon Linux 2023 image
        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        const node = new SingleNodeConstruct(this, "avalanche-node", {
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
            skipVolumeAttachment: true, // We handle volume attachment manually in user-data
        });

        // Create user data directly with values
        node.instance.addUserData(
            '#!/bin/bash',
            'set -e',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Avalanche node setup..."',
            '',
            '# Install required packages',
            'yum install -y wget jq amazon-cloudwatch-agent',
            '',
            '# Create avalanche user',
            'useradd -r -s /bin/false avalanche || true',
            'mkdir -p /opt/avalanche /var/lib/avalanche /var/log/avalanche',
            'chown avalanche:avalanche /var/lib/avalanche /var/log/avalanche',
            '',
            '# Attach and detect data volume',
            'echo "Attaching data volume..."',
            `VOLUME_ID="${node.node.tryFindChild('data-volume-1')?.node.defaultChild ? (node.node.tryFindChild('data-volume-1')!.node.defaultChild as ec2.CfnVolume).ref : 'unknown'}"`,
            `INSTANCE_ID=$(ec2-metadata --instance-id | cut -d ' ' -f 2)`,
            'echo "Volume ID: $VOLUME_ID, Instance ID: $INSTANCE_ID"',
            `if aws ec2 attach-volume --region ${REGION} --volume-id \${VOLUME_ID} --instance-id \${INSTANCE_ID} --device /dev/sdf; then`,
            '  echo "Volume attachment initiated successfully"',
            'else',
            '  echo "ERROR: Failed to attach volume"',
            '  exit 1',
            'fi',
            '',
            'echo "Waiting for volume to appear..."',
            'DEVICE=""',
            'for i in {1..30}; do',
            '  echo "Attempt $i: Checking for devices..."',
            '  ls -la /dev/nvme* /dev/xvd* 2>&1 || true',
            '  if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; echo "Found at /dev/nvme1n1"; break; fi',
            '  if [ -e /dev/xvdf ]; then DEVICE="/dev/xvdf"; echo "Found at /dev/xvdf"; break; fi',
            '  sleep 10',
            'done',
            '',
            'if [ -z "$DEVICE" ]; then',
            '  echo "ERROR: Data volume not found after 5 minutes"',
            '  echo "Final device list:"',
            '  ls -la /dev/nvme* /dev/xvd* 2>&1 || true',
            '  exit 1',
            'fi',
            'echo "Found data volume at $DEVICE"',
            '',
            'if ! blkid $DEVICE; then mkfs -t ext4 $DEVICE; fi',
            'mkdir -p /var/lib/avalanche/data',
            'mount $DEVICE /var/lib/avalanche/data',
            'chown -R avalanche:avalanche /var/lib/avalanche/data',
            'echo "$DEVICE /var/lib/avalanche/data ext4 defaults,nofail 0 2" >> /etc/fstab',
            '',
            '# Download AvalancheGo',
            `echo "Downloading AvalancheGo ${avalanchegoVersion}..."`,
            'cd /opt/avalanche',
            'ARCH=$(uname -m)',
            'if [ "$ARCH" = "aarch64" ]; then AVALANCHE_ARCH="arm64"; else AVALANCHE_ARCH="amd64"; fi',
            `wget -q "https://github.com/ava-labs/avalanchego/releases/download/${avalanchegoVersion}/avalanchego-linux-\${AVALANCHE_ARCH}-${avalanchegoVersion}.tar.gz"`,
            `tar -xzf "avalanchego-linux-\${AVALANCHE_ARCH}-${avalanchegoVersion}.tar.gz"`,
            `mv "avalanchego-${avalanchegoVersion}" current`,
            'chmod +x current/avalanchego',
            'chown -R avalanche:avalanche /opt/avalanche',
            '/opt/avalanche/current/avalanchego --version || exit 1',
            '',
            '# Create systemd service',
            `NETWORK_FLAG="${avalancheNetwork !== 'mainnet' ? `--network-id=${avalancheNetwork}` : ''}"`,
            'cat > /etc/systemd/system/avalanchego.service << EOF',
            '[Unit]',
            'Description=AvalancheGo Node',
            'After=network.target',
            '',
            '[Service]',
            'Type=simple',
            'User=avalanche',
            'Group=avalanche',
            'WorkingDirectory=/var/lib/avalanche',
            'ExecStart=/opt/avalanche/current/avalanchego \\',
            '  --data-dir=/var/lib/avalanche/data \\',
            '  --log-dir=/var/log/avalanche \\',
            '  --http-host=0.0.0.0 \\',
            `  --http-port=${httpPort} \\`,
            `  --staking-port=${stakingPort} \\`,
            '  --public-ip-resolution-service=opendns \\',
            '  --log-level=info \\',
            '  $NETWORK_FLAG',
            'Restart=always',
            'RestartSec=30',
            'StandardOutput=journal',
            'StandardError=journal',
            '',
            '[Install]',
            'WantedBy=multi-user.target',
            'EOF',
            '',
            '# Start service',
            'systemctl daemon-reload',
            'systemctl enable avalanchego',
            'systemctl start avalanchego',
            'sleep 15',
            '',
            '# Signal CloudFormation',
            'if systemctl is-active --quiet avalanchego; then',
            `  /opt/aws/bin/cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success true`,
            '  echo "✓ Setup complete"',
            'else',
            `  /opt/aws/bin/cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success false`,
            '  echo "✗ Service failed"',
            '  exit 1',
            'fi'
        );

        // Adding CloudWatch dashboard
        const dashboardBody = {
            widgets: [
                {
                    type: "metric",
                    properties: {
                        metrics: [
                            ["AWS/EC2", "CPUUtilization", { stat: "Average", label: "CPU Average" }],
                            ["...", { stat: "Maximum", label: "CPU Maximum" }]
                        ],
                        view: "timeSeries",
                        region: REGION,
                        title: "EC2 CPU Utilization",
                        period: 300,
                        yAxis: { left: { min: 0, max: 100 } }
                    }
                },
                {
                    type: "metric",
                    properties: {
                        metrics: [
                            ["CWAgent", "disk_used_percent", { stat: "Average" }]
                        ],
                        view: "timeSeries",
                        region: REGION,
                        title: "Disk Usage",
                        period: 300
                    }
                }
            ]
        };

        new cw.CfnDashboard(this, 'avalanche-cw-dashboard', {
            dashboardName: `${STACK_NAME}-${node.instanceId}`,
            dashboardBody: JSON.stringify(dashboardBody),
        });

        new cdk.CfnOutput(this, "node-instance-id", {
            value: node.instanceId,
            description: "Avalanche node instance ID",
        });

        new cdk.CfnOutput(this, "node-instance-role-arn", {
            value: instanceRole.roleArn,
            description: "IAM role ARN for the instance",
        });

        // Adding suppressions to the stack
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Need read access to the S3 bucket with assets",
                },
                {
                    id: "AwsSolutions-EC29",
                    reason: "Single node setup doesn't require ASG",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Avalanche P2P/staking port needs to be publicly accessible for network participation",
                },
            ],
            true
        );
    }
}

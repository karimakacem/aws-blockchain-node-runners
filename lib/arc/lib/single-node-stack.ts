import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as nag from "cdk-nag";
import { SingleNodeConstruct } from "../../constructs/single-node";
import * as configTypes from "./config/arc-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";

export interface ArcSingleNodeStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    network: configTypes.ArcNetwork;
    arcVersion: string;
    snapshotDownload: boolean;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    executionRpcPort: number;
    executionWsPort: number;
    executionMetricsPort: number;
    consensusRpcPort: number;
    consensusMetricsPort: number;
}

export class ArcSingleNodeStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: ArcSingleNodeStackProps) {
        super(scope, id, props);

        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const availabilityZones = cdk.Stack.of(this).availabilityZones;
        const chosenAvailabilityZone = availabilityZones.slice(0, 1)[0];

        const {
            instanceType,
            instanceCpuType,
            network,
            arcVersion,
            snapshotDownload,
            dataVolume,
            executionRpcPort,
            executionWsPort,
            executionMetricsPort,
            consensusRpcPort,
            consensusMetricsPort,
        } = props;

        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Security group
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security group for Circle ARC node",
            allowAllOutbound: true,
        });

        // Execution layer RPC - VPC only
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionRpcPort),
            "ARC Execution RPC (VPC only)"
        );

        // Execution layer WebSocket - VPC only
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionWsPort),
            "ARC Execution WebSocket (VPC only)"
        );

        // Consensus layer RPC - VPC only
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(consensusRpcPort),
            "ARC Consensus RPC (VPC only)"
        );

        // Metrics ports - VPC only
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionMetricsPort),
            "ARC Execution Metrics (VPC only)"
        );

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(consensusMetricsPort),
            "ARC Consensus Metrics (VPC only)"
        );

        // Get IAM role from common stack
        const importedInstanceRoleArn = cdk.Fn.importValue(`ArcNodeInstanceRoleArn`);
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Get assets info from common stack
        const assetsBucket = cdk.Fn.importValue(`ArcAssetsBucket`);
        const assetsKey = cdk.Fn.importValue(`ArcAssetsKey`);

        // Use Amazon Linux 2023 image
        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        const node = new SingleNodeConstruct(this, "arc-node", {
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

        // Override creation policy timeout for snapshot download (60-90 minutes)
        const cfnInstance = node.instance.node.defaultChild as ec2.CfnInstance;
        cfnInstance.cfnOptions.creationPolicy = {
            resourceSignal: {
                count: 1,
                timeout: "PT120M",  // 120 minutes for snapshot download + initialization
            },
        };

        // User data for Circle ARC setup
        node.instance.addUserData(
            '#!/bin/bash',
            'set -e',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Circle ARC node setup..."',
            '',
            '# Install required packages',
            'yum install -y docker wget curl jq amazon-cloudwatch-agent',
            '',
            '# Install Docker Compose v2',
            'DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker}',
            'mkdir -p $DOCKER_CONFIG/cli-plugins',
            'curl -SL https://github.com/docker/compose/releases/download/v2.32.1/docker-compose-linux-x86_64 -o $DOCKER_CONFIG/cli-plugins/docker-compose',
            'chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose',
            'ln -sf $DOCKER_CONFIG/cli-plugins/docker-compose /usr/local/bin/docker-compose',
            '',
            '# Start Docker',
            'systemctl enable docker',
            'systemctl start docker',
            '',
            '# Create directories',
            'mkdir -p /data/arc-execution /data/arc-consensus /data/arc-run /opt/arc',
            '',
            '# Download assets',
            `aws s3 cp s3://${assetsBucket}/${assetsKey} /tmp/assets.zip`,
            'cd /tmp && unzip -q assets.zip',
            'cp docker-compose.yml /opt/arc/',
            'chmod +x download-snapshot.sh',
            '',
            '# Download snapshot if requested',
            snapshotDownload ? 'echo "Downloading ARC snapshot (this may take 30-60 minutes)..."' : 'echo "Skipping snapshot download"',
            snapshotDownload ? './download-snapshot.sh arc-testnet /data/arc-execution /data/arc-consensus' : '',
            '',
            '# Initialize consensus layer',
            'echo "Initializing consensus layer..."',
            `docker run --rm -v /data/arc-consensus:/home docker.cloudsmith.io/circle/arc-network/arc-consensus:${arcVersion} init --home /home`,
            '',
            '# Set environment variables',
            `echo "ARC_VERSION=${arcVersion}" > /opt/arc/.env`,
            '',
            '# Pull Docker images',
            'echo "Pulling Docker images..."',
            `docker pull docker.cloudsmith.io/circle/arc-network/arc-execution:${arcVersion}`,
            `docker pull docker.cloudsmith.io/circle/arc-network/arc-consensus:${arcVersion}`,
            '',
            '# Start services with Docker Compose',
            'echo "Starting ARC services..."',
            'cd /opt/arc',
            'docker compose up -d',
            '',
            '# Wait for services to be healthy',
            'echo "Waiting for services to become healthy..."',
            'sleep 30',
            '',
            '# Check service health',
            'EXECUTION_HEALTHY=$(docker inspect --format=\'{{.State.Health.Status}}\' arc-execution 2>/dev/null || echo "unhealthy")',
            'CONSENSUS_HEALTHY=$(docker inspect --format=\'{{.State.Health.Status}}\' arc-consensus 2>/dev/null || echo "unhealthy")',
            '',
            'echo "Execution layer health: $EXECUTION_HEALTHY"',
            'echo "Consensus layer health: $CONSENSUS_HEALTHY"',
            '',
            '# Signal CloudFormation',
            'if [ "$EXECUTION_HEALTHY" = "healthy" ] || [ "$EXECUTION_HEALTHY" = "starting" ]; then',
            `  /opt/aws/bin/cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success true`,
            '  echo "✓ Setup complete"',
            'else',
            `  /opt/aws/bin/cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success false`,
            '  echo "✗ Service failed"',
            '  docker compose logs',
            '  exit 1',
            'fi',
            '',
            'echo "Circle ARC node setup completed!"',
            'echo "Check logs with: docker compose -f /opt/arc/docker-compose.yml logs -f"'
        );

        // CloudWatch Dashboard
        new cw.CfnDashboard(this, 'arc-dashboard', {
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
            }),
        });

        new cdk.CfnOutput(this, "node-instance-id", {
            value: node.instanceId,
            description: "Circle ARC node instance ID",
        });

        // cdk-nag suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-EC29",
                    reason: "Single node setup doesn't require ASG",
                },
            ],
            true
        );
    }
}

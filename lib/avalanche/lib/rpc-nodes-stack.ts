import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as path from "path";
import * as nag from "cdk-nag";
import { HANodesConstruct } from "../../constructs/ha-rpc-nodes-with-alb";
import * as configTypes from "./config/avalanche-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";

export interface AvalancheRpcNodesStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    avalancheNetwork: configTypes.AvalancheNetwork;
    avalanchegoVersion: string;
    nodeType: configTypes.AvalancheNodeType;
    snapshotType: configTypes.SnapshotType;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    httpPort: number;
    stakingPort: number;
    numberOfNodes: number;
    albHealthCheckGracePeriodMin: number;
    heartBeatDelayMin: number;
}

export class AvalancheRpcNodesStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: AvalancheRpcNodesStackProps) {
        super(scope, id, props);

        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const lifecycleHookName = STACK_NAME;
        const autoScalingGroupName = STACK_NAME;

        const {
            instanceType,
            instanceCpuType,
            avalancheNetwork,
            avalanchegoVersion,
            nodeType,
            snapshotType,
            dataVolume,
            httpPort,
            stakingPort,
            numberOfNodes,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
        } = props;

        // Get snapshot bucket name if using S3
        let snapshotBucketName;
        if (snapshotType === "s3") {
            snapshotBucketName = cdk.Fn.importValue("AvalancheNodeSnapshotBucketName");
        }

        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Security group for RPC nodes
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security group for Avalanche RPC nodes",
            allowAllOutbound: true,
        });

        // P2P staking port
        instanceSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(stakingPort),
            "Avalanche P2P/Staking"
        );

        // HTTP API port from ALB only
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(httpPort),
            "Avalanche HTTP API from ALB"
        );

        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        const importedInstanceRoleArn = cdk.Fn.importValue("AvalancheNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);
        asset.bucket.grantRead(instanceRole);

        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        // Create user data for RPC nodes
        const userData = ec2.UserData.forLinux();
        userData.addCommands(
            '#!/bin/bash',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Avalanche RPC node setup..."',
            '',
            '# Install required packages',
            'dnf install -y wget jq amazon-cloudwatch-agent at',
            '',
            '# Create avalanche user',
            'useradd -r -s /bin/false avalanche || true',
            'mkdir -p /opt/avalanche /var/lib/avalanche /var/log/avalanche',
            'chown avalanche:avalanche /var/lib/avalanche /var/log/avalanche',
            '',
            '# Create environment file',
            'cat > /etc/environment << EOF',
            `REGION=${REGION}`,
            `NODE_ROLE=rpc-node`,
            `AVALANCHE_HTTP_PORT=${httpPort}`,
            `LIFECYCLE_HOOK_NAME=${lifecycleHookName}`,
            `AUTOSCALING_GROUP_NAME=${autoScalingGroupName}`,
            snapshotType === "s3" ? `SNAPSHOT_S3_PATH=s3://${snapshotBucketName}` : '',
            'EOF',
            '',
            '# Attach and mount data volume',
            'TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")',
            'INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)',
            `VOLUME_ID=$(aws ec2 describe-volumes --region ${REGION} --filters "Name=tag:aws:autoscaling:groupName,Values=${autoScalingGroupName}" "Name=tag:instance-id,Values=$INSTANCE_ID" --query "Volumes[0].VolumeId" --output text)`,
            'echo "Attaching volume $VOLUME_ID..."',
            `aws ec2 attach-volume --region ${REGION} --volume-id $VOLUME_ID --instance-id $INSTANCE_ID --device /dev/sdf`,
            '',
            'DEVICE=""',
            'for i in {1..30}; do',
            '  if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; break; fi',
            '  if [ -e /dev/xvdf ]; then DEVICE="/dev/xvdf"; break; fi',
            '  sleep 10',
            'done',
            '',
            '[ -z "$DEVICE" ] && echo "ERROR: Volume not found" && exit 1',
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
            '# Install s5cmd and download assets',
            snapshotType === "s3" ? 'cd /tmp && wget -q https://github.com/peak/s5cmd/releases/download/v2.2.2/s5cmd_2.2.2_Linux-64bit.tar.gz' : '',
            snapshotType === "s3" ? 'tar -xzf s5cmd_2.2.2_Linux-64bit.tar.gz && mv s5cmd /usr/local/bin/ && chmod +x /usr/local/bin/s5cmd' : '',
            `aws s3 cp s3://${asset.s3BucketName}/${asset.s3ObjectKey} /tmp/assets.zip`,
            'cd /tmp && unzip -q assets.zip',
            'mkdir -p /opt/avalanche/storage',
            snapshotType === "s3" ? 'cp /tmp/storage/*.sh /opt/avalanche/storage/ && chmod +x /opt/avalanche/storage/*.sh' : '',
            '',
            '# Create systemd service',
            `NETWORK_FLAG="${avalancheNetwork !== 'mainnet' ? `--network-id=${avalancheNetwork}` : ''}"`,
            'cat > /etc/systemd/system/avalanchego.service << EOF',
            '[Unit]',
            'Description=AvalancheGo RPC Node',
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
            'systemctl daemon-reload',
            'systemctl enable avalanchego',
            '',
            '# If using S3 snapshots, schedule snapshot restore',
            snapshotType === "s3" ? 'echo "/opt/avalanche/storage/copy-data-from-s3.sh" | at now + 2 minutes' : 'systemctl start avalanchego',
            snapshotType !== "s3" ? 'sleep 15' : '',
            snapshotType !== "s3" ? 'systemctl is-active --quiet avalanchego && echo "✓ RPC node started"' : 'echo "✓ Snapshot restore scheduled"',
            '',
            '# Note: For S3 snapshots, copy-data-from-s3.sh will start the service and signal ASG'
        );

        // Create HA construct with ALB
        const rpcNodes = new HANodesConstruct(this, "avalanche-rpc-nodes", {
            instanceType,
            dataVolumes: [dataVolume],
            rootDataVolumeDeviceName: "/dev/xvda",
            machineImage,
            vpc,
            securityGroup: instanceSG,
            role: instanceRole,
            numberOfNodes,
            rpcPortForALB: httpPort,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            lifecycleHookName,
            autoScalingGroupName,
            userData: userData.render(),
        });

        new cdk.CfnOutput(this, "alb-url", {
            value: `http://${rpcNodes.loadBalancerDnsName}`,
            description: "ALB DNS name for Avalanche RPC",
        });

        // cdk-nag suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Need read access to S3 assets and snapshot bucket",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Avalanche P2P/staking port needs public access",
                },
                {
                    id: "AwsSolutions-ELB2",
                    reason: "Access logs not required for RPC ALB in this setup",
                },
            ],
            true
        );
    }
}

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { AvalancheNodeConfig } from './avalanche-node-config';

export interface AvalancheNodeProps {
  vpc: ec2.IVpc;
  availabilityZone: string;
  config: AvalancheNodeConfig;
}

export class AvalancheNode extends Construct {
  public readonly instance: ec2.Instance;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: AvalancheNodeProps) {
    super(scope, id);

    const { vpc, availabilityZone, config } = props;

    // Create CloudWatch Log Group
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/avalanche-node/${id}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Security Group
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Security group for Avalanche node',
      allowAllOutbound: true,
    });

    // Add ingress rules
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(config.httpPort),
      'Avalanche HTTP API'
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(config.stakingPort),
      'Avalanche Staking/P2P'
    );

    if (config.enableSsh) {
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(22),
        'SSH Access'
      );
    }

    // Create IAM Role
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Add CloudWatch logs permissions
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: [this.logGroup.logGroupArn + '*'],
    }));

    // Create User Data
    const userData = this.createUserData(config);

    // Create EBS Volume for data
    const dataVolume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone,
      size: cdk.Size.gibibytes(config.dataVolumeSize),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
    });

    // Create EC2 Instance - FIXED VERSION
    this.instance = new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { 
        subnetType: ec2.SubnetType.PUBLIC,
        availabilityZones: [availabilityZone]
      },
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup,
      role,
      userData,
      associatePublicIpAddress: true, // Ensure public IP is assigned
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    // Attach data volume
    new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
      instanceId: this.instance.instanceId,
      volumeId: dataVolume.volumeId,
      device: '/dev/sdf',
    });

    // Add tags
    cdk.Tags.of(this.instance).add('Name', `avalanche-${config.avalancheNetwork}-node`);
    cdk.Tags.of(this.instance).add('NodeType', config.nodeType);
    cdk.Tags.of(this.instance).add('Network', config.avalancheNetwork);
  }

private createUserData(config: AvalancheNodeConfig): ec2.UserData {
  const userData = ec2.UserData.forLinux();
  
  userData.addCommands(
    '#!/bin/bash',
    'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
    'echo "Starting Avalanche node setup..."',
    
    // Update system
    'yum update -y',
    'yum install -y wget curl jq',
    
    // Create avalanche user
    'useradd -r -s /bin/false avalanche || true',
    'mkdir -p /opt/avalanche /var/lib/avalanche /var/log/avalanche',
    'chown avalanche:avalanche /var/lib/avalanche /var/log/avalanche',
    
    // Wait for EBS volume with better detection and logging
    'echo "Waiting for EBS volume..."',
    'DEVICE=""',
    'for i in {1..30}; do',
    '  echo "Attempt $i/30: Looking for EBS volume..."',
    '  if [ -e /dev/xvdf ]; then',
    '    DEVICE="/dev/xvdf"',
    '    echo "Found traditional device: $DEVICE"',
    '    break',
    '  fi',
    '  if [ -e /dev/nvme1n1 ]; then',
    '    DEVICE="/dev/nvme1n1"',
    '    echo "Found NVMe device: $DEVICE"',
    '    break',
    '  fi',
    '  lsblk',
    '  sleep 10',
    'done',
    
    'if [ -z "$DEVICE" ]; then',
    '  echo "ERROR: EBS volume not found after 5 minutes"',
    '  echo "Available block devices:"',
    '  lsblk',
    '  ls -la /dev/nvme* /dev/xvd* 2>/dev/null || echo "No matching devices found"',
    '  exit 1',
    'fi',
    
    'echo "Found EBS volume at $DEVICE"',
    
    // Check if volume is already formatted
    'echo "Checking if volume is formatted..."',
    'if ! blkid $DEVICE; then',
    '  echo "Formatting EBS volume with ext4..."',
    '  mkfs -t ext4 $DEVICE',
    '  if [ $? -ne 0 ]; then',
    '    echo "ERROR: Failed to format volume"',
    '    exit 1',
    '  fi',
    'else',
    '  echo "Volume is already formatted"',
    'fi',
    
    'echo "Mounting EBS volume..."',
    'mkdir -p /var/lib/avalanche/data',
    'mount $DEVICE /var/lib/avalanche/data',
    'if [ $? -ne 0 ]; then',
    '  echo "ERROR: Failed to mount volume"',
    '  exit 1',
    'fi',
    
    'chown -R avalanche:avalanche /var/lib/avalanche/data',
    'echo "$DEVICE /var/lib/avalanche/data ext4 defaults,nofail 0 2" >> /etc/fstab',
    'echo "EBS volume mounted successfully at /var/lib/avalanche/data"',
    
    // Download AvalancheGo
    'echo "Downloading AvalancheGo..."',
    'cd /opt/avalanche',
    `wget -q https://github.com/ava-labs/avalanchego/releases/download/${config.avalanchegoVersion}/avalanchego-linux-amd64-${config.avalanchegoVersion}.tar.gz`,
    'if [ $? -ne 0 ]; then',
    '  echo "ERROR: Failed to download AvalancheGo"',
    '  exit 1',
    'fi',
    
    'echo "Extracting AvalancheGo..."',
    `tar -xzf avalanchego-linux-amd64-${config.avalanchegoVersion}.tar.gz`,
    'if [ $? -ne 0 ]; then',
    '  echo "ERROR: Failed to extract AvalancheGo"',
    '  exit 1',
    'fi',
    
    `mv avalanchego-${config.avalanchegoVersion} current`,
    'chmod +x current/avalanchego',
    'chown -R avalanche:avalanche /opt/avalanche',
    
    // Test the binary
    'echo "Testing AvalancheGo binary..."',
    '/opt/avalanche/current/avalanchego --version',
    'if [ $? -ne 0 ]; then',
    '  echo "ERROR: AvalancheGo binary test failed"',
    '  exit 1',
    'fi',
    
    // Create systemd service
    'echo "Creating systemd service..."',
    this.createSystemdService(config),
    
    // Start service
    'echo "Starting AvalancheGo service..."',
    'systemctl daemon-reload',
    'systemctl enable avalanchego',
    'systemctl start avalanchego',
    
    // Check service status
    'sleep 10',
    'systemctl is-active avalanchego',
    'if [ $? -eq 0 ]; then',
    '  echo "✓ AvalancheGo service is running"',
    'else',
    '  echo "✗ AvalancheGo service failed to start"',
    '  systemctl status avalanchego',
    '  journalctl -u avalanchego -n 20',
    'fi',
    
    'echo "Avalanche node setup completed!"',
    'echo "Check service status with: systemctl status avalanchego"',
    'echo "View logs with: journalctl -u avalanchego -f"'
  );

  return userData;
}

private createSystemdService(config: AvalancheNodeConfig): string {
  const networkFlag = config.avalancheNetwork === 'mainnet' ? '' : `--network-id=${config.avalancheNetwork}`;
  
  return `cat > /etc/systemd/system/avalanchego.service << 'EOF'
[Unit]
Description=AvalancheGo Node
After=network.target
Wants=network.target

[Service]
Type=simple
User=avalanche
Group=avalanche
WorkingDirectory=/var/lib/avalanche
ExecStart=/opt/avalanche/current/avalanchego \\
  --data-dir=/var/lib/avalanche/data \\
  --log-dir=/var/log/avalanche \\
  --http-host=0.0.0.0 \\
  --http-port=${config.httpPort} \\
  --staking-port=${config.stakingPort} \\
  --public-ip-resolution-service=opendns \\
  --state-sync-enabled=true \\
  --log-level=info \\
  ${networkFlag}
Restart=always
RestartSec=30
TimeoutStopSec=60
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=avalanchego

[Install]
WantedBy=multi-user.target
EOF
echo "Systemd service file created"`;
    }
}

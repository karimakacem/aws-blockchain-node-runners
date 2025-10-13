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
      'set -e',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      
      // Update system
      'yum update -y',
      'yum install -y wget curl jq',
      
      // Create avalanche user
      'useradd -r -s /bin/false avalanche || true',
      'mkdir -p /opt/avalanche /var/lib/avalanche /var/log/avalanche',
      'chown avalanche:avalanche /var/lib/avalanche /var/log/avalanche',
      
      // Wait for EBS volume and format/mount
      'echo "Waiting for EBS volume..."',
      'while [ ! -e /dev/xvdf ]; do sleep 1; done',
      'sleep 5', // Give it a moment to be ready
      
      // Check if volume is already formatted
      'if ! blkid /dev/xvdf; then',
      '  echo "Formatting EBS volume..."',
      '  mkfs -t ext4 /dev/xvdf',
      'fi',
      
      'mkdir -p /var/lib/avalanche/data',
      'mount /dev/xvdf /var/lib/avalanche/data',
      'chown -R avalanche:avalanche /var/lib/avalanche/data',
      'echo "/dev/xvdf /var/lib/avalanche/data ext4 defaults,nofail 0 2" >> /etc/fstab',
      
      // Download AvalancheGo
      'echo "Downloading AvalancheGo..."',
      'cd /opt/avalanche',
      `wget -q https://github.com/ava-labs/avalanchego/releases/download/${config.avalanchegoVersion}/avalanchego-linux-amd64-${config.avalanchegoVersion}.tar.gz`,
      `tar -xzf avalanchego-linux-amd64-${config.avalanchegoVersion}.tar.gz`,
      `mv avalanchego-${config.avalanchegoVersion} current`,
      'chmod +x current/avalanchego',
      'chown -R avalanche:avalanche /opt/avalanche',
      
      // Create systemd service
      this.createSystemdService(config),
      
      // Start service
      'systemctl daemon-reload',
      'systemctl enable avalanchego',
      'systemctl start avalanchego',
      
      'echo "Avalanche node setup completed successfully"'
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
EOF`;
  }
}

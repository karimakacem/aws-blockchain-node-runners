import 'dotenv/config'
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { AvalancheSingleNodeStack } from '../lib/single-node-stack';

// Mock the import to prevent actual lookups
jest.mock('aws-cdk-lib/aws-ec2', () => {
  const actual = jest.requireActual('aws-cdk-lib/aws-ec2');
  return {
    ...actual,
    Vpc: {
      ...actual.Vpc,
      fromLookup: jest.fn(() => ({
        vpcId: 'vpc-12345',
        availabilityZones: ['us-east-1a', 'us-east-1b'],
        publicSubnets: [],
        privateSubnets: [],
        isolatedSubnets: [],
        vpcCidrBlock: '10.0.0.0/16',
        selectSubnets: jest.fn(() => ({
          subnets: [],
          availabilityZones: ['us-east-1a'],
          subnetIds: ['subnet-12345'],
        })),
        addGatewayEndpoint: jest.fn(),
      })),
    },
  };
});

// Mock CFN imports
const mockImportValue = jest.spyOn(cdk.Fn, 'importValue');
mockImportValue.mockReturnValue('arn:aws:iam::123456789012:role/test-role' as any);

describe('AvalancheSingleNodeStack', () => {
  const defaultProps = {
    instanceType: new ec2.InstanceType('c6i.2xlarge'),
    instanceCpuType: ec2.AmazonLinuxCpuType.X86_64,
    avalancheNetwork: 'mainnet' as const,
    avalanchegoVersion: 'v1.11.11',
    nodeType: 'full' as const,
    dataVolume: {
      sizeGiB: 1000,
      type: 'gp3',
      iops: 3000,
      throughput: 250,
    },
    httpPort: 9650,
    stakingPort: 9651,
  };

  test('creates EC2 instance with correct instance type', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 'c6i.2xlarge',
    });
  });

  test('creates security group with correct ports', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Check staking port (public)
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '0.0.0.0/0',
          FromPort: 9651,
          ToPort: 9651,
          IpProtocol: 'tcp',
        }),
      ]),
    });
  });

  test('creates EBS volume with correct configuration', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Volume', {
      Size: 1000,
      VolumeType: 'gp3',
      Encrypted: true,
      Iops: 3000,
      Throughput: 250,
    });
  });

  test('creates CloudWatch dashboard', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('outputs instance ID', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.hasOutput('nodeinstanceid', {
      Description: 'Avalanche node instance ID',
    });
  });

  test('uses ARM64 instance type correctly', () => {
    const app = new cdk.App();
    const stack = new AvalancheSingleNodeStack(app, 'TestStack', {
      ...defaultProps,
      instanceType: new ec2.InstanceType('c7g.2xlarge'),
      instanceCpuType: ec2.AmazonLinuxCpuType.ARM_64,
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 'c7g.2xlarge',
    });
  });
});

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AvalancheNodeStack } from '../lib/avalanche-node-stack';
import { avalancheNodeDefaultConfig } from '../lib/avalanche-node-config';

describe('AvalancheNodeStack', () => {
  test('creates stack with default config', () => {
    const app = new cdk.App();
    const stack = new AvalancheNodeStack(app, 'TestStack', {
      config: avalancheNodeDefaultConfig,
      availabilityZone: 'us-east-1a',
    });

    const template = Template.fromStack(stack);

    // Test EC2 instance creation
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 'c6i.2xlarge',
    });

    // Test security group rules
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 9650,
          ToPort: 9650,
          IpProtocol: 'tcp',
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 9651,
          ToPort: 9651,
          IpProtocol: 'tcp',
        },
      ],
    });

    // Test EBS volume
    template.hasResourceProperties('AWS::EC2::Volume', {
      Size: 1000,
      VolumeType: 'gp3',
      Encrypted: true,
    });
  });
});

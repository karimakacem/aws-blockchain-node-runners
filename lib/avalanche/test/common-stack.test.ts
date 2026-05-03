import 'dotenv/config'
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AvalancheCommonStack } from '../lib/common-stack';

describe('AvalancheCommonStack', () => {
  test('creates IAM role with required policies', () => {
    const app = new cdk.App();
    const stack = new AvalancheCommonStack(app, 'TestStack', {
      snapshotType: 'none',
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Test IAM role creation
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'ec2.amazonaws.com',
            },
          },
        ],
      },
      ManagedPolicyArns: [
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/AmazonSSMManagedInstanceCore',
            ],
          ],
        },
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/CloudWatchAgentServerPolicy',
            ],
          ],
        },
      ],
    });
  });

  test('creates S3 snapshot bucket when snapshot type is s3', () => {
    const app = new cdk.App();
    const stack = new AvalancheCommonStack(app, 'TestStack', {
      snapshotType: 's3',
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Test S3 bucket creation
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });

    // Test VPC endpoint for S3
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: {
        'Fn::Join': [
          '',
          ['com.amazonaws.', { Ref: 'AWS::Region' }, '.s3'],
        ],
      },
      VpcEndpointType: 'Gateway',
    });
  });

  test('does not create S3 bucket when snapshot type is none', () => {
    const app = new cdk.App();
    const stack = new AvalancheCommonStack(app, 'TestStack', {
      snapshotType: 'none',
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // S3 bucket should not exist
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  test('exports instance role ARN', () => {
    const app = new cdk.App();
    const stack = new AvalancheCommonStack(app, 'TestStack', {
      snapshotType: 'none',
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    template.hasOutput('InstanceRoleARN', {
      Export: {
        Name: 'AvalancheNodeInstanceRoleArn',
      },
    });
  });
});

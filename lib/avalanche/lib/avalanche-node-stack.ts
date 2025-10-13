import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { AvalancheNode } from './avalanche-node';
import { AvalancheNodeConfig } from './avalanche-node-config';

export interface AvalancheNodeStackProps extends cdk.StackProps {
  config: AvalancheNodeConfig;
  vpcId?: string;
  availabilityZone: string;
}

export class AvalancheNodeStack extends cdk.Stack {
  public readonly avalancheNode: AvalancheNode;

  constructor(scope: Construct, id: string, props: AvalancheNodeStackProps) {
    super(scope, id, props);

    // Get or create VPC
    const vpc = props.vpcId 
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 2,
          natGateways: 1,
        });

    // Create Avalanche node
    this.avalancheNode = new AvalancheNode(this, 'AvalancheNode', {
      vpc,
      availabilityZone: props.availabilityZone,
      config: props.config,
    });

    // Outputs
    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.avalancheNode.instance.instanceId,
      description: 'Avalanche node instance ID',
    });

    new cdk.CfnOutput(this, 'PublicIp', {
      value: this.avalancheNode.instance.instancePublicIp,
      description: 'Avalanche node public IP',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: `http://${this.avalancheNode.instance.instancePublicIp}:${props.config.httpPort}`,
      description: 'Avalanche API endpoint',
    });
  }
}

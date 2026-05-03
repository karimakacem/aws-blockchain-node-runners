import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";
import * as dotenv from 'dotenv';
dotenv.config({ path: './test/.env-test' });
import * as config from "../lib/config/arbitrum-config";
import { ArbitrumOneSingleNodeStack } from "../lib/arbitrum-one-single-node-stack";

describe("ArbitrumOneSingleNodeStack", () => {
  test("synthesizes the way we expect", () => {
    const app = new cdk.App();

    const singleNodeStack = new ArbitrumOneSingleNodeStack(app, "arbitrum-single-node-test", {
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        stackName: `arbitrum-single-node-test`,
        instanceType: config.singleNodeConfig.instanceType,
        instanceCpuType: config.singleNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        nitroVersion: config.baseConfig.nitroVersion,
        snapshotType: config.baseConfig.snapshotType,
        l1RpcUrl: config.baseConfig.l1RpcUrl,
        l1BeaconUrl: config.baseConfig.l1BeaconUrl,
        dataVolume: config.singleNodeConfig.dataVolumes[0],
        rpcPort: config.baseConfig.rpcPort,
        wsPort: config.baseConfig.wsPort,
        metricsPort: config.baseConfig.metricsPort,
    });

    const template = Template.fromStack(singleNodeStack);

    // Has EC2 instance
    template.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: config.singleNodeConfig.instanceType.toString(),
      IamInstanceProfile: Match.anyValue(),
    });

    // Has EBS volume
    template.hasResourceProperties("AWS::EC2::Volume", {
      Size: config.singleNodeConfig.dataVolumes[0].sizeGiB,
      VolumeType: "gp3",
      Encrypted: true,
    });

    // Has security group
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: "Security group for Arbitrum One node",
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: "tcp",
          FromPort: config.baseConfig.rpcPort,
          ToPort: config.baseConfig.rpcPort,
        })
      ]),
    });

    // Has CloudWatch dashboard
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: Match.anyValue(),
    });

 });
});

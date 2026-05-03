import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";
import * as dotenv from 'dotenv';
dotenv.config({ path: './test/.env-test' });
import * as config from "../lib/config/arc-config";
import { ArcSingleNodeStack } from "../lib/single-node-stack";

describe("ArcSingleNodeStack", () => {
  test("synthesizes the way we expect", () => {
    const app = new cdk.App();

    const singleNodeStack = new ArcSingleNodeStack(app, "arc-single-node-test", {
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        stackName: `arc-single-node-test`,
        instanceType: config.syncNodeConfig.instanceType,
        instanceCpuType: config.syncNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        arcVersion: config.baseConfig.arcVersion,
        snapshotDownload: config.baseConfig.snapshotDownload,
        dataVolume: config.syncNodeConfig.dataVolumes[0],
        executionRpcPort: config.baseConfig.executionRpcPort,
        executionWsPort: config.baseConfig.executionWsPort,
        executionMetricsPort: config.baseConfig.executionMetricsPort,
        consensusRpcPort: config.baseConfig.consensusRpcPort,
        consensusMetricsPort: config.baseConfig.consensusMetricsPort,
    });

    const template = Template.fromStack(singleNodeStack);

    // Has EC2 instance
    template.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: config.syncNodeConfig.instanceType.toString(),
      IamInstanceProfile: Match.anyValue(),
    });

    // Has EBS volume
    template.hasResourceProperties("AWS::EC2::Volume", {
      Size: config.syncNodeConfig.dataVolumes[0].sizeGiB,
      VolumeType: "gp3",
      Encrypted: true,
    });

    // Has security group
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: "Security group for Circle ARC node",
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: "tcp",
          FromPort: config.baseConfig.executionRpcPort,
          ToPort: config.baseConfig.executionRpcPort,
        })
      ]),
    });

    // Has CloudWatch dashboard
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: Match.anyValue(),
    });

 });
});

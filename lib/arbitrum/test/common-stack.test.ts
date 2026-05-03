import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";
import * as dotenv from 'dotenv';
dotenv.config({ path: './test/.env-test' });
import * as config from "../lib/config/arbitrum-config";
import { ArbitrumCommonStack } from "../lib/common-stack";

describe("ArbitrumCommonStack", () => {
  test("synthesizes the way we expect", () => {
    const app = new cdk.App();

    const commonStack = new ArbitrumCommonStack(app, "arbitrum-common-test", {
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        stackName: `arbitrum-common-test`,
        network: config.baseConfig.network,
    });

    const template = Template.fromStack(commonStack);

    // Has EC2 instance role
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
         {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
           Service: "ec2.amazonaws.com"
          }
         }
        ]
       },
       ManagedPolicyArns: [
        {
         "Fn::Join": [
          "",
          [
           "arn:",
           {
            Ref: "AWS::Partition"
           },
           ":iam::aws:policy/AmazonSSMManagedInstanceCore"
          ]
         ]
        },
        {
         "Fn::Join": [
          "",
          [
           "arn:",
           {
            "Ref": "AWS::Partition"
           },
           ":iam::aws:policy/CloudWatchAgentServerPolicy"
          ]
         ]
        }
       ]
    });

    // Has IAM policy for CloudFormation signaling
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "cloudformation:SignalResource",
            Effect: "Allow",
            Resource: "*"
          })
        ])
      }
    });

 });
});

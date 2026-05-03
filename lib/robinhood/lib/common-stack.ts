import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as nag from "cdk-nag";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as path from "path";

export interface RobinhoodCommonStackProps extends cdk.StackProps {
}

export class RobinhoodCommonStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: RobinhoodCommonStackProps) {
        super(scope, id, props);

        const region = cdk.Stack.of(this).region;
        const stackName = cdk.Stack.of(this).stackName;
        const accountId = cdk.Stack.of(this).account;

        // Create assets bucket for scripts
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // IAM role for Robinhood Chain nodes
        const instanceRole = new iam.Role(this, `node-role`, {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
            ],
        });

        // CloudFormation signal permissions
        instanceRole.addToPolicy(
            new iam.PolicyStatement({
                resources: ["*"],
                actions: ["cloudformation:SignalResource"],
            })
        );

        // Auto Scaling lifecycle actions
        instanceRole.addToPolicy(
            new iam.PolicyStatement({
                resources: [
                    `arn:aws:autoscaling:${region}:${accountId}:autoScalingGroup:*:autoScalingGroupName/robinhood-*`,
                ],
                actions: ["autoscaling:CompleteLifecycleAction"],
            })
        );

        // Grant read access to assets bucket
        asset.bucket.grantRead(instanceRole);

        new cdk.CfnOutput(this, "Instance Role ARN", {
            value: instanceRole.roleArn,
            exportName: `RobinhoodNodeInstanceRoleArn`,
        });

        new cdk.CfnOutput(this, "Assets Bucket", {
            value: asset.s3BucketName,
            exportName: `RobinhoodAssetsBucket`,
        });

        new cdk.CfnOutput(this, "Assets Key", {
            value: asset.s3ObjectKey,
            exportName: `RobinhoodAssetsKey`,
        });

        // cdk-nag suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "AmazonSSMManagedInstanceCore and CloudWatchAgentServerPolicy are restrictive enough",
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "CloudFormation signal and ASG actions require wildcard permissions",
                },
            ],
            true
        );
    }
}

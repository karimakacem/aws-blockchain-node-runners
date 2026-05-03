import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as nag from "cdk-nag";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as path from "path";

export interface ArcCommonStackProps extends cdk.StackProps {
}

export class ArcCommonStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props?: ArcCommonStackProps) {
        super(scope, id, props);

        const region = cdk.Stack.of(this).region;
        const account = cdk.Stack.of(this).account;

        // Upload assets (scripts, configs) to S3
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // IAM role for EC2 instances
        const instanceRole = new iam.Role(this, `node-role`, {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
            ],
        });

        // Allow CloudFormation signaling
        instanceRole.addToPolicy(
            new iam.PolicyStatement({
                resources: ["*"],
                actions: ["cloudformation:SignalResource"],
            })
        );

        // Allow Auto Scaling lifecycle hook completion
        instanceRole.addToPolicy(
            new iam.PolicyStatement({
                resources: [
                    `arn:aws:autoscaling:${region}:${account}:autoScalingGroup:*:autoScalingGroupName/arc-*`,
                ],
                actions: ["autoscaling:CompleteLifecycleAction"],
            })
        );

        // Grant read access to assets bucket
        asset.bucket.grantRead(instanceRole);

        new cdk.CfnOutput(this, "AssetsBucket", {
            value: asset.s3BucketName,
            exportName: `ArcAssetsBucket`,
        });

        new cdk.CfnOutput(this, "AssetsKey", {
            value: asset.s3ObjectKey,
            exportName: `ArcAssetsKey`,
        });

        new cdk.CfnOutput(this, "InstanceRoleARN", {
            value: instanceRole.roleArn,
            exportName: `ArcNodeInstanceRoleArn`,
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
                    reason: "Can't target specific stack: https://github.com/aws/aws-cdk/issues/22657",
                },
            ],
            true
        );
    }
}

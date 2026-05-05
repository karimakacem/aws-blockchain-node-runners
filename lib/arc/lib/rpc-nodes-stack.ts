import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as nag from "cdk-nag";
import * as path from "path";
import * as fs from "fs";
import * as configTypes from "./config/arc-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";
import { HANodesConstruct } from "../../constructs/ha-rpc-nodes-with-alb";

export interface ArcRpcNodesStackProps extends cdk.StackProps {
    network: configTypes.ArcNetwork;
    arcVersion: string;
    snapshotDownload: boolean;
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    executionRpcPort: number;
    executionWsPort: number;
    executionMetricsPort: number;
    consensusRpcPort: number;
    consensusMetricsPort: number;
    numberOfNodes: number;
    albHealthCheckGracePeriodMin: number;
    heartBeatDelayMin: number;
}

export class ArcRpcNodesStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: ArcRpcNodesStackProps) {
        super(scope, id, props);

        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const lifecycleHookName = STACK_NAME;
        const autoScalingGroupName = STACK_NAME;

        const {
            network,
            arcVersion,
            snapshotDownload,
            instanceType,
            instanceCpuType,
            dataVolume,
            executionRpcPort,
            executionWsPort,
            executionMetricsPort,
            consensusRpcPort,
            consensusMetricsPort,
            numberOfNodes,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
        } = props;

        // Using default VPC
        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Security group
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Circle ARC RPC nodes",
            allowAllOutbound: true,
        });

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionRpcPort),
            "ARC Execution RPC"
        );

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionWsPort),
            "ARC Execution WebSocket"
        );

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(consensusRpcPort),
            "ARC Consensus RPC"
        );

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(executionMetricsPort),
            "ARC Execution Metrics"
        );

        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(consensusMetricsPort),
            "ARC Consensus Metrics"
        );

        // Upload assets to S3
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // Get IAM role from common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("ArcNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Grant read permissions on assets
        asset.bucket.grantRead(instanceRole);

        // Read user-data script and inject variables via cdk.Fn.sub
        const userData = fs.readFileSync(path.join(__dirname, "assets", "user-data-rpc-node.sh")).toString();

        const modifiedUserData = cdk.Fn.sub(userData, {
            _REGION_: REGION,
            _STACK_NAME_: STACK_NAME,
            _LIFECYCLE_HOOK_NAME_: lifecycleHookName,
            _AUTOSCALING_GROUP_NAME_: autoScalingGroupName,
            _ARC_VERSION_: arcVersion,
            _ARC_NETWORK_: network,
            _ASSETS_S3_PATH_: `s3://${asset.s3BucketName}/${asset.s3ObjectKey}`,
            _EXECUTION_RPC_PORT_: executionRpcPort.toString(),
            _EXECUTION_WS_PORT_: executionWsPort.toString(),
            _EXECUTION_METRICS_PORT_: executionMetricsPort.toString(),
            _CONSENSUS_RPC_PORT_: consensusRpcPort.toString(),
            _CONSENSUS_METRICS_PORT_: consensusMetricsPort.toString(),
            _SNAPSHOT_DOWNLOAD_: snapshotDownload ? "true" : "false",
        });

        // Machine image
        const machineImage = ec2.MachineImage.latestAmazonLinux2023({
            cpuType: instanceCpuType,
        });

        // HA Nodes construct
        const rpcNodes = new HANodesConstruct(this, "rpc-nodes", {
            instanceType,
            dataVolumes: [dataVolume],
            machineImage,
            role: instanceRole,
            vpc,
            securityGroup: instanceSG,
            userData: modifiedUserData,
            numberOfNodes,
            rpcPortForALB: executionRpcPort,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            lifecycleHookName: lifecycleHookName,
            autoScalingGroupName: autoScalingGroupName,
        });

        new cdk.CfnOutput(this, "alb-url", {
            value: rpcNodes.loadBalancerDnsName,
            description: "Application Load Balancer DNS name for Circle ARC RPC nodes",
        });

        // cdk-nag suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-AS3",
                    reason: "No notifications needed",
                },
                {
                    id: "AwsSolutions-S1",
                    reason: "No access log needed for ALB logs bucket",
                },
                {
                    id: "AwsSolutions-EC28",
                    reason: "Using basic monitoring to save costs",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Security group is restricted to VPC CIDR range",
                },
            ],
            true
        );
    }
}

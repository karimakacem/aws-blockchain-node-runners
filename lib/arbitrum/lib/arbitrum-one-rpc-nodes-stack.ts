import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as nag from "cdk-nag";
import * as path from "path";
import * as fs from "fs";
import * as configTypes from "./config/arbitrum-config.interface";
import { HANodesConstruct } from "../../constructs/ha-rpc-nodes-with-alb";

export interface ArbitrumOneRpcNodesStackProps extends cdk.StackProps {
    network: configTypes.ArbitrumNetwork;
    nitroVersion: string;
    snapshotType: configTypes.ArbitrumSnapshotType;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    dataVolume: configTypes.ArbitrumDataVolumeConfig;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
    numberOfNodes: number;
    albHealthCheckGracePeriodMin: number;
    heartBeatDelayMin: number;
}

export class ArbitrumOneRpcNodesStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: ArbitrumOneRpcNodesStackProps) {
        super(scope, id, props);

        // Validate L1 endpoints are provided
        if (!props.l1RpcUrl || props.l1RpcUrl.trim() === "") {
            throw new Error("L1_RPC_URL must be provided for Arbitrum node to connect to Ethereum L1");
        }
        if (!props.l1BeaconUrl || props.l1BeaconUrl.trim() === "") {
            throw new Error("L1_BEACON_URL must be provided for Arbitrum node to connect to Ethereum beacon chain");
        }

        // Setting up necessary environment variables
        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const lifecycleHookName = STACK_NAME;
        const autoScalingGroupName = STACK_NAME;

        // Getting our config from initialization properties
        const {
            network,
            nitroVersion,
            snapshotType,
            l1RpcUrl,
            l1BeaconUrl,
            instanceType,
            instanceCpuType,
            dataVolume,
            rpcPort,
            wsPort,
            metricsPort,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            numberOfNodes,
        } = props;

        // Using default VPC
        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Setting up the security group for the node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Arbitrum Nitro RPC nodes",
            allowAllOutbound: true,
        });

        // Allow RPC access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(rpcPort),
            "Arbitrum RPC port"
        );

        // Allow WebSocket access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(wsPort),
            "Arbitrum WebSocket port"
        );

        // Allow metrics access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(metricsPort),
            "Arbitrum Metrics port"
        );

        // Making our scripts and configs from the local "assets" directory available for instance to download
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // Getting the IAM role ARN from the common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("ArbitrumNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Grant read permissions on assets
        asset.bucket.grantRead(instanceRole);

        // Parsing user data script and injecting necessary variables
        const userData = fs.readFileSync(path.join(__dirname, "assets", "user-data-rpc-node.sh")).toString();

        const modifiedUserData = cdk.Fn.sub(userData, {
            _REGION_: REGION,
            _ASSETS_S3_PATH_: `s3://${asset.s3BucketName}/${asset.s3ObjectKey}`,
            _ARBITRUM_NETWORK_: network,
            _NITRO_VERSION_: nitroVersion,
            _SNAPSHOT_TYPE_: snapshotType,
            _L1_RPC_URL_: l1RpcUrl,
            _L1_BEACON_URL_: l1BeaconUrl,
            _RPC_PORT_: rpcPort.toString(),
            _WS_PORT_: wsPort.toString(),
            _METRICS_PORT_: metricsPort.toString(),
            _STACK_NAME_: STACK_NAME,
            _LIFECYCLE_HOOK_NAME_: lifecycleHookName,
            _AUTOSCALING_GROUP_NAME_: autoScalingGroupName,
        });

        // Setting up the nodes using generic High Availability (HA) Node construct
        const rpcNodes = new HANodesConstruct(this, "rpc-nodes", {
            instanceType,
            dataVolumes: [dataVolume],
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
                kernel: ec2.AmazonLinuxKernel.KERNEL6_1,
                cpuType: instanceCpuType,
            }),
            role: instanceRole,
            vpc,
            securityGroup: instanceSG,
            userData: modifiedUserData,
            numberOfNodes,
            rpcPortForALB: rpcPort,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            lifecycleHookName: lifecycleHookName,
            autoScalingGroupName: autoScalingGroupName,
        });

        // Making sure we output the URL of our Application Load Balancer
        new cdk.CfnOutput(this, "alb-url", {
            value: rpcNodes.loadBalancerDnsName,
            description: "Application Load Balancer DNS name for Arbitrum RPC nodes",
        });

        // Adding suppressions to the stack
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

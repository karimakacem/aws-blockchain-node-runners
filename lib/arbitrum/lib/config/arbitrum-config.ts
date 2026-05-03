import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as configTypes from "./arbitrum-config.interface";
import * as constants from "../../../constructs/constants";

const parseDataVolumeType = (dataVolumeType: string) => {
    switch (dataVolumeType) {
        case "gp3":
            return ec2.EbsDeviceVolumeType.GP3;
        case "io2":
            return ec2.EbsDeviceVolumeType.IO2;
        case "io1":
            return ec2.EbsDeviceVolumeType.IO1;
        case "instance-store":
            return constants.InstanceStoreageDeviceVolumeType;
        default:
            return ec2.EbsDeviceVolumeType.GP3;
    }
}

export const baseConfig: configTypes.ArbitrumBaseConfig = {
    accountId: process.env.AWS_ACCOUNT_ID || "xxxxxxxxxxx",
    region: process.env.AWS_REGION || "us-east-1",
    network: <configTypes.ArbitrumNetwork>process.env.ARBITRUM_NETWORK || "arb1",
    nodeType: <configTypes.ArbitrumNodeType>process.env.ARBITRUM_NODE_TYPE || "full",
    snapshotType: <configTypes.ArbitrumSnapshotType>process.env.ARBITRUM_SNAPSHOT_TYPE || "pruned",
    nitroVersion: process.env.NITRO_VERSION || "v3.2.1-d81324d",
    l1RpcUrl: process.env.L1_RPC_URL || "https://ethereum-rpc.publicnode.com",
    l1BeaconUrl: process.env.L1_BEACON_URL || "https://ethereum-beacon-api.publicnode.com",
    rpcPort: process.env.ARBITRUM_RPC_PORT ? parseInt(process.env.ARBITRUM_RPC_PORT) : 8547,
    wsPort: process.env.ARBITRUM_WS_PORT ? parseInt(process.env.ARBITRUM_WS_PORT) : 8548,
    metricsPort: process.env.ARBITRUM_METRICS_PORT ? parseInt(process.env.ARBITRUM_METRICS_PORT) : 6070,
};

export const singleNodeConfig: configTypes.ArbitrumSingleNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ARBITRUM_SINGLE_NODE_INSTANCE_TYPE || "m6i.2xlarge"),
    instanceCpuType: process.env.ARBITRUM_SINGLE_NODE_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    dataVolumes: [
        {
            sizeGiB: process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_SIZE ? parseInt(process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_SIZE) : 2000,
            type: parseDataVolumeType(process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_IOPS ? parseInt(process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_IOPS) : 7000,
            throughput: process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_THROUGHPUT ? parseInt(process.env.ARBITRUM_SINGLE_NODE_DATA_VOL_THROUGHPUT) : 500,
        }
    ]
};

export const rpcNodeConfig: configTypes.ArbitrumRpcNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ARBITRUM_RPC_INSTANCE_TYPE || "m6i.2xlarge"),
    instanceCpuType: process.env.ARBITRUM_RPC_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    numberOfNodes: process.env.ARBITRUM_RPC_NUMBER_OF_NODES ? parseInt(process.env.ARBITRUM_RPC_NUMBER_OF_NODES) : 2,
    albHealthCheckGracePeriodMin: process.env.ARBITRUM_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN ? parseInt(process.env.ARBITRUM_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN) : 30,
    heartBeatDelayMin: process.env.ARBITRUM_RPC_HA_NODES_HEARTBEAT_DELAY_MIN ? parseInt(process.env.ARBITRUM_RPC_HA_NODES_HEARTBEAT_DELAY_MIN) : 180,
    dataVolumes: [
        {
            sizeGiB: process.env.ARBITRUM_RPC_DATA_VOL_SIZE ? parseInt(process.env.ARBITRUM_RPC_DATA_VOL_SIZE) : 2000,
            type: parseDataVolumeType(process.env.ARBITRUM_RPC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ARBITRUM_RPC_DATA_VOL_IOPS ? parseInt(process.env.ARBITRUM_RPC_DATA_VOL_IOPS) : 7000,
            throughput: process.env.ARBITRUM_RPC_DATA_VOL_THROUGHPUT ? parseInt(process.env.ARBITRUM_RPC_DATA_VOL_THROUGHPUT) : 500,
        }
    ],
};

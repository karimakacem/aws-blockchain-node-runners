import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as configTypes from "./arc-config.interface";
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

export const baseConfig: configTypes.ArcBaseConfig = {
    accountId: process.env.AWS_ACCOUNT_ID || "xxxxxxxxxxx",
    region: process.env.AWS_REGION || "us-east-1",
    network: <configTypes.ArcNetwork>process.env.ARC_NETWORK || "testnet",
    arcVersion: process.env.ARC_VERSION || "0.6.0",
    snapshotDownload: process.env.ARC_SNAPSHOT_DOWNLOAD?.toLowerCase() !== "false",
    executionRpcPort: process.env.ARC_EXECUTION_RPC_PORT ? parseInt(process.env.ARC_EXECUTION_RPC_PORT) : 8545,
    executionWsPort: process.env.ARC_EXECUTION_WS_PORT ? parseInt(process.env.ARC_EXECUTION_WS_PORT) : 8546,
    executionMetricsPort: process.env.ARC_EXECUTION_METRICS_PORT ? parseInt(process.env.ARC_EXECUTION_METRICS_PORT) : 9001,
    consensusRpcPort: process.env.ARC_CONSENSUS_RPC_PORT ? parseInt(process.env.ARC_CONSENSUS_RPC_PORT) : 31000,
    consensusMetricsPort: process.env.ARC_CONSENSUS_METRICS_PORT ? parseInt(process.env.ARC_CONSENSUS_METRICS_PORT) : 29000,
};

export const syncNodeConfig: configTypes.ArcSyncNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ARC_SYNC_INSTANCE_TYPE || "r6i.4xlarge"),
    instanceCpuType: process.env.ARC_SYNC_CPU_TYPE?.toLowerCase() === "arm_64" ? ec2.AmazonLinuxCpuType.ARM_64 : ec2.AmazonLinuxCpuType.X86_64,
    dataVolumes: [
        {
            sizeGiB: process.env.ARC_SYNC_DATA_VOL_SIZE ? parseInt(process.env.ARC_SYNC_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.ARC_SYNC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ARC_SYNC_DATA_VOL_IOPS ? parseInt(process.env.ARC_SYNC_DATA_VOL_IOPS) : 7000,
            throughput: process.env.ARC_SYNC_DATA_VOL_THROUGHPUT ? parseInt(process.env.ARC_SYNC_DATA_VOL_THROUGHPUT) : 500,
        }
    ]
};

export const rpcNodeConfig: configTypes.ArcRpcNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ARC_RPC_INSTANCE_TYPE || "r6i.4xlarge"),
    instanceCpuType: process.env.ARC_RPC_CPU_TYPE?.toLowerCase() === "arm_64" ? ec2.AmazonLinuxCpuType.ARM_64 : ec2.AmazonLinuxCpuType.X86_64,
    numberOfNodes: process.env.ARC_RPC_NUMBER_OF_NODES ? parseInt(process.env.ARC_RPC_NUMBER_OF_NODES) : 2,
    albHealthCheckGracePeriodMin: process.env.ARC_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN ? parseInt(process.env.ARC_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN) : 30,
    heartBeatDelayMin: process.env.ARC_RPC_HA_NODES_HEARTBEAT_DELAY_MIN ? parseInt(process.env.ARC_RPC_HA_NODES_HEARTBEAT_DELAY_MIN) : 120,
    dataVolumes: [
        {
            sizeGiB: process.env.ARC_RPC_DATA_VOL_SIZE ? parseInt(process.env.ARC_RPC_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.ARC_RPC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ARC_RPC_DATA_VOL_IOPS ? parseInt(process.env.ARC_RPC_DATA_VOL_IOPS) : 7000,
            throughput: process.env.ARC_RPC_DATA_VOL_THROUGHPUT ? parseInt(process.env.ARC_RPC_DATA_VOL_THROUGHPUT) : 500,
        }
    ],
};

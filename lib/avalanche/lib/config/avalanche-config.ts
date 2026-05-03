import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as configTypes from "./avalanche-config.interface";
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

export const baseConfig: configTypes.AvalancheBaseConfig = {
    accountId: process.env.AWS_ACCOUNT_ID || "xxxxxxxxxxx",
    region: process.env.AWS_REGION || "us-east-1",
    network: <configTypes.AvalancheNetwork>process.env.AVALANCHE_NETWORK || "mainnet",
    nodeType: <configTypes.AvalancheNodeType>process.env.AVALANCHE_NODE_TYPE || "full",
    snapshotType: <configTypes.SnapshotType>process.env.AVALANCHE_SNAPSHOT_TYPE || "none",
    avalanchegoVersion: process.env.AVALANCHEGO_VERSION || "v1.11.11",
    httpPort: process.env.AVALANCHE_HTTP_PORT ? parseInt(process.env.AVALANCHE_HTTP_PORT) : 9650,
    stakingPort: process.env.AVALANCHE_STAKING_PORT ? parseInt(process.env.AVALANCHE_STAKING_PORT) : 9651,
};

export const syncNodeConfig: configTypes.AvalancheSyncNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.AVALANCHE_SYNC_INSTANCE_TYPE || "c6i.2xlarge"),
    instanceCpuType: process.env.AVALANCHE_SYNC_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    dataVolumes: [
        {
            sizeGiB: process.env.AVALANCHE_SYNC_DATA_VOL_SIZE ? parseInt(process.env.AVALANCHE_SYNC_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.AVALANCHE_SYNC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.AVALANCHE_SYNC_DATA_VOL_IOPS ? parseInt(process.env.AVALANCHE_SYNC_DATA_VOL_IOPS) : 3000,
            throughput: process.env.AVALANCHE_SYNC_DATA_VOL_THROUGHPUT ? parseInt(process.env.AVALANCHE_SYNC_DATA_VOL_THROUGHPUT) : 250,
        }
    ]
};

export const singleNodeConfig: configTypes.AvalancheSingleNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.AVALANCHE_SINGLE_NODE_INSTANCE_TYPE || "c6i.2xlarge"),
    instanceCpuType: process.env.AVALANCHE_SINGLE_NODE_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    dataVolumes: [
        {
            sizeGiB: process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_SIZE ? parseInt(process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_IOPS ? parseInt(process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_IOPS) : 3000,
            throughput: process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_THROUGHPUT ? parseInt(process.env.AVALANCHE_SINGLE_NODE_DATA_VOL_THROUGHPUT) : 250,
        }
    ]
};

export const rpcNodeConfig: configTypes.AvalancheRpcNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.AVALANCHE_RPC_INSTANCE_TYPE || "c6i.2xlarge"),
    instanceCpuType: process.env.AVALANCHE_RPC_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    numberOfNodes: process.env.AVALANCHE_RPC_NUMBER_OF_NODES ? parseInt(process.env.AVALANCHE_RPC_NUMBER_OF_NODES) : 2,
    albHealthCheckGracePeriodMin: process.env.AVALANCHE_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN ? parseInt(process.env.AVALANCHE_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN) : 10,
    heartBeatDelayMin: process.env.AVALANCHE_RPC_HA_NODES_HEARTBEAT_DELAY_MIN ? parseInt(process.env.AVALANCHE_RPC_HA_NODES_HEARTBEAT_DELAY_MIN) : 120,
    dataVolumes: [
        {
            sizeGiB: process.env.AVALANCHE_RPC_DATA_VOL_SIZE ? parseInt(process.env.AVALANCHE_RPC_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.AVALANCHE_RPC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.AVALANCHE_RPC_DATA_VOL_IOPS ? parseInt(process.env.AVALANCHE_RPC_DATA_VOL_IOPS) : 3000,
            throughput: process.env.AVALANCHE_RPC_DATA_VOL_THROUGHPUT ? parseInt(process.env.AVALANCHE_RPC_DATA_VOL_THROUGHPUT) : 250,
        }
    ],
};

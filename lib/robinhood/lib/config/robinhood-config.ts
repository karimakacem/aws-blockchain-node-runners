import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as configTypes from "./robinhood-config.interface";
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

export const baseConfig: configTypes.RobinhoodBaseConfig = {
    accountId: process.env.AWS_ACCOUNT_ID || "xxxxxxxxxxx",
    region: process.env.AWS_REGION || "us-east-1",
    network: <configTypes.RobinhoodNetwork>process.env.ROBINHOOD_NETWORK || "robinhood-testnet",
    nodeType: <configTypes.RobinhoodNodeType>process.env.ROBINHOOD_NODE_TYPE || "full",
    nitroVersion: process.env.NITRO_VERSION || "v3.2.1-d81324d",
    // Ethereum Sepolia L1 endpoints (required for Robinhood Chain testnet)
    l1RpcUrl: process.env.L1_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    l1BeaconUrl: process.env.L1_BEACON_URL || "https://ethereum-sepolia-beacon-api.publicnode.com",
    rpcPort: process.env.ROBINHOOD_RPC_PORT ? parseInt(process.env.ROBINHOOD_RPC_PORT) : 8547,
    wsPort: process.env.ROBINHOOD_WS_PORT ? parseInt(process.env.ROBINHOOD_WS_PORT) : 8548,
    metricsPort: process.env.ROBINHOOD_METRICS_PORT ? parseInt(process.env.ROBINHOOD_METRICS_PORT) : 6070,
    chainId: 46630, // Robinhood Chain Sepolia testnet
    sequencerUrl: "https://sequencer.testnet.chain.robinhood.com",
    feedUrl: "wss://feed.testnet.chain.robinhood.com",
};

export const singleNodeConfig: configTypes.RobinhoodSingleNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ROBINHOOD_SINGLE_NODE_INSTANCE_TYPE || "m6i.2xlarge"),
    instanceCpuType: process.env.ROBINHOOD_SINGLE_NODE_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    dataVolumes: [
        {
            sizeGiB: process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_SIZE ? parseInt(process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_IOPS ? parseInt(process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_IOPS) : 5000,
            throughput: process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_THROUGHPUT ? parseInt(process.env.ROBINHOOD_SINGLE_NODE_DATA_VOL_THROUGHPUT) : 500,
        }
    ]
};

export const rpcNodeConfig: configTypes.RobinhoodRpcNodeConfig = {
    instanceType: new ec2.InstanceType(process.env.ROBINHOOD_RPC_INSTANCE_TYPE || "m6i.2xlarge"),
    instanceCpuType: process.env.ROBINHOOD_RPC_CPU_TYPE?.toLowerCase() == "x86_64" ? ec2.AmazonLinuxCpuType.X86_64 : ec2.AmazonLinuxCpuType.ARM_64,
    numberOfNodes: process.env.ROBINHOOD_RPC_NUMBER_OF_NODES ? parseInt(process.env.ROBINHOOD_RPC_NUMBER_OF_NODES) : 2,
    albHealthCheckGracePeriodMin: process.env.ROBINHOOD_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN ? parseInt(process.env.ROBINHOOD_RPC_ALB_HEALTHCHECK_GRACE_PERIOD_MIN) : 30,
    heartBeatDelayMin: process.env.ROBINHOOD_RPC_HA_NODES_HEARTBEAT_DELAY_MIN ? parseInt(process.env.ROBINHOOD_RPC_HA_NODES_HEARTBEAT_DELAY_MIN) : 120,
    dataVolumes: [
        {
            sizeGiB: process.env.ROBINHOOD_RPC_DATA_VOL_SIZE ? parseInt(process.env.ROBINHOOD_RPC_DATA_VOL_SIZE) : 1000,
            type: parseDataVolumeType(process.env.ROBINHOOD_RPC_DATA_VOL_TYPE?.toLowerCase() || "gp3"),
            iops: process.env.ROBINHOOD_RPC_DATA_VOL_IOPS ? parseInt(process.env.ROBINHOOD_RPC_DATA_VOL_IOPS) : 5000,
            throughput: process.env.ROBINHOOD_RPC_DATA_VOL_THROUGHPUT ? parseInt(process.env.ROBINHOOD_RPC_DATA_VOL_THROUGHPUT) : 500,
        }
    ],
};

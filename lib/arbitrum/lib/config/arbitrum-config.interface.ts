import * as configTypes from "../../../constructs/config.interface";

export type ArbitrumNetwork = "arb1" | "nova" | "sepolia-rollup";
export type ArbitrumNodeType = "full" | "archive";
export type ArbitrumSnapshotType = "pruned" | "archive" | "genesis" | "none";
export type ArbitrumDataVolumeConfig = configTypes.DataVolumeConfig;

export interface ArbitrumBaseConfig extends configTypes.BaseConfig {
    network: ArbitrumNetwork;
    nodeType: ArbitrumNodeType;
    snapshotType: ArbitrumSnapshotType;
    nitroVersion: string;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
}

export interface ArbitrumSingleNodeConfig extends configTypes.SingleNodeConfig {
}

export interface ArbitrumRpcNodeConfig extends configTypes.HaNodesConfig {
}

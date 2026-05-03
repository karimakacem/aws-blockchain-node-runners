import * as configTypes from "../../../constructs/config.interface";

export type ArcNetwork = "testnet";
export type ArcNodeRole = "sync-node" | "rpc-node" | "single-node";

export interface ArcDataVolumeConfig extends configTypes.DataVolumeConfig {
}

export interface ArcBaseConfig extends configTypes.BaseConfig {
    network: ArcNetwork;
    arcVersion: string;
    snapshotDownload: boolean;
    executionRpcPort: number;
    executionWsPort: number;
    executionMetricsPort: number;
    consensusRpcPort: number;
    consensusMetricsPort: number;
}

export interface ArcSyncNodeConfig extends configTypes.SingleNodeConfig {
}

export interface ArcRpcNodeConfig extends configTypes.HaNodesConfig {
}

import * as configTypes from "../../../constructs/config.interface";

export type AvalancheNetwork = "mainnet" | "fuji";
export type AvalancheNodeType = "full" | "validator" | "api";
export type AvalancheNodeRole = "sync-node" | "single-node" | "rpc-node";
export type SnapshotType = "s3" | "none";

export interface AvalancheBaseConfig extends configTypes.BaseConfig {
    network: AvalancheNetwork;
    nodeType: AvalancheNodeType;
    snapshotType: SnapshotType;
    avalanchegoVersion: string;
    httpPort: number;
    stakingPort: number;
}

export interface AvalancheSyncNodeConfig extends configTypes.SingleNodeConfig {
}

export interface AvalancheSingleNodeConfig extends configTypes.SingleNodeConfig {
}

export interface AvalancheRpcNodeConfig extends configTypes.HaNodesConfig {
}

import * as configTypes from "../../../constructs/config.interface";

export type RobinhoodNetwork = "robinhood-testnet";
export type RobinhoodNodeType = "full" | "archive";
export type RobinhoodDataVolumeConfig = configTypes.DataVolumeConfig;

export interface RobinhoodBaseConfig extends configTypes.BaseConfig {
    network: RobinhoodNetwork;
    nodeType: RobinhoodNodeType;
    nitroVersion: string;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
    chainId: number;
    sequencerUrl: string;
    feedUrl: string;
}

export interface RobinhoodSingleNodeConfig extends configTypes.SingleNodeConfig {
}

export interface RobinhoodRpcNodeConfig extends configTypes.HaNodesConfig {
}

#!/usr/bin/env node
import 'dotenv/config'
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as nag from "cdk-nag";
import * as config from "./lib/config/arbitrum-config";

import { ArbitrumOneSingleNodeStack } from "./lib/arbitrum-one-single-node-stack";
import { ArbitrumOneRpcNodesStack } from "./lib/arbitrum-one-rpc-nodes-stack";
import { ArbitrumNovaSingleNodeStack } from "./lib/arbitrum-nova-single-node-stack";
import { ArbitrumNovaRpcNodesStack } from "./lib/arbitrum-nova-rpc-nodes-stack";
import { ArbitrumCommonStack } from "./lib/common-stack";

const app = new cdk.App();

// Deploy stacks based on configured network
const network = config.baseConfig.network;

// Human-readable network suffix for stack names (arb1 = mainnet, nova = mainnet, sepolia-rollup = sepolia)
const networkSuffix: Record<string, string> = {
    "arb1": "mainnet",
    "nova": "mainnet",
    "sepolia-rollup": "sepolia",
};
const suffix = networkSuffix[network] ?? network;

if (network === "arb1") {
    cdk.Tags.of(app).add("Project", "AWSArbitrumOne");

    // Common stack with shared resources for Arbitrum One
    new ArbitrumCommonStack(app, "arbitrum-one-common", {
        stackName: `arbitrum-one-common-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        network: "arb1",
    });

    // Single node stack for Arbitrum One
    new ArbitrumOneSingleNodeStack(app, "arbitrum-one-single-node", {
        stackName: `arbitrum-one-single-node-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        instanceType: config.singleNodeConfig.instanceType,
        instanceCpuType: config.singleNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        nitroVersion: config.baseConfig.nitroVersion,
        snapshotType: config.baseConfig.snapshotType,
        l1RpcUrl: config.baseConfig.l1RpcUrl,
        l1BeaconUrl: config.baseConfig.l1BeaconUrl,
        dataVolume: config.singleNodeConfig.dataVolumes[0],
        rpcPort: config.baseConfig.rpcPort,
        wsPort: config.baseConfig.wsPort,
        metricsPort: config.baseConfig.metricsPort,
    });

    // HA RPC nodes stack for Arbitrum One
    new ArbitrumOneRpcNodesStack(app, "arbitrum-one-rpc-nodes", {
        stackName: `arbitrum-one-rpc-nodes-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        instanceType: config.rpcNodeConfig.instanceType,
        instanceCpuType: config.rpcNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        nitroVersion: config.baseConfig.nitroVersion,
        snapshotType: config.baseConfig.snapshotType,
        l1RpcUrl: config.baseConfig.l1RpcUrl,
        l1BeaconUrl: config.baseConfig.l1BeaconUrl,
        dataVolume: config.rpcNodeConfig.dataVolumes[0],
        rpcPort: config.baseConfig.rpcPort,
        wsPort: config.baseConfig.wsPort,
        metricsPort: config.baseConfig.metricsPort,
        numberOfNodes: config.rpcNodeConfig.numberOfNodes,
        albHealthCheckGracePeriodMin: config.rpcNodeConfig.albHealthCheckGracePeriodMin,
        heartBeatDelayMin: config.rpcNodeConfig.heartBeatDelayMin,
    });

} else if (network === "nova") {
    cdk.Tags.of(app).add("Project", "AWSArbitrumNova");

    // Common stack with shared resources for Arbitrum Nova
    new ArbitrumCommonStack(app, "arbitrum-nova-common", {
        stackName: `arbitrum-nova-common-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        network: "nova",
    });

    // Single node stack for Arbitrum Nova
    new ArbitrumNovaSingleNodeStack(app, "arbitrum-nova-single-node", {
        stackName: `arbitrum-nova-single-node-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        instanceType: config.singleNodeConfig.instanceType,
        instanceCpuType: config.singleNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        nitroVersion: config.baseConfig.nitroVersion,
        snapshotType: config.baseConfig.snapshotType,
        l1RpcUrl: config.baseConfig.l1RpcUrl,
        l1BeaconUrl: config.baseConfig.l1BeaconUrl,
        dataVolume: config.singleNodeConfig.dataVolumes[0],
        rpcPort: config.baseConfig.rpcPort,
        wsPort: config.baseConfig.wsPort,
        metricsPort: config.baseConfig.metricsPort,
    });

    // HA RPC nodes stack for Arbitrum Nova
    new ArbitrumNovaRpcNodesStack(app, "arbitrum-nova-rpc-nodes", {
        stackName: `arbitrum-nova-rpc-nodes-${suffix}`,
        env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
        instanceType: config.rpcNodeConfig.instanceType,
        instanceCpuType: config.rpcNodeConfig.instanceCpuType,
        network: config.baseConfig.network,
        nitroVersion: config.baseConfig.nitroVersion,
        snapshotType: config.baseConfig.snapshotType,
        l1RpcUrl: config.baseConfig.l1RpcUrl,
        l1BeaconUrl: config.baseConfig.l1BeaconUrl,
        dataVolume: config.rpcNodeConfig.dataVolumes[0],
        rpcPort: config.baseConfig.rpcPort,
        wsPort: config.baseConfig.wsPort,
        metricsPort: config.baseConfig.metricsPort,
        numberOfNodes: config.rpcNodeConfig.numberOfNodes,
        albHealthCheckGracePeriodMin: config.rpcNodeConfig.albHealthCheckGracePeriodMin,
        heartBeatDelayMin: config.rpcNodeConfig.heartBeatDelayMin,
    });

} else {
    throw new Error(`Unsupported network: ${network}. Supported networks: arb1, nova`);
}

// Security Check
cdk.Aspects.of(app).add(
    new nag.AwsSolutionsChecks({
        verbose: false,
        reports: true,
        logIgnores: false,
    })
);

app.synth();

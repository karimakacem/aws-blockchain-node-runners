#!/usr/bin/env node
import 'dotenv/config'
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as nag from "cdk-nag";
import * as config from "./lib/config/robinhood-config";

import { RobinhoodSingleNodeStack } from "./lib/single-node-stack";
import { RobinhoodRpcNodesStack } from "./lib/rpc-nodes-stack";
import { RobinhoodCommonStack } from "./lib/common-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("Project", "AWSRobinhoodChain");

// Common stack with shared resources
new RobinhoodCommonStack(app, "robinhood-common", {
    stackName: `robinhood-common`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
});

// Single node stack for Robinhood Chain
new RobinhoodSingleNodeStack(app, "robinhood-single-node", {
    stackName: `robinhood-single-node`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.singleNodeConfig.instanceType,
    instanceCpuType: config.singleNodeConfig.instanceCpuType,
    network: config.baseConfig.network,
    nitroVersion: config.baseConfig.nitroVersion,
    l1RpcUrl: config.baseConfig.l1RpcUrl,
    l1BeaconUrl: config.baseConfig.l1BeaconUrl,
    dataVolume: config.singleNodeConfig.dataVolumes[0],
    rpcPort: config.baseConfig.rpcPort,
    wsPort: config.baseConfig.wsPort,
    metricsPort: config.baseConfig.metricsPort,
    chainId: config.baseConfig.chainId,
    sequencerUrl: config.baseConfig.sequencerUrl,
    feedUrl: config.baseConfig.feedUrl,
});

// HA RPC nodes stack for Robinhood Chain
new RobinhoodRpcNodesStack(app, "robinhood-rpc-nodes", {
    stackName: `robinhood-rpc-nodes`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.rpcNodeConfig.instanceType,
    instanceCpuType: config.rpcNodeConfig.instanceCpuType,
    network: config.baseConfig.network,
    nitroVersion: config.baseConfig.nitroVersion,
    l1RpcUrl: config.baseConfig.l1RpcUrl,
    l1BeaconUrl: config.baseConfig.l1BeaconUrl,
    dataVolume: config.rpcNodeConfig.dataVolumes[0],
    rpcPort: config.baseConfig.rpcPort,
    wsPort: config.baseConfig.wsPort,
    metricsPort: config.baseConfig.metricsPort,
    chainId: config.baseConfig.chainId,
    sequencerUrl: config.baseConfig.sequencerUrl,
    feedUrl: config.baseConfig.feedUrl,
    numberOfNodes: config.rpcNodeConfig.numberOfNodes,
    albHealthCheckGracePeriodMin: config.rpcNodeConfig.albHealthCheckGracePeriodMin,
    heartBeatDelayMin: config.rpcNodeConfig.heartBeatDelayMin,
});

// Security Check
cdk.Aspects.of(app).add(
    new nag.AwsSolutionsChecks({
        verbose: false,
        reports: true,
        logIgnores: false,
    })
);

app.synth();

#!/usr/bin/env node
import 'dotenv/config'
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as nag from "cdk-nag";
import * as config from "./lib/config/avalanche-config";

import { AvalancheSingleNodeStack } from "./lib/single-node-stack";
import { AvalancheSyncNodeStack } from "./lib/sync-node-stack";
import { AvalancheRpcNodesStack } from "./lib/rpc-nodes-stack";
import { AvalancheCommonStack } from "./lib/common-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("Project", "AWSAvalanche");

// Common stack with shared resources
new AvalancheCommonStack(app, "avalanche-common", {
    stackName: `avalanche-nodes-common`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    snapshotType: config.baseConfig.snapshotType,
});

// Sync node stack - keeps blockchain synced and uploads snapshots to S3
new AvalancheSyncNodeStack(app, "avalanche-sync-node", {
    stackName: `avalanche-sync-node-${config.baseConfig.network}`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.syncNodeConfig.instanceType,
    instanceCpuType: config.syncNodeConfig.instanceCpuType,
    avalancheNetwork: config.baseConfig.network,
    avalanchegoVersion: config.baseConfig.avalanchegoVersion,
    nodeType: config.baseConfig.nodeType,
    snapshotType: config.baseConfig.snapshotType,
    dataVolume: config.syncNodeConfig.dataVolumes[0],
    httpPort: config.baseConfig.httpPort,
    stakingPort: config.baseConfig.stakingPort,
});

// Single node stack - standalone node (no HA)
new AvalancheSingleNodeStack(app, "avalanche-single-node", {
    stackName: `avalanche-single-node-${config.baseConfig.network}`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.singleNodeConfig.instanceType,
    instanceCpuType: config.singleNodeConfig.instanceCpuType,
    avalancheNetwork: config.baseConfig.network,
    avalanchegoVersion: config.baseConfig.avalanchegoVersion,
    nodeType: config.baseConfig.nodeType,
    dataVolume: config.singleNodeConfig.dataVolumes[0],
    httpPort: config.baseConfig.httpPort,
    stakingPort: config.baseConfig.stakingPort,
});

// HA RPC nodes stack - multiple nodes behind ALB, restore from S3 snapshots
new AvalancheRpcNodesStack(app, "avalanche-rpc-nodes", {
    stackName: `avalanche-rpc-nodes-${config.baseConfig.network}`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.rpcNodeConfig.instanceType,
    instanceCpuType: config.rpcNodeConfig.instanceCpuType,
    avalancheNetwork: config.baseConfig.network,
    avalanchegoVersion: config.baseConfig.avalanchegoVersion,
    nodeType: config.baseConfig.nodeType,
    snapshotType: config.baseConfig.snapshotType,
    dataVolume: config.rpcNodeConfig.dataVolumes[0],
    httpPort: config.baseConfig.httpPort,
    stakingPort: config.baseConfig.stakingPort,
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

#!/usr/bin/env node
import 'dotenv/config'
import 'source-map-support/register';
import * as cdk from "aws-cdk-lib";
import * as nag from "cdk-nag";
import * as config from "./lib/config/arc-config";
import { ArcCommonStack } from "./lib/common-stack";
import { ArcSingleNodeStack } from "./lib/single-node-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("Project", "CircleARC");

new ArcCommonStack(app, "arc-common", {
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
});

new ArcSingleNodeStack(app, "arc-single-node", {
    stackName: `arc-single-node-${config.baseConfig.network}`,
    env: { account: config.baseConfig.accountId, region: config.baseConfig.region },
    instanceType: config.syncNodeConfig.instanceType,
    instanceCpuType: config.syncNodeConfig.instanceCpuType,
    network: config.baseConfig.network,
    arcVersion: config.baseConfig.arcVersion,
    snapshotDownload: config.baseConfig.snapshotDownload,
    dataVolume: config.syncNodeConfig.dataVolumes[0],
    executionRpcPort: config.baseConfig.executionRpcPort,
    executionWsPort: config.baseConfig.executionWsPort,
    executionMetricsPort: config.baseConfig.executionMetricsPort,
    consensusRpcPort: config.baseConfig.consensusRpcPort,
    consensusMetricsPort: config.baseConfig.consensusMetricsPort,
});

// Security checks
cdk.Aspects.of(app).add(new nag.AwsSolutionsChecks({ verbose: false }));

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AvalancheNodeStack } from '../lib/avalanche-node-stack';
import { avalancheNodeDefaultConfig } from '../lib/avalanche-node-config';

const app = new cdk.App();

new AvalancheNodeStack(app, 'AvalancheNodeStack', {
  config: avalancheNodeDefaultConfig,
  availabilityZone: 'us-east-1a',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

app.synth();




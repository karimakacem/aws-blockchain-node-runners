# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AWS Blockchain Node Runners is a collection of CDK applications (Node Runner Blueprints) for deploying self-service blockchain nodes on AWS. Each blueprint in `lib/<chain-name>/` is an independent CDK application for a specific blockchain protocol (Ethereum, Solana, Avalanche, etc.).

## Architecture Pattern

Blueprints follow two main deployment patterns:

1. **Single Node**: Single EC2 instance for PoC/development (`single-node-stack.ts`)
2. **Highly Available**: Multiple nodes behind ALB with S3-backed state synchronization (`rpc-nodes-stack.ts`, `common-stack.ts`)

In HA setups:
- Sync nodes periodically backup state to S3 using s5cmd
- RPC nodes restore from S3 on initialization for faster sync
- Auto Scaling Groups manage node lifecycle
- Application Load Balancer distributes traffic to healthy RPC nodes

## Project Structure

- `lib/constructs/` - Reusable CDK constructs shared across blueprints:
  - `single-node.ts` - Creates single EC2 instance
  - `ha-rpc-nodes-with-alb.ts` - Creates ASG with up to 4 nodes behind ALB
  - `snapshots-bucket.ts` - S3 bucket for node state backups
  - `config.interface.ts` - Configuration interfaces for node configs
  - `constants.ts` - Common constants (instance types, AMIs, etc.)

- `lib/<chain-name>/` - Individual blockchain node blueprints, each containing:
  - `app.ts` - CDK application entry point
  - `cdk.json` - CDK feature flags and configuration
  - `lib/` - CDK stacks and constructs
  - `lib/assets/` - Resources deployed to EC2 (user-data scripts, docker-compose files)
  - `lib/config/` - Configuration parser for `.env` files
  - `sample-configs/` - Sample `.env` files for different client combinations
  - `test/` - Jest unit tests using `.env-test` configuration
  - `README.md` - Blueprint-specific deployment instructions

## Development Commands

### Testing a specific blueprint
```bash
cd lib/<chain-name>
cp sample-configs/.env-<client-combo> .env
# Edit .env with your AWS account ID and preferences
npm install  # if not already done at root
npx cdk diff
npx cdk synth
```

### Running tests for a blueprint
```bash
cd lib/<chain-name>
npm test
```

### Deploying a blueprint
```bash
cd lib/<chain-name>
npx cdk deploy <stack-name>
# Common stack names: *-common, *-single-node, *-rpc-nodes
```

### Destroying a blueprint
```bash
cd lib/<chain-name>
npx cdk destroy <stack-name>
```

### Root-level quality checks
```bash
# Security scanning (run before commits)
npm run scan-repo-git-secrets
npm run scan-semgrep
npm run run-pre-commit

# Setup tools (macOS)
npm run install-git-secrets-mac
npm run install-semgrep-mac
npm run install-pre-commit-mac
```

## Configuration

Each blueprint uses a `.env` file (git-ignored) for configuration. Pattern:
1. Copy a sample config: `cp sample-configs/.env-<option> .env`
2. Set `AWS_ACCOUNT_ID` and `AWS_REGION`
3. Adjust instance types, storage, network settings
4. Configuration is parsed by `lib/config/` modules implementing `config.interface.ts`

Common config parameters:
- `STACK_NAME` / `STACK_PREFIX`
- Instance type and CPU type (Graviton vs x86)
- Data volume size, IOPS, throughput
- Client-specific options (consensus/execution clients for Ethereum, etc.)
- Snapshot URLs for faster sync

## Adding a New Blueprint

1. Check [Issues](https://github.com/aws-samples/aws-blockchain-node-runners/issues) for existing work
2. Create feature request issue
3. Use existing blueprint as template (choose architecturally similar chain)
4. Follow structure in `docs/adding-new-nodes.md`:
   - Create `lib/<chain-name>/` with standard directory structure
   - Implement config parser extending `config.interface.ts`
   - Create stacks using reusable constructs from `lib/constructs/`
   - Add user-data scripts in `lib/assets/`
   - Write unit tests with `.env-test`
   - Document in `README.md` and `website/docs/`
5. Use `cdk-nag` for security compliance checks (see `app.ts` examples)
6. Run pre-commit checks before submitting PR

## CDK Best Practices in This Repo

- Each blueprint uses `cdk-nag` with `AwsSolutionsChecks` for security validation
- Graviton instances (m7g, etc.) preferred for cost-efficiency
- gp3 EBS volumes with optimized IOPS/throughput
- IAM roles (not users) with least-privilege policies
- Systems Manager Session Manager instead of SSH
- Encrypted EBS volumes and S3 buckets (SSE-S3)
- CloudWatch dashboards and custom metrics via CloudWatch Agent
- Pre-commit hooks enforce git-secrets and semgrep scans

## Testing Strategy

Tests use Jest with environment from `test/.env-test`:
- `common-stack.test.ts` - S3 bucket, IAM resources
- `single-node-stack.test.ts` - Single node infrastructure
- `rpc-nodes-stack.test.ts` - HA setup with ALB, ASG

Run tests before committing changes to stacks.

## Common Pitfall

Each blueprint is an independent CDK app. You must `cd lib/<chain-name>` before running `cdk` commands. Running `cdk` from repo root will fail - there is no top-level CDK app.

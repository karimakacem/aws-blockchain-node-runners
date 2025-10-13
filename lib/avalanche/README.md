# AWS Avalanche Node Runner

This solution helps you deploy Avalanche blockchain nodes on AWS using AWS CDK.

## Architecture

The solution deploys:
- EC2 instance running AvalancheGo
- EBS volume for blockchain data storage
- Security groups for network access
- CloudWatch logging
- IAM roles with minimal permissions

## Prerequisites

- AWS CLI configured
- Node.js 16+ and npm
- AWS CDK v2 installed
- Sufficient AWS permissions

## Quick Start

1. **Configure your deployment:**
   ```bash
   cp sample-configs/avalanche-mainnet.yaml my-config.yaml
   # Edit my-config.yaml with your preferences

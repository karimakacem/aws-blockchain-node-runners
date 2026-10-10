# Sample AWS Blockchain Node Runner app for Robinhood Chain

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

Robinhood Chain is an [Arbitrum](https://arbitrum.io/) chain (Orbit L2) running
[Arbitrum Nitro](https://github.com/OffchainLabs/nitro). This blueprint deploys
a Robinhood Chain full node on AWS, on either **mainnet** (chain ID `4663`,
settling to Ethereum mainnet) or **testnet** (chain ID `46630`, settling to
Ethereum Sepolia).

> This blueprint deploys an RPC full node. It does **not** configure a validator
> (Robinhood Chain validators use BoLD and a permissioned allowlist).

## Overview of Deployment Architectures

### Single Node

A single EC2 instance runs the `offchainlabs/nitro-node` container (host
networking) with an EBS `gp3` data volume mounted at `/data`. RPC/WS/metrics
bind to the instance's internal IP; the node reaches its parent chain through
the L1 execution + beacon endpoints you provide. Good for development and
testing.

### Highly Available (HA) Nodes

Multiple nodes run behind an internal Application Load Balancer in an Auto
Scaling Group. The ALB health-checks each node's RPC port and routes only to
healthy, synced nodes. Suitable for production RPC serving.

## Supported Configurations

| Option | Value |
|---|---|
| Client | Arbitrum Nitro (`offchainlabs/nitro-node:v3.11.5-7d41882`) |
| Networks | `mainnet` (4663), `testnet` (46630) |
| Deployment modes | `single-node`, `ha-nodes` |
| Default configuration | `nitro-v3.11.5-full.yml` |

## Infrastructure Requirements

| Resource | Recommendation |
|---|---|
| Instance (x86_64) | `m6i.2xlarge` (8 vCPU, 32 GB) — step up to `m6i.4xlarge` for heavier mainnet load (Robinhood docs recommend 64 GB+ RAM for mainnet) |
| Instance (ARM_64) | `m7g.2xlarge` |
| Storage | `gp3`, 1000 GiB (grow for archive / long-running mainnet) |
| Ports | 8547 (RPC), 8548 (WS), 6070 (metrics) — all VPC-internal |

### Prerequisites

- An Ethereum L1 **execution RPC** endpoint and an L1 **beacon** endpoint for
  the matching network (Ethereum mainnet for `mainnet`, Sepolia for `testnet`).
  Public endpoints are rate-limited; use a paid provider for production.
- **Testnet only:** the node starts a local *blob proxy* that falls back to
  Blockscout's indefinite Sepolia blob archive, so any Sepolia beacon endpoint
  works — you do **not** need an archive beacon node. Mainnet talks to its
  Ethereum-mainnet beacon directly and runs no proxy.

> **Tip:** run the deployment commands from AWS CloudShell, which already has
> AWS credentials and the required tooling.

## Setup Instructions

> For general setup (clone, install, bootstrap), follow the main repository
> [README](../../README.md).

### Step 1: Configure Environment

```bash
cp blueprints/robinhood/samples/.env-testnet-nitro-full .env
# Edit AWS_ACCOUNT_ID, AWS_REGION, and the ROBINHOOD_L1_* endpoints
```

### Step 2: Choose Configuration

| Sample | Network | Mode |
|---|---|---|
| `.env-testnet-nitro-full` | testnet | single-node |
| `.env-mainnet-nitro-full` | mainnet | single-node |
| `.env-mainnet-nitro-full-ha` | mainnet | ha-nodes |

### Step 3: Deploy

```bash
npx cdk deploy --json --outputs-file deploy-output.json
```

> **AI Alternative:** you can also deploy with the `@deploy` AI prompt, which
> reads your `.env` and runs the deployment workflow for you.

### Step 4: Monitor Deployment

```bash
export INSTANCE_ID=$(jq -r '..|.InstanceId? | select(. != null)' deploy-output.json)
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION"
sudo systemctl status node
sudo journalctl -u node -f
```

### Step 5: Verify Node Operation

```bash
# From the instance (RPC binds to the internal IP):
IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
  "http://$IP:8547"
# A fully synced node returns {"result":false}.
```

## Configuration Options

| Variable | Description | Default |
|---|---|---|
| `BC_NETWORK` | `mainnet` or `testnet` | — |
| `ROBINHOOD_L1_RPC_URL` | Ethereum L1 execution RPC (required) | — |
| `ROBINHOOD_L1_BEACON_URL` | Ethereum L1 beacon API (required) | — |
| `ROBINHOOD_RPC_PORT` | JSON-RPC port | `8547` |
| `ROBINHOOD_WS_PORT` | WebSocket port | `8548` |
| `ROBINHOOD_METRICS_PORT` | Metrics port | `6070` |

On `mainnet` the node subscribes to both the primary feed and the delayed
backup feed (`wss://feed.mainnet…` + `wss://delayed-feed.mainnet…`) for
resilience; on `testnet` it uses the single testnet feed.

## Database Snapshots

Robinhood Chain is an Arbitrum Nitro chain, so a new node can be seeded from an
Arbitrum **Nitro database snapshot** instead of syncing from the parent chain.
These are published through Arbitrum's generic snapshot tooling
([snapshot-explorer.arbitrum.io](https://snapshot-explorer.arbitrum.io/),
[Nitro database snapshots](https://docs.arbitrum.io/run-arbitrum-node/nitro/nitro-database-snapshots)),
not as a single HTTPS archive, so this blueprint ships with `SNAPSHOT_ENABLED="false"`.
To seed from a snapshot, download and extract it into `/data/nitro` before the
`node` service first starts.

## Troubleshooting

Primary diagnostics are in CloudWatch Logs and `journalctl`.

- **Node not starting:** `sudo journalctl -u node -n 200`. Check the L1
  endpoints are reachable and not placeholders.
- **Testnet blob errors / stuck sync:** check the proxy —
  `sudo journalctl -u blob-proxy -n 100`.
- **Metrics not appearing:** confirm the node is up and `ROBINHOOD_METRICS_PORT`
  (6070) is being scraped.
- **Health check failures (HA):** the ALB checks RPC port 8547; a node still
  doing initial sync is intentionally unhealthy until caught up.

See the main [Troubleshooting Guide](../../docs/troubleshooting.md) for more.

## Upgrades

- **Upgrade the Nitro client:** bump `nitro_image` in
  `configurations/nitro-v3.11.5-full.yml` (rename the file to the new version)
  via the `@version-update` workflow, then redeploy.
- **Rolling updates (HA):** replace instances one at a time through the Auto
  Scaling Group so RPC capacity is preserved.

## Cost Optimization

- **Storage:** start at 1000 GiB `gp3`; grow as the chain does rather than
  over-provisioning up front.
- **Compute:** use the ARM_64 option (`m7g.2xlarge`) for a lower price/perf
  point; right-size after observing real load.
- **Network:** keep the ALB internal unless you must expose RPC publicly.

## Security Considerations

- RPC, WS, and metrics bind to the instance's internal IP (never `0.0.0.0`); the
  blob proxy binds to `127.0.0.1`.
- The node runs as the non-root `bcuser` (UID/GID 1002).
- The default ALB is internal and restricted to the VPC CIDR; exposing it to the
  internet requires explicitly setting `HA_ALB_INTERNET_FACING` **and**
  `HA_ALB_ALLOWED_CIDR`.
- The Nitro image is pinned to an immutable tag; `node.sh` refuses `latest`.

## FAQ

**Can I run a validator?** No — this blueprint deploys an RPC full node.
Robinhood Chain validators use BoLD and a permissioned allowlist.

**Do I need an archive beacon node for testnet?** No. The local blob proxy
serves archived Sepolia blobs from Blockscout, so any Sepolia beacon works.

**Does mainnet need the blob proxy?** No. It is testnet-only and `node.sh`
starts it only when `BC_NETWORK=testnet`.

## Additional Resources

- [Robinhood Chain — Run a full node](https://docs.robinhood.com/chain/run-a-full-node)
- [Robinhood Chain docs](https://docs.robinhood.com/chain)
- [Arbitrum Nitro](https://github.com/OffchainLabs/nitro)

## Support

Open an issue in the [aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners) repository.

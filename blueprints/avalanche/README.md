# Sample AWS Blockchain Node Runner app for Avalanche

| Contributed by |
|:--------------------:|
| [@karimakacem](https://github.com/karimakacem) |

[Avalanche](https://www.avax.network/) is a proof-of-stake network whose
Primary Network runs three chains: the P-Chain (staking and L1 management), the
X-Chain (asset exchange) and the C-Chain (the EVM chain). This blueprint deploys
an [AvalancheGo](https://github.com/ava-labs/avalanchego) full node on AWS on
either **mainnet** or the **Fuji** testnet and serves the C/P/X-Chain APIs
inside your VPC.

> This blueprint deploys a **non-validator** full node for RPC use. It does not
> stake or register a validator. AvalancheGo still generates a staking TLS key
> and a BLS signer key on first start, because every node needs a NodeID to
> talk to peers.

## Overview of Deployment Architectures

### Single Node

A single EC2 instance runs the `avaplatform/avalanchego` container (host
networking) as the systemd `node` service, with the instance's local NVMe
instance store mounted at `/data`. The HTTP API (port 9650) binds to the
instance's internal IP; the staking/P2P port (9651) is open to the internet so
peers can reach the node. Good for development, testing and light RPC use.

### Highly Available (HA) Nodes

Multiple nodes run in an Auto Scaling Group behind an internal Application Load
Balancer. The ALB health-checks `GET /ext/health` on port 9650 and routes only
to nodes that have finished bootstrapping all three chains. Suitable for
production RPC serving.

## Supported Configurations

| Option | Value |
|---|---|
| Client | AvalancheGo `v1.15.1` (`avaplatform/avalanchego:v1.15.1`, linux/amd64 + linux/arm64) |
| Networks | `mainnet`, `fuji` |
| Deployment modes | `single-node`, `ha-nodes` |
| Default configuration | `avalanchego-v1.15.1-full.yml` |

v1.15.x is the Helicon release line. Helicon is active on Fuji (since
2026-07-28) and mainnet (since 2026-09-22), and nodes on both networks must run
v1.15.0 or later.

## Infrastructure Requirements

[ACP-256](https://build.avax.network/docs/acps/256-hardware-recommendations)
sets the minimum for Primary Network nodes at 8 vCPU, 16 GB RAM and 1 TB of
**local NVMe** storage, and says non-validator (RPC) nodes should use local
NVMe rather than network-attached disks such as EBS. The samples therefore use
NVMe instance-store instance types.

| Sample | Instance | vCPU / RAM | Data disk (local NVMe) |
|---|---|---|---|
| Mainnet, x86_64 (single + HA) | `i7i.2xlarge` | 8 / 64 GB | 1875 GB |
| Mainnet, ARM_64 | `i8g.2xlarge` | 8 / 64 GB | 1875 GB |
| Fuji, x86_64 | `i7i.xlarge` | 4 / 32 GB | 937 GB |

| Resource | Value |
|---|---|
| Disk after state sync (mainnet) | ~500 GB of active state |
| Disk growth | ~150-200 GB/month (state-sync snapshots kept every 4096 blocks) |
| Ports | 9650 TCP (HTTP API, VPC-internal), 9651 TCP (staking/P2P, public) |
| Network | Public IPv4 required; outbound all traffic |

At ~200 GB/month a 1875 GB mainnet disk fills in about 7 months. Since Helicon
the C-Chain has no offline pruning, so the remedy is a fresh state sync:
replace the instance (see [Upgrades](#upgrades)).

### Prerequisites

- An AWS account and region with quota for the chosen `i7i` / `i8g` instances.
- The node must launch in a public subnet with a public IPv4 address. The node
  advertises that address to peers, and `node.sh` refuses to start without one.

> **Tip:** run the deployment commands from AWS CloudShell, which already has
> AWS credentials and the required tooling.

## Setup Instructions

> For general setup (clone, install, bootstrap), follow the main repository
> [README](../../README.md).

### Step 1: Configure Environment

```bash
cp blueprints/avalanche/samples/.env-fuji-avalanchego-full .env
# Edit AWS_ACCOUNT_ID and AWS_REGION
```

### Step 2: Choose Configuration

| Sample | Network | Mode | CPU |
|---|---|---|---|
| `.env-fuji-avalanchego-full` | fuji | single-node | x86_64 |
| `.env-mainnet-avalanchego-full` | mainnet | single-node | x86_64 |
| `.env-mainnet-avalanchego-full-arm64` | mainnet | single-node | ARM_64 |
| `.env-mainnet-avalanchego-full-ha` | mainnet | ha-nodes | x86_64 |

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
# From the instance (the HTTP API binds to the internal IP):
IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)

# Bootstrapped? Ask for each chain: P, X and C.
for c in P X C; do
  curl -s -X POST -H 'content-type:application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"info.isBootstrapped\",\"params\":{\"chain\":\"$c\"}}" \
    "http://$IP:9650/ext/info"; echo
done

# Overall health: HTTP 200 when healthy, 503 while still bootstrapping.
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP:9650/ext/health"

# C-Chain JSON-RPC:
curl -s -X POST -H 'content-type:application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  "http://$IP:9650/ext/bc/C/rpc"
```

The C-Chain WebSocket endpoint is `ws://<ip>:9650/ext/bc/C/ws`.

## Configuration Options

| Variable | Description | Default |
|---|---|---|
| `BC_NETWORK` | `mainnet` or `fuji` | — |
| `CLIENT_CONFIG` | Configuration marker in `configurations/` | `avalanchego-v1.15.1-full.yml` |

The node has no protocol-specific `.env` variables. Its settings live in the
configuration marker `configurations/avalanchego-v1.15.1-full.yml`, which
`node.sh` reads to write two AvalancheGo config files under `/data/avalanchego`:

- `configs/node.json`: network id, HTTP bind (internal IP, port 9650),
  staking bind (`0.0.0.0:9651`), the public IP from IMDSv2, and API switches
  (admin off; info, health and metrics on; indexer off).
- `configs/chains/C/config.json`: `state-sync-enabled: true`,
  `pruning-enabled: true`, and the C-Chain JSON-RPC namespaces
  (`web3, net, txpool, price, chain, tx, subscription, avalanche`). The
  `trace` (`debug_trace*`) namespace is left out; add it to `c_chain_apis` in
  the marker if you need it.

Ports 9650 and 9651 are fixed because they must match `requiredPorts` in
`package.json`, which drives the security group and the HA ALB.

## Bootstrapping (no database snapshot)

There is no official AvalancheGo database snapshot, and this blueprint does not
download one. A fresh node bootstraps from peers:

- **C-Chain:** state sync (on by default on mainnet and Fuji) downloads the
  current state (~500 GB on mainnet) instead of replaying every block since
  genesis.
- **P-Chain and X-Chain:** bootstrap by fetching and executing their blocks
  from peers.

Avalanche documents 2-4 hours for a state-synced mainnet bootstrap; Fuji is
smaller. Expect more on a slow network path. A full sync from genesis
(archive, ~13 TB) is not covered by this blueprint.

Since Helicon (v1.15.0 release notes):

- Restarting the node during C-Chain state sync restarts the sync from the
  beginning.
- Disabling state sync after a partial state sync can end in an unrecoverable
  `FATAL` error; the only fix is to delete the database and restart. Leave
  `c_chain_state_sync_enabled` set to `true`.

`SNAPSHOT_ENABLED` (the framework's own S3 snapshot restore) stays `"false"`.

## Troubleshooting

Primary diagnostics are in CloudWatch Logs and `journalctl`. The container logs
to syslog under the tag `avalanchego`.

- **Node not starting:** `sudo journalctl -u node -n 200`, and
  `sudo journalctl -t avalanchego -n 200` for AvalancheGo's own output. A
  `no public IPv4 address` error from `node.sh` means the instance has no
  public IP; check the subnet's auto-assign setting.
- **Few or no peers / slow bootstrap:** confirm TCP 9651 is open inbound from
  the internet and that `public-ip` in `/data/avalanchego/configs/node.json`
  matches the instance's current public IP.
- **403 from the API:** the request's `Host` header is not allowed. `node.sh`
  sets `http-allowed-hosts` to `*`; check that the file was not edited.
- **Metrics not appearing:** metrics are served at
  `http://<internal-ip>:9650/ext/metrics` (Prometheus format).
- **Health check failures (HA):** `/ext/health` returns 503 until all chains
  have bootstrapped. A node still syncing when
  `HA_ALB_HEALTHCHECK_GRACE_PERIOD_MIN` (360 min in the sample) expires is
  replaced and starts over, so raise the grace period if bootstraps are slow.
  Read the response body for the failing check.
- **Disk filling up:** see [Upgrades](#upgrades) for the resync procedure.

See the main [Troubleshooting Guide](../../docs/troubleshooting.md) for more.

## Upgrades

- **Upgrade AvalancheGo:** bump `avalanchego_image` in
  `configurations/avalanchego-v1.15.1-full.yml` (rename the file to the new
  version) via the `@version-update` workflow, then redeploy. Watch the
  [release notes](https://github.com/ava-labs/avalanchego/releases) for
  mandatory network-upgrade deadlines.
- **Rolling updates (HA):** the Auto Scaling Group replaces instances one at a
  time. Each replacement starts with an empty instance store and bootstraps
  again (hours), so keep at least two nodes.
- **Reclaiming disk (resync):** replace the instance with a fresh one; it
  state-syncs to ~500 GB. On HA, terminate one node at a time and wait for its
  replacement to turn healthy.

## Cost Optimization

Approximate us-east-1 on-demand prices (2026-10):

| Instance | $/hour | ~$/month |
|---|---|---|
| `i7i.xlarge` (Fuji) | 0.3775 | ~276 |
| `i7i.2xlarge` (mainnet x86_64) | 0.755 | ~551 |
| `i8g.2xlarge` (mainnet ARM_64) | 0.6864 | ~501 |

- **Storage:** the instance store is included in the instance price; there is
  no separate EBS data-volume charge.
- **Compute:** the Graviton `i8g.2xlarge` costs ~9% less than `i7i.2xlarge`
  for the same vCPU, RAM and disk. Savings Plans lower both further.
- **Network:** P2P traffic on 9651 is billed as data transfer out; keep the ALB
  internal unless you must expose RPC publicly.

## Security Considerations

- The HTTP API (9650) binds to the instance's internal IP, never `0.0.0.0`, and
  the security group limits it to the VPC. The Admin API and the indexer are
  off; v1.15 has no keystore API, and the C-Chain `admin`/`personal`
  namespaces no longer exist.
- Only the staking/P2P port (9651) is public, as AvalancheGo requires.
- The container runs as the non-root `bcuser` (UID/GID 1002) with
  `no-new-privileges`.
- The AvalancheGo image is pinned to a release tag; `node.sh` refuses
  `latest`, `master` and untagged images.
- `/data/avalanchego/staking/` holds the node identity (`staker.key`,
  `staker.crt`, `signer.key`). These keys do not control funds, but anyone
  holding them can impersonate the node. `node.sh` never deletes or regenerates
  them. On instance store they are lost when the instance stops or is replaced,
  and the node comes back with a new NodeID, which is harmless for a
  non-validator.
- The default ALB is internal and restricted to the VPC CIDR; exposing it to the
  internet requires explicitly setting `HA_ALB_INTERNET_FACING` **and**
  `HA_ALB_ALLOWED_CIDR`.

## FAQ

**Can I run a validator with this blueprint?** No. It deploys a non-validator
RPC node. Validators need staked AVAX, a NodeID that persists across instance
replacements, and the key-handling procedures in the Avalanche docs.

**Why instance store instead of EBS?** ACP-256 recommends local NVMe for all
Primary Network nodes and says RPC nodes should not rely on network-attached
storage, because C-Chain throughput is limited by state access latency.

**Is there a snapshot to speed up the first sync?** No official one. State sync
already avoids replaying C-Chain history, which is what makes a from-genesis
sync slow.

**Does the NodeID matter?** Not for an RPC node. It changes whenever the
instance store is wiped.

## Additional Resources

- [AvalancheGo releases](https://github.com/ava-labs/avalanchego/releases)
- [Run AvalancheGo with Docker](https://build.avax.network/docs/nodes/run-a-node/using-docker)
- [System requirements](https://build.avax.network/docs/nodes/system-requirements)
- [Chain state management](https://build.avax.network/docs/nodes/node-storage/chain-state-management)
- [C-Chain config reference (v1.15.1)](https://github.com/ava-labs/avalanchego/blob/v1.15.1/vms/saevm/cchain/config.md)
- [AvalancheGo config flags (v1.15.1)](https://github.com/ava-labs/avalanchego/blob/v1.15.1/config/config.md)
- [Health API](https://build.avax.network/docs/rpcs/other/health-rpc)

## Support

Open an issue in the [aws-blockchain-node-runners](https://github.com/aws-samples/aws-blockchain-node-runners) repository.

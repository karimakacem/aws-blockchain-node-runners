import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as nag from "cdk-nag";
import { SingleNodeConstruct } from "../../constructs/single-node";
import * as configTypes from "./config/robinhood-config.interface";
import * as sharedConfigTypes from "../../constructs/config.interface";

export interface RobinhoodSingleNodeStackProps extends cdk.StackProps {
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    network: configTypes.RobinhoodNetwork;
    nitroVersion: string;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    dataVolume: sharedConfigTypes.DataVolumeConfig;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
    chainId: number;
    sequencerUrl: string;
    feedUrl: string;
}

export class RobinhoodSingleNodeStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: RobinhoodSingleNodeStackProps) {
        super(scope, id, props);

        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const availabilityZones = cdk.Stack.of(this).availabilityZones;
        const chosenAvailabilityZone = availabilityZones.slice(0, 1)[0];

        const {
            instanceType,
            instanceCpuType,
            network,
            nitroVersion,
            l1RpcUrl,
            l1BeaconUrl,
            dataVolume,
            rpcPort,
            wsPort,
            metricsPort,
            chainId,
            sequencerUrl,
            feedUrl,
        } = props;

        // Validate L1 endpoints (Sepolia required for testnet)
        if (!l1RpcUrl || l1RpcUrl === "") {
            throw new Error("L1_RPC_URL is required. Please provide an Ethereum Sepolia RPC endpoint.");
        }
        if (!l1BeaconUrl || l1BeaconUrl === "") {
            throw new Error("L1_BEACON_URL is required. Please provide an Ethereum Sepolia beacon chain endpoint.");
        }

        const vpc = ec2.Vpc.fromLookup(this, "vpc", {
            isDefault: true,
        });

        // Security group for Robinhood Chain node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Robinhood Chain Node",
            allowAllOutbound: true,
        });

        // Allow RPC access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(rpcPort),
            "Robinhood Chain RPC"
        );

        // Allow WebSocket access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(wsPort),
            "Robinhood Chain WebSocket"
        );

        // Allow metrics access from VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(metricsPort),
            "Robinhood Chain Metrics"
        );

        // Get IAM role from common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("RobinhoodNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Get assets info from common stack
        const assetsBucket = cdk.Fn.importValue(`RobinhoodAssetsBucket`);
        const assetsKey = cdk.Fn.importValue(`RobinhoodAssetsKey`);

        // Use Amazon Linux 2023 image
        const machineImage = instanceCpuType === ec2.AmazonLinuxCpuType.ARM_64
            ? ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 })
            : ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 });

        const node = new SingleNodeConstruct(this, "robinhood-node", {
            instanceName: STACK_NAME,
            instanceType,
            dataVolumes: [dataVolume],
            rootDataVolumeDeviceName: "/dev/xvda",
            machineImage,
            vpc,
            availabilityZone: chosenAvailabilityZone,
            role: instanceRole,
            securityGroup: instanceSG,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
            skipVolumeAttachment: true,
        });

        // Get the volume ID for manual attachment in user-data
        const dataVolumeId = (node.node.findChild('data-volume-1').node.defaultChild as ec2.CfnVolume).ref;

        // Override creation policy timeout for genesis sync (testnet takes 2-3 hours)
        const cfnInstance = node.instance.node.defaultChild as ec2.CfnInstance;
        cfnInstance.cfnOptions.creationPolicy = {
            resourceSignal: {
                count: 1,
                timeout: "PT180M",  // 180 minutes (3 hours) for genesis sync from Sepolia
            },
        };

        // Beacon blob proxy: serves archived blobs from Blockscout for slots outside the
        // 18-day PeerDAS retention window. Robinhood Chain launched after Sepolia's Fusaka
        // upgrade (Oct 2026), so all its L1 inbox batches use PeerDAS blobs that are pruned
        // from public beacon nodes after ~18 days. This proxy falls back to Blockscout's
        // indefinite blob archive for any slot the beacon can't serve.
        const blobProxyScript = Buffer.from(`#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
import json, re, sys

BLOCKSCOUT = "https://eth-sepolia.blockscout.com/api/v2/blobs"
REAL_BEACON = "${l1BeaconUrl}"

class BlobProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[blob-proxy] {fmt % args}", file=sys.stderr, flush=True)

    def proxy_to_real_beacon(self, path):
        url = REAL_BEACON + path
        try:
            req = Request(url, headers={"User-Agent": "blob-proxy/1.0"})
            with urlopen(req, timeout=15) as r:
                body = r.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        parsed = urlparse(self.path)
        m = re.match(r'^/eth/v1/beacon/blobs/(\\d+)$', parsed.path)
        if not m:
            self.proxy_to_real_beacon(self.path)
            return
        slot = m.group(1)
        params = parse_qs(parsed.query)
        versioned_hashes = params.get('versioned_hashes', [])
        blobs_out = []
        for vh in versioned_hashes:
            try:
                req = Request(f"{BLOCKSCOUT}/{vh}", headers={"User-Agent": "blob-proxy/1.0"})
                with urlopen(req, timeout=30) as r:
                    data = json.loads(r.read())
                blobs_out.append(data['blob_data'])
                print(f"[blob-proxy] Served {vh[:20]}... slot={slot} from Blockscout", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[blob-proxy] Blockscout failed for {vh}: {e}, trying beacon", file=sys.stderr, flush=True)
                self.proxy_to_real_beacon(self.path)
                return
        response = json.dumps({"data": blobs_out}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3500
    print(f"[blob-proxy] Listening on 0.0.0.0:{port}", file=sys.stderr, flush=True)
    HTTPServer(("0.0.0.0", port), BlobProxyHandler).serve_forever()
`).toString('base64');

        const blobProxyService = Buffer.from(`[Unit]
Description=Beacon Blob Proxy (Blockscout archive fallback)
After=network.target

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStart=/usr/bin/python3 /usr/local/bin/blob_proxy.py 3500

[Install]
WantedBy=multi-user.target
`).toString('base64');

        const nitroService = Buffer.from(`[Unit]
Description=Robinhood Chain Nitro Node
After=docker.service blob-proxy.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=30
TimeoutStartSec=0
ExecStart=/usr/bin/docker run --rm --name nitro --network=host -v /data/nitro:/data offchainlabs/nitro-node:${nitroVersion} --conf.file /data/robinhood-chain-testnet-config.json --persistent.chain /data --parent-chain.connection.url ${l1RpcUrl} --parent-chain.blob-client.beacon-url http://127.0.0.1:3500 --node.staker.enable=false --http.addr 0.0.0.0 --http.port ${rpcPort} --http.vhosts=* --http.corsdomain=* --http.api=eth,net,web3,arb --http.rpcprefix=/ --ws.addr 0.0.0.0 --ws.port ${wsPort} --ws.origins=* --ws.api=eth,net,web3,arb --ws.rpcprefix=/ --metrics --metrics-server.addr 0.0.0.0 --metrics-server.port ${metricsPort} --log-level info
ExecStop=/usr/bin/docker stop nitro

[Install]
WantedBy=multi-user.target
`).toString('base64');

        // User data for Robinhood Chain setup
        node.instance.addUserData(
            '#!/bin/bash',
            'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
            'echo "Starting Robinhood Chain node setup..."',
            '',
            '# Install required packages',
            'dnf install -y docker wget jq amazon-cloudwatch-agent aws-cfn-bootstrap unzip',
            'systemctl enable docker',
            'systemctl start docker',
            '',
            '# Attach and mount data volume',
            `VOLUME_ID="${dataVolumeId}"`,
            'INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)',
            `aws ec2 attach-volume --region ${REGION} --volume-id $VOLUME_ID --instance-id $INSTANCE_ID --device /dev/sdf`,
            'DEVICE=""',
            'for i in {1..30}; do',
            '  if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; break; fi',
            '  if [ -e /dev/xvdf ]; then DEVICE="/dev/xvdf"; break; fi',
            '  sleep 10',
            'done',
            '[ -z "$DEVICE" ] && echo "ERROR: data volume not found after 5 minutes" && exit 1',
            'echo "Found data volume: $DEVICE"',
            'if ! blkid $DEVICE; then mkfs -t ext4 $DEVICE; fi',
            'mkdir -p /data',
            'mount $DEVICE /data',
            'echo "$DEVICE /data ext4 defaults,nofail 0 2" >> /etc/fstab',
            '',
            '# Create directories on mounted volume',
            'mkdir -p /data/nitro',
            'chmod 777 /data/nitro',
            '',
            '# Download Robinhood Chain config onto mounted volume',
            `echo "Downloading Robinhood Chain testnet config..."`,
            'curl -o /data/nitro/robinhood-chain-testnet-config.json https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-chain-testnet-config.json',
            '',
            '# Install blob proxy (serves archived Sepolia PeerDAS blobs from Blockscout)',
            `echo '${blobProxyScript}' | base64 -d > /usr/local/bin/blob_proxy.py`,
            'chmod +x /usr/local/bin/blob_proxy.py',
            `echo '${blobProxyService}' | base64 -d > /etc/systemd/system/blob-proxy.service`,
            '',
            '# Pull Nitro Docker image',
            `echo "Pulling Nitro ${nitroVersion}..."`,
            `docker pull offchainlabs/nitro-node:${nitroVersion}`,
            '',
            '# Write Nitro systemd service (uses --network=host to reach local blob proxy)',
            `echo '${nitroService}' | base64 -d > /etc/systemd/system/nitro.service`,
            '',
            '# Start services',
            'systemctl daemon-reload',
            'systemctl enable blob-proxy nitro',
            'systemctl start blob-proxy',
            'sleep 2',
            'systemctl start nitro',
            '',
            '# Wait for nitro to become active (Docker pull + startup can take several minutes)',
            'RETRIES=40',
            'COUNT=0',
            'while [ $COUNT -lt $RETRIES ]; do',
            '  STATUS=$(systemctl is-active nitro 2>/dev/null)',
            '  if [ "$STATUS" = "active" ]; then break; fi',
            '  if [ "$STATUS" = "failed" ]; then break; fi',
            '  COUNT=$((COUNT + 1))',
            '  echo "Waiting for nitro service... ($COUNT/$RETRIES) status=$STATUS"',
            '  sleep 15',
            'done',
            '',
            '# Signal CloudFormation',
            'if [ "$(systemctl is-active nitro)" = "active" ]; then',
            `  cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success true`,
            '  echo "✓ Setup complete"',
            'else',
            '  journalctl -u nitro -n 20 --no-pager',
            `  cfn-signal --stack ${STACK_NAME} --resource ${node.nodeCFLogicalId} --region ${REGION} --success false`,
            '  echo "✗ Service failed"',
            'fi'
        );

        // CloudWatch Dashboard
        new cw.CfnDashboard(this, 'robinhood-dashboard', {
            dashboardName: `${STACK_NAME}-${node.instanceId}`,
            dashboardBody: JSON.stringify({
                widgets: [
                    {
                        type: "metric",
                        properties: {
                            metrics: [
                                ["AWS/EC2", "CPUUtilization", { stat: "Average", label: "CPU Average" }],
                            ],
                            view: "timeSeries",
                            region: REGION,
                            title: "EC2 CPU Utilization",
                            period: 300,
                        }
                    },
                ]
            })
        });

        // Outputs
        new cdk.CfnOutput(this, "node-instance-id", {
            value: node.instanceId,
        });

        // Suppressions
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-EC28",
                    reason: "Using basic monitoring to save costs",
                },
                {
                    id: "AwsSolutions-EC29",
                    reason: "Termination protection not required for development node",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Security group restricted to VPC CIDR range",
                },
            ],
            true
        );
    }
}

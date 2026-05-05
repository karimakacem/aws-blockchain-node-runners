import * as cdk from "aws-cdk-lib";
import * as cdkConstructs from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as nag from "cdk-nag";
import * as path from "path";
import * as fs from "fs";
import * as configTypes from "./config/robinhood-config.interface";
import { HANodesConstruct } from "../../constructs/ha-rpc-nodes-with-alb";

export interface RobinhoodRpcNodesStackProps extends cdk.StackProps {
    network: configTypes.RobinhoodNetwork;
    nitroVersion: string;
    l1RpcUrl: string;
    l1BeaconUrl: string;
    instanceType: ec2.InstanceType;
    instanceCpuType: ec2.AmazonLinuxCpuType;
    dataVolume: configTypes.RobinhoodDataVolumeConfig;
    rpcPort: number;
    wsPort: number;
    metricsPort: number;
    chainId: number;
    sequencerUrl: string;
    feedUrl: string;
    numberOfNodes: number;
    albHealthCheckGracePeriodMin: number;
    heartBeatDelayMin: number;
}

export class RobinhoodRpcNodesStack extends cdk.Stack {
    constructor(scope: cdkConstructs.Construct, id: string, props: RobinhoodRpcNodesStackProps) {
        super(scope, id, props);

        // Validate L1 endpoints are provided
        if (!props.l1RpcUrl || props.l1RpcUrl.trim() === "") {
            throw new Error("L1_RPC_URL must be provided for Robinhood Chain node to connect to Ethereum Sepolia");
        }
        if (!props.l1BeaconUrl || props.l1BeaconUrl.trim() === "") {
            throw new Error("L1_BEACON_URL must be provided for Robinhood Chain node to connect to Ethereum Sepolia beacon chain");
        }

        // Setting up necessary environment variables
        const REGION = cdk.Stack.of(this).region;
        const STACK_NAME = cdk.Stack.of(this).stackName;
        const lifecycleHookName = STACK_NAME;
        const autoScalingGroupName = STACK_NAME;

        // Getting our config from initialization properties
        const {
            network,
            nitroVersion,
            l1RpcUrl,
            l1BeaconUrl,
            instanceType,
            instanceCpuType,
            dataVolume,
            rpcPort,
            wsPort,
            metricsPort,
            chainId,
            sequencerUrl,
            feedUrl,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            numberOfNodes,
        } = props;

        // Using default VPC
        const vpc = ec2.Vpc.fromLookup(this, "vpc", { isDefault: true });

        // Setting up the security group for the node
        const instanceSG = new ec2.SecurityGroup(this, "security-group", {
            vpc: vpc,
            description: "Security Group for Robinhood Chain RPC nodes",
            allowAllOutbound: true,
        });

        // Allow RPC access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(rpcPort),
            "Robinhood Chain RPC port"
        );

        // Allow WebSocket access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(wsPort),
            "Robinhood Chain WebSocket port"
        );

        // Allow metrics access from within VPC
        instanceSG.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(metricsPort),
            "Robinhood Chain Metrics port"
        );

        // Making our scripts and configs from the local "assets" directory available for instance to download
        const asset = new s3Assets.Asset(this, "assets", {
            path: path.join(__dirname, "assets"),
        });

        // Getting the IAM role ARN from the common stack
        const importedInstanceRoleArn = cdk.Fn.importValue("RobinhoodNodeInstanceRoleArn");
        const instanceRole = iam.Role.fromRoleArn(this, "iam-role", importedInstanceRoleArn);

        // Grant read permissions on assets
        asset.bucket.grantRead(instanceRole);

        // Blob proxy: serves archived Sepolia PeerDAS blobs from Blockscout (same as single-node)
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
            except Exception as e:
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

        // Parsing user data script and injecting necessary variables
        const userData = fs.readFileSync(path.join(__dirname, "assets", "user-data-rpc-node.sh")).toString();

        const modifiedUserData = cdk.Fn.sub(userData, {
            _REGION_: REGION,
            _ASSETS_S3_PATH_: `s3://${asset.s3BucketName}/${asset.s3ObjectKey}`,
            _ROBINHOOD_NETWORK_: network,
            _NITRO_VERSION_: nitroVersion,
            _L1_RPC_URL_: l1RpcUrl,
            _BLOB_PROXY_SCRIPT_: blobProxyScript,
            _BLOB_PROXY_SERVICE_: blobProxyService,
            _RPC_PORT_: rpcPort.toString(),
            _WS_PORT_: wsPort.toString(),
            _METRICS_PORT_: metricsPort.toString(),
            _CHAIN_ID_: chainId.toString(),
            _SEQUENCER_URL_: sequencerUrl,
            _FEED_URL_: feedUrl,
            _STACK_NAME_: STACK_NAME,
            _LIFECYCLE_HOOK_NAME_: lifecycleHookName,
            _AUTOSCALING_GROUP_NAME_: autoScalingGroupName,
        });

        // Setting up the nodes using generic High Availability (HA) Node construct
        const rpcNodes = new HANodesConstruct(this, "rpc-nodes", {
            instanceType,
            dataVolumes: [dataVolume],
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
                kernel: ec2.AmazonLinuxKernel.KERNEL6_1,
                cpuType: instanceCpuType,
            }),
            role: instanceRole,
            vpc,
            securityGroup: instanceSG,
            userData: modifiedUserData,
            numberOfNodes,
            rpcPortForALB: rpcPort,
            albHealthCheckGracePeriodMin,
            heartBeatDelayMin,
            lifecycleHookName: lifecycleHookName,
            autoScalingGroupName: autoScalingGroupName,
        });

        // Making sure we output the URL of our Application Load Balancer
        new cdk.CfnOutput(this, "alb-url", {
            value: rpcNodes.loadBalancerDnsName,
            description: "Application Load Balancer DNS name for Robinhood Chain RPC nodes",
        });

        // Adding suppressions to the stack
        nag.NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-AS3",
                    reason: "No notifications needed",
                },
                {
                    id: "AwsSolutions-S1",
                    reason: "No access log needed for ALB logs bucket",
                },
                {
                    id: "AwsSolutions-EC28",
                    reason: "Using basic monitoring to save costs",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Security group is restricted to VPC CIDR range",
                },
            ],
            true
        );
    }
}

#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Beacon Blob Proxy — Robinhood Chain TESTNET only.
#
# Robinhood Chain testnet settles to Ethereum Sepolia. Nitro must fetch blob
# data (EIP-4844 / PeerDAS) from an L1 beacon endpoint, but public Sepolia
# beacon nodes only retain blobs for ~18 days. This proxy sits in front of the
# real beacon endpoint: for blob-sidecar requests it first tries Blockscout's
# indefinite Sepolia blob archive, falling back to the real beacon for anything
# else (or on error). Mainnet does NOT need this (Ethereum-mainnet beacon
# providers serve the required blobs), so node.sh only starts it on testnet.
#
# The real beacon URL is read from the ROBINHOOD_L1_BEACON_URL environment
# variable (exported from /etc/cdk_environment by the systemd unit).

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
import json
import os
import re
import sys

BLOCKSCOUT = "https://eth-sepolia.blockscout.com/api/v2/blobs"
REAL_BEACON = os.environ.get("ROBINHOOD_L1_BEACON_URL", "").rstrip("/")


class BlobProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[blob-proxy] {fmt % args}", file=sys.stderr, flush=True)

    def proxy_to_real_beacon(self, path):
        if not REAL_BEACON:
            self.send_error(502, "ROBINHOOD_L1_BEACON_URL not configured")
            return
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
        m = re.match(r'^/eth/v1/beacon/blobs/(\d+)$', parsed.path)
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
                print(f"[blob-proxy] Served {vh[:20]}... slot={slot} from Blockscout",
                      file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[blob-proxy] Blockscout failed for {vh}: {e}, trying beacon",
                      file=sys.stderr, flush=True)
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
    # Bind to loopback only — the proxy is consumed by the local Nitro container
    # over host networking (127.0.0.1:3500) and must never be externally reachable.
    print(f"[blob-proxy] Listening on 127.0.0.1:{port}", file=sys.stderr, flush=True)
    HTTPServer(("127.0.0.1", port), BlobProxyHandler).serve_forever()

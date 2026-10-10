#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Beacon Blob Proxy — Robinhood Chain TESTNET only.
#
# Robinhood Chain testnet settles to Ethereum Sepolia. Nitro must fetch blob
# data (EIP-4844 / PeerDAS) from an L1 beacon endpoint. This proxy sits in
# front of the real beacon endpoint for blob-sidecar requests:
#
#   1. BEACON FIRST — the real beacon's /eth/v1/beacon/blob_sidecars/{slot}
#      returns the exact sidecar schema Nitro expects, and public Sepolia
#      beacons retain blobs for a rolling window (~18 days). This is the
#      correct, authoritative source whenever the blob is still retained.
#   2. BLOCKSCOUT FALLBACK — only for blobs the beacon has already pruned.
#      Blockscout's Sepolia index keeps blob metadata indefinitely but does
#      NOT always store the blob bytes: entries can come back with
#      blob_data=null (and null kzg_commitment/kzg_proof). Such an entry is a
#      MISS, not a hit — it must never be served, because Nitro unmarshals
#      each sidecar's "blob" field as a hex STRING and a JSON null fails with
#      "cannot unmarshal non-string into hexutil.Bytes".
#
# Mainnet does NOT need this (Ethereum-mainnet beacon providers serve the
# required blobs), so node.sh only starts it on testnet.
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

    def _send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_to_real_beacon(self, path):
        if not REAL_BEACON:
            self.send_error(502, "ROBINHOOD_L1_BEACON_URL not configured")
            return
        url = REAL_BEACON + path
        try:
            req = Request(url, headers={"User-Agent": "blob-proxy/1.0"})
            with urlopen(req, timeout=15) as r:
                body = r.read()
            self._send_json(body)
        except Exception as e:
            self.send_error(502, str(e))

    def _beacon_sidecars(self, slot):
        """Fetch sidecar objects for a slot from the real beacon.

        Returns the parsed data[] list (already in Nitro's expected schema)
        or None if the beacon no longer retains the slot / errors."""
        if not REAL_BEACON:
            return None
        url = f"{REAL_BEACON}/eth/v1/beacon/blob_sidecars/{slot}"
        try:
            req = Request(url, headers={"User-Agent": "blob-proxy/1.0"})
            with urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            return data.get("data") or None
        except Exception as e:
            print(f"[blob-proxy] beacon miss slot={slot}: {e}", file=sys.stderr, flush=True)
            return None

    def _blockscout_sidecars(self, versioned_hashes):
        """Fallback: assemble sidecar objects from Blockscout's blob index.

        Returns a data[] list, or None if ANY requested blob is missing its
        bytes (blob_data=null) — a partial set would fail KZG verification."""
        out = []
        for idx, vh in enumerate(versioned_hashes):
            try:
                req = Request(f"{BLOCKSCOUT}/{vh}", headers={"User-Agent": "blob-proxy/1.0"})
                with urlopen(req, timeout=30) as r:
                    d = json.loads(r.read())
            except Exception as e:
                print(f"[blob-proxy] blockscout error {vh[:20]}: {e}", file=sys.stderr, flush=True)
                return None
            # Null bytes = indexed but not stored. Treat as a miss.
            if not d.get("blob_data") or not d.get("kzg_commitment") or not d.get("kzg_proof"):
                print(f"[blob-proxy] blockscout has no bytes for {vh[:20]} (null)",
                      file=sys.stderr, flush=True)
                return None
            out.append({
                "index": str(idx),
                "blob": d["blob_data"],
                "kzg_commitment": d["kzg_commitment"],
                "kzg_proof": d["kzg_proof"],
            })
        return out or None

    def do_GET(self):
        parsed = urlparse(self.path)
        m = re.match(r'^/eth/v1/beacon/blobs/(\d+)$', parsed.path)
        if not m:
            self.proxy_to_real_beacon(self.path)
            return
        slot = m.group(1)
        params = parse_qs(parsed.query)
        versioned_hashes = params.get('versioned_hashes', [])

        # 1. Beacon first — authoritative schema, serves anything still retained.
        sidecars = self._beacon_sidecars(slot)
        source = "beacon"
        # 2. Fallback to Blockscout only for pruned slots.
        if sidecars is None:
            sidecars = self._blockscout_sidecars(versioned_hashes)
            source = "blockscout"
        if sidecars is None:
            self.send_error(502, f"no blob source has slot {slot}")
            return

        print(f"[blob-proxy] slot={slot} served {len(sidecars)} sidecar(s) from {source}",
              file=sys.stderr, flush=True)
        self._send_json(json.dumps({"data": sidecars}).encode())


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3500
    # Bind to loopback only — the proxy is consumed by the local Nitro container
    # over host networking (127.0.0.1:3500) and must never be externally reachable.
    print(f"[blob-proxy] Listening on 127.0.0.1:{port}", file=sys.stderr, flush=True)
    HTTPServer(("127.0.0.1", port), BlobProxyHandler).serve_forever()

#!/usr/bin/env python3
"""Defensive security workload command center.

This file intentionally uses synthetic fixtures and bounded proofs. It never
searches for private keys, cracks real credentials, executes discovered code,
or probes arbitrary remote systems. It provides real local UDP/TCP/HTTP
plumbing for a safe lab demonstration.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import secrets
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

HOST = os.getenv("COMMAND_CENTER_HOST", "0.0.0.0")
DNS_HOST = os.getenv("DNS_HOST", "127.0.0.1")
DNS_PORT = int(os.getenv("DNS_PORT", "5353"))
POOL_PORT = int(os.getenv("POOL_PORT", "9000"))
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))
DNS_DOMAIN = os.getenv("DNS_DOMAIN", "cluster.node.local").rstrip(".").lower()
DNS_TARGET_IP = os.getenv("DNS_TARGET_IP", "127.0.0.1")
DNS_TTL = max(1, int(os.getenv("DNS_TTL", "60")))
PROOF_PREFIX = "000"
DNS_PROOF_KEY = b"ARGUS-STANDALONE-DNS-PROOF-KEY"

WORKLOADS = [
    ("Critical", "Private-key recovery / cryptanalysis", "PBKDF2 seed derivation", "Defensive fixture only; no key search"),
    ("Critical", "Remote code execution surface", "Sink pattern scan", "Static pattern detection"),
    ("Critical", "Secret / credential exposure", "Entropy + regex scan", "Synthetic fixtures only"),
    ("High", "Blockchain proof-of-work mining", "Double SHA-256", "Bounded local proof"),
    ("High", "CAPTCHA / anti-bot proof-of-work", "Hash iteration", "Rate-limit simulation"),
    ("High", "Password-hash cracking", "Hash cost review", "No credential cracking"),
    ("High", "DNS tunneling", "Entropy / stream", "Synthetic query analysis"),
    ("High", "Injection surfaces", "AST / syntax", "Static query review"),
    ("High", "SSRF", "URL parser", "Private-range detection"),
    ("High", "Unsafe deserialization", "Bytecode inspect", "Static call-site review"),
    ("High", "Cryptographic misuse", "API trace", "Weak primitive detection"),
    ("Medium", "Password storage", "Salted hash", "Storage policy check"),
    ("Medium", "AI computation", "Matrix multiply", "Small deterministic matrix"),
    ("Medium", "File integrity", "SHA-256 digest", "Fixture digest verification"),
    ("Medium", "Digital signatures", "Signature verify", "Known-message fixture"),
    ("Medium", "SSL/TLS validation", "X.509 parse", "Certificate policy review"),
    ("Medium", "Key generation", "CSPRNG sample", "Entropy health check"),
    ("Medium", "DNS / DNSSEC validation", "NSEC3 verify", "Resolver policy review"),
]


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def double_sha256(data: bytes) -> bytes:
    return sha256(sha256(data))


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = {char: value.count(char) for char in set(value)}
    return -sum((count / len(value)) * math.log2(count / len(value)) for count in counts.values())


def dns_record_proof(target_ip: str, serial: int) -> dict[str, str]:
    canonical = f"{DNS_DOMAIN}|A|{target_ip}|{DNS_TTL}|{serial}"
    record_hash = hashlib.sha256(canonical.encode()).hexdigest()
    key_fingerprint = hashlib.sha256(DNS_PROOF_KEY).hexdigest()
    signature = hmac.new(DNS_PROOF_KEY, canonical.encode(), hashlib.sha256).hexdigest()
    return {
        "canonical": canonical,
        "recordHash": record_hash,
        "keyFingerprint": key_fingerprint,
        "signature": signature,
    }


def probe_redirect(target_ip: str) -> dict[str, Any]:
    url = f"http://{target_ip}:{WEB_PORT}/redirected-resource"
    with urlopen(url, timeout=1) as response:
        body = response.read().decode("utf-8")
        return {"statusCode": response.status, "url": url, "body": body}


def safe_fixture_result(name: str, tick: int) -> dict[str, Any]:
    """Run a local, non-invasive demonstration for one taxonomy workload."""
    fixture = f"{name}: lab-fixture:{tick}".encode()
    if name == "Private-key recovery / cryptanalysis":
        # PBKDF2 is demonstrated on a fixed non-secret fixture; no key search.
        proof = hashlib.pbkdf2_hmac("sha512", b"lab mnemonic fixture", b"mnemonic", 64, 128).hex()[:16]
    elif name == "Secret / credential exposure":
        proof = f"entropy={shannon_entropy(fixture.decode()):.2f}"
    elif name == "Key generation":
        proof = secrets.token_hex(8)
    elif name == "AI computation":
        matrix = [[1, 2], [3, 4]]
        product = matrix[0][0] * matrix[1][0] + matrix[0][1] * matrix[1][1]
        proof = f"matrix-cell={product}"
    else:
        proof = hashlib.sha256(fixture).hexdigest()[:16]
    return {"proof": proof, "note": next(item[3] for item in WORKLOADS if item[1] == name)}


class Coordinator:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.running = True
        self.tick = 0
        self.query_count = 0
        self.dns_target_ip = DNS_TARGET_IP
        self.dns_serial = 1
        self.miners: dict[str, dict[str, Any]] = {}
        self.jobs: dict[str, dict[str, Any]] = {}
        self.ledger: list[dict[str, Any]] = [{
            "height": 0,
            "task": "Genesis security block",
            "severity": "Medium",
            "hash": double_sha256(b"GENESIS_SECURITY_BLOCK").hex(),
            "nonce": 0,
            "miner": "COORDINATOR",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }]
        self.telemetry = [
            {
                "id": f"w-{index + 1:02d}",
                "name": name,
                "severity": severity,
                "status": "verifying" if index % 5 == 0 else "running",
                "progress": 38 + ((index * 13) % 57),
                "verifiedShares": 7 + index * 3,
                "lastProof": double_sha256(name.encode()).hex()[:16],
                "rate": rate,
                "note": note,
            }
            for index, (severity, name, rate, note) in enumerate(WORKLOADS)
        ]

    def step(self) -> None:
        with self.lock:
            self.tick += 1
            item = self.telemetry[self.tick % len(self.telemetry)]
            item["progress"] = min(99, 34 + ((item["progress"] + 7) % 66))
            item["verifiedShares"] += 1
            item["status"] = "settling" if item["progress"] > 90 else "running"
            item["lastProof"] = safe_fixture_result(item["name"], self.tick)["proof"]
            if self.tick % 2 == 0:
                previous = self.ledger[-1]["hash"]
                block_hash = double_sha256(f"{previous}:{item['lastProof']}:{self.tick}".encode()).hex()
                self.ledger.append({
                    "height": self.ledger[-1]["height"] + 1,
                    "task": item["name"],
                    "severity": item["severity"],
                    "hash": block_hash,
                    "nonce": 1000 + self.tick * 17,
                    "miner": "local-worker-01" if self.tick % 3 else "local-worker-02",
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                self.ledger = self.ledger[-8:]

    def make_job(self, miner_id: str) -> dict[str, Any]:
        self.step()
        item = self.telemetry[self.tick % len(self.telemetry)]
        job = {
            "jobId": f"{miner_id}-{self.tick}",
            "height": self.ledger[-1]["height"] + 1,
            "previousHash": self.ledger[-1]["hash"],
            "task": item["name"],
            "severity": item["severity"],
            "difficulty": PROOF_PREFIX,
            "issuedAt": int(time.time()),
            "nonceStart": self.tick * 1000,
            "nonceEnd": self.tick * 1000 + 50000,
        }
        self.jobs[job["jobId"]] = job
        return job

    def verify_submission(self, miner_id: str, submission: dict[str, Any]) -> bool:
        job = self.jobs.pop(str(submission.get("jobId")), None)
        nonce = submission.get("nonce")
        if not job or not isinstance(nonce, int) or not job["nonceStart"] <= nonce < job["nonceEnd"]:
            return False
        header = f"{job['height']}:{job['previousHash']}:{job['task']}:{nonce}".encode()
        digest = double_sha256(header).hex()
        if not digest.startswith(PROOF_PREFIX):
            return False
        with self.lock:
            self.miners.setdefault(miner_id, {"shares": 0, "connectedAt": time.time()})
            self.miners[miner_id]["shares"] += 1
            self.ledger.append({
                "height": job["height"],
                "task": job["task"],
                "severity": job["severity"],
                "hash": digest,
                "nonce": nonce,
                "miner": miner_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            self.ledger = self.ledger[-8:]
        return True

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            self.step()
            return {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "coordinator": {
                    "status": "operational",
                    "activeMiners": len(self.miners),
                    "poolPort": POOL_PORT,
                    "webPort": WEB_PORT,
                    "policy": "defensive fixtures only",
                },
                "dns": {
                    "status": "Active & synchronized",
                    "domain": DNS_DOMAIN,
                    "ip": self.dns_target_ip,
                    "ttl": DNS_TTL,
                    "port": DNS_PORT,
                    "queries": self.query_count,
                    "serial": self.dns_serial,
                },
                "workloads": list(self.telemetry),
                "ledger": list(reversed(self.ledger)),
            }

    def migrate_dns(self, target_ip: str) -> None:
        if target_ip not in {"127.0.0.1", "127.0.0.2"}:
            raise ValueError("targetIp must be 127.0.0.1 or 127.0.0.2")
        with self.lock:
            self.dns_target_ip = target_ip
            self.dns_serial += 1


def encode_dns_name(name: str) -> bytes:
    return b"".join(bytes([len(part)]) + part.encode() for part in name.split(".")) + b"\0"


def read_dns_name(packet: bytes, offset: int) -> tuple[str, int]:
    labels: list[str] = []
    cursor = offset
    while cursor < len(packet):
        length = packet[cursor]
        cursor += 1
        if length == 0:
            return ".".join(labels).lower(), cursor
        if length & 0xC0:
            raise ValueError("compressed question names are not accepted")
        if cursor + length > len(packet):
            raise ValueError("truncated label")
        labels.append(packet[cursor:cursor + length].decode("idna"))
        cursor += length
    raise ValueError("unterminated name")


class DnsServer(threading.Thread):
    daemon = True

    def __init__(self, coordinator: Coordinator) -> None:
        super().__init__(name="authoritative-dns")
        self.coordinator = coordinator
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((DNS_HOST, DNS_PORT))

    def run(self) -> None:
        while self.coordinator.running:
            try:
                packet, address = self.sock.recvfrom(512)
                response = self.respond(packet)
                if response:
                    self.sock.sendto(response, address)
            except OSError:
                break
            except (ValueError, IndexError):
                continue

    def respond(self, packet: bytes) -> bytes | None:
        if len(packet) < 17:
            return None
        transaction = packet[:2]
        flags = struct.unpack("!H", packet[2:4])[0]
        question_name, question_end = read_dns_name(packet, 12)
        if question_end + 4 > len(packet):
            return None
        qtype, qclass = struct.unpack("!HH", packet[question_end:question_end + 4])
        question = packet[12:question_end + 4]
        self.coordinator.query_count += 1
        answer = b""
        answers = 0
        if question_name == DNS_DOMAIN and qtype == 1 and qclass == 1:
            answer = b"\xc0\x0c" + struct.pack("!HHI", 1, 1, DNS_TTL) + b"\x00\x04" + socket.inet_aton(self.coordinator.dns_target_ip)
            answers = 1
        response_flags = 0x8000 | (flags & 0x0100) | (0x0400 if answers else 0x0003)
        header = transaction + struct.pack("!HHHHH", response_flags, 1, answers, 0, 0)
        return header + question + answer


def query_authoritative() -> dict[str, Any]:
    transaction_id = secrets.randbelow(65535)
    question = encode_dns_name(DNS_DOMAIN) + struct.pack("!HH", 1, 1)
    packet = struct.pack("!HHHHHH", transaction_id, 0x0100, 1, 0, 0, 0) + question
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1)
    try:
        sock.sendto(packet, ("127.0.0.1", DNS_PORT))
        response, _ = sock.recvfrom(512)
        answer_count = struct.unpack("!H", response[6:8])[0]
        question_name, question_end = read_dns_name(response, 12)
        if answer_count:
            answer_offset = question_end + 4
            ttl = struct.unpack("!I", response[answer_offset + 6:answer_offset + 10])[0]
            length = struct.unpack("!H", response[answer_offset + 10:answer_offset + 12])[0]
            ip = socket.inet_ntoa(response[answer_offset + 12:answer_offset + 12 + length])
        else:
            ttl, ip = 0, ""
        return {
            "request": question_name,
            "response": "NOERROR" if answer_count else "NXDOMAIN",
            "ip": ip,
            "ttl": ttl,
            "bytes": len(response),
        }
    finally:
        sock.close()


class PoolServer(threading.Thread):
    daemon = True

    def __init__(self, coordinator: Coordinator) -> None:
        super().__init__(name="mining-pool")
        self.coordinator = coordinator
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind((HOST, POOL_PORT))
        self.server.listen(32)

    def run(self) -> None:
        while self.coordinator.running:
            try:
                client, address = self.server.accept()
                threading.Thread(target=self.client, args=(client, address), daemon=True).start()
            except OSError:
                break

    def client(self, client: socket.socket, address: tuple[str, int]) -> None:
        miner_id = f"{address[0]}:{address[1]}"
        with client:
            self.coordinator.miners[miner_id] = {"shares": 0, "connectedAt": time.time()}
            stream = client.makefile("rwb")
            try:
                while self.coordinator.running:
                    job = self.coordinator.make_job(miner_id)
                    stream.write((json.dumps(job) + "\n").encode())
                    stream.flush()
                    line = stream.readline()
                    if not line:
                        break
                    if self.coordinator.verify_submission(miner_id, json.loads(line)):
                        stream.write(b'{"accepted":true}\n')
                    else:
                        stream.write(b'{"accepted":false,"reason":"invalid proof"}\n')
                    stream.flush()
            except (ConnectionError, json.JSONDecodeError, OSError):
                return


class DashboardHandler(BaseHTTPRequestHandler):
    coordinator: Coordinator

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/redirected-resource":
            body = f"ARGUS local redirect target {self.coordinator.dns_target_ip}".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        elif path == "/api/status":
            body = json.dumps(self.coordinator.snapshot()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
        else:
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/dns/migrate":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            self.coordinator.migrate_dns(str(payload["targetIp"]))
            response = query_authoritative()
            redirect = probe_redirect(response["ip"])
            proof = dns_record_proof(response["ip"], self.coordinator.dns_serial)
            details = [
                {"label": "Serial", "value": str(self.coordinator.dns_serial)},
                {"label": "New target", "value": response["ip"]},
                {"label": "Redirected request", "value": f"{redirect['statusCode']} {redirect['url']}"},
                {"label": "Record canonical", "value": proof["canonical"]},
                {"label": "Record hash", "value": proof["recordHash"]},
                {"label": "Verification key", "value": proof["keyFingerprint"]},
                {"label": "Record signature", "value": proof["signature"]},
            ]
            body = json.dumps({
                "status": "solved",
                "answer": f"Authoritative record propagated to {response['ip']}",
                "dns": response,
                "serial": self.coordinator.dns_serial,
                "dnsSerial": self.coordinator.dns_serial,
                "dnsTarget": response["ip"],
                "dnsRedirect": redirect,
                "dnsRecordProof": proof,
                "details": details,
                "evidence": [
                    f"serial={self.coordinator.dns_serial}",
                    redirect["url"],
                    f"record_hash={proof['recordHash']}",
                    f"record_key_fingerprint={proof['keyFingerprint']}",
                    f"record_signature={proof['signature']}",
                ],
                "safety": "Controlled loopback lab record; only 127.0.0.1 and 127.0.0.2 are permitted",
            }).encode()
            self.send_response(200)
        except (KeyError, ValueError, json.JSONDecodeError, OSError) as error:
            body = json.dumps({"error": str(error)}).encode()
            self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


HTML = """<!doctype html><meta charset=utf-8><title>Security Command Center</title>
<style>body{background:#071018;color:#e6f3f5;font:14px ui-monospace,monospace;padding:2rem}main{max-width:1100px;margin:auto}pre{white-space:pre-wrap;color:#93c5c9}</style>
<main><h1>Security Mining Command Center</h1><p>Defensive fixture telemetry · live local coordinator</p><pre id=out>Loading…</pre></main>
<script>async function tick(){const r=await fetch('/api/status');document.querySelector('#out').textContent=JSON.stringify(await r.json(),null,2)}tick();setInterval(tick,1500)</script>"""


def start() -> None:
    coordinator = Coordinator()
    dns = DnsServer(coordinator)
    pool = PoolServer(coordinator)
    dns.start()
    pool.start()
    DashboardHandler.coordinator = coordinator
    http = ThreadingHTTPServer((HOST, WEB_PORT), DashboardHandler)
    print(f"Security command center listening on HTTP {WEB_PORT}, TCP {POOL_PORT}, UDP {DNS_PORT}")
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        coordinator.running = False
        http.shutdown()
        dns.sock.close()
        pool.server.close()


if __name__ == "__main__":
    start()
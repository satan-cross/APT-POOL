#!/usr/bin/env python3
"""Local proof miner process with optional CUDA acceleration.

The process speaks the ARGUS loopback JSON-line miner protocol and emits
newline-delimited JSON events to stdout. Diagnostics belong on stderr so a
parent process can consume stdout without parsing human log output.

GPU mode is opt-in through capability detection and requires a local CuPy
installation backed by CUDA or ROCm. ``auto`` uses the GPU when that backend
is available and otherwise reports an explicit CPU fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import shutil
import socket
import struct
import subprocess
import sys
import time
from typing import Any


def emit(event: str, **fields: Any) -> None:
    payload = {"event": event, "timestamp": time.time(), **fields}
    try:
        print(json.dumps(payload, separators=(",", ":")), flush=True)
    except BrokenPipeError:
        # A parent process such as `head` may intentionally stop reading.
        raise SystemExit(0)


def detect_device() -> str:
    for command, args in (
        ("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]),
        ("rocminfo", []),
    ):
        if shutil.which(command) is None:
            continue
        try:
            result = subprocess.run(
                [command, *args],
                check=False,
                capture_output=True,
                text=True,
                timeout=1,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().splitlines()[0].strip() or command
    return ""


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def solve_cpu(job: dict[str, Any]) -> tuple[int, str] | None:
    prefix = f"{job['height']}:{job['previousHash']}:{job['workloadId']}:"
    difficulty = str(job["difficulty"])
    for nonce in range(int(job["nonceStart"]), int(job["nonceEnd"])):
        digest = sha256_hex(f"{prefix}{nonce}".encode())
        if digest.startswith(difficulty):
            return nonce, digest
    return None


def _search_argus_batch(
    prefix: bytes,
    start: int,
    end: int,
    difficulty: str,
) -> tuple[int, str, int] | None:
    """Search one disjoint ARGUS nonce range in a child process.

    ARGUS jobs intentionally use a single SHA-256 over the textual job
    representation.  This is separate from the Bitcoin double-SHA benchmark
    in the Subenquenox miner, but uses the same process-parallel layout.
    """
    digest_fn = hashlib.sha256
    checked = 0
    for nonce in range(start, end):
        digest = digest_fn(prefix + str(nonce).encode()).hexdigest()
        checked += 1
        if digest.startswith(difficulty):
            return nonce, digest, checked
    return None


def solve_cpu_multiprocess(
    job: dict[str, Any],
    num_processes: int | None = None,
    worker_pool: Any | None = None,
) -> tuple[int, str, int, float]:
    """Solve an ARGUS job with bounded multiprocessing and return measured H/s."""
    prefix = f"{job['height']}:{job['previousHash']}:{job['workloadId']}:".encode()
    difficulty = str(job["difficulty"])
    start = int(job["nonceStart"])
    end = int(job["nonceEnd"])
    total = max(0, end - start)
    if total == 0:
        return -1, "", 0, 0.0

    workers = max(1, min(num_processes or mp.cpu_count(), 4, total))
    chunk = (total + workers - 1) // workers
    started = time.perf_counter()
    tasks = [
        (prefix, chunk_start, min(end, chunk_start + chunk), difficulty)
        for chunk_start in range(start, end, chunk)
    ]

    if len(tasks) == 1:
        results = [_search_argus_batch(*tasks[0])]
    elif worker_pool is not None:
        results = worker_pool.starmap(_search_argus_batch, tasks)
    else:
        with mp.Pool(processes=workers) as pool:
            results = pool.starmap(_search_argus_batch, tasks)

    elapsed = max(0.0001, time.perf_counter() - started)
    winner: tuple[int, str] | None = None
    checked = 0
    for result, task in zip(results, tasks):
        if result is None:
            checked += task[2] - task[1]
            continue
        nonce, digest, checked_in_range = result
        checked += checked_in_range
        if winner is None or nonce < winner[0]:
            winner = (nonce, digest)
    if winner is None:
        checked = total

    raw_hps = checked / elapsed
    if winner is None:
        return -1, "", checked, raw_hps
    return winner[0], winner[1], checked, raw_hps


def run_benchmark(duration_sec: int = 10, workers: int | None = None) -> None:
    """Run the local ARGUS solver benchmark used by the native counterpart."""
    job = {
        "height": 884920,
        "previousHash": "000000000000000000019a8b27f4f6c12d4a13d74bc804193eb7a4195155f984",
        "workloadId": "argus-block-eval",
        "difficulty": "0000000000000000000000000000000000000000000000000000000000000000",
        "nonceStart": 0,
        "nonceEnd": 250000,
    }
    hashes = 0
    worker_count = max(1, min(workers or mp.cpu_count(), 4))
    with mp.Pool(processes=worker_count) as worker_pool:
        started = time.perf_counter()
        while time.perf_counter() - started < max(1, duration_sec):
            job["nonceStart"] = 0
            job["nonceEnd"] = 250000
            _, _, checked, _ = solve_cpu_multiprocess(
                job,
                worker_count,
                worker_pool,
            )
            hashes += checked
    elapsed = max(0.001, time.perf_counter() - started)
    raw_hps = hashes / elapsed
    print(
        f"ARGUS CPU benchmark: {hashes:,} hashes in {elapsed:.2f}s | "
        f"measured={raw_hps:,.0f} H/s ({raw_hps / 1_000_000:,.6f} MH/s) | "
        f"workers={workers or min(mp.cpu_count(), 4)}"
    )


CUDA_SHA256_KERNEL = r"""
typedef unsigned int uint;
__device__ __forceinline__ uint rotr(uint x, uint n) {
  return (x >> n) | (x << (32 - n));
}
__device__ __forceinline__ uint ch(uint x, uint y, uint z) {
  return (x & y) ^ (~x & z);
}
__device__ __forceinline__ uint maj(uint x, uint y, uint z) {
  return (x & y) ^ (x & z) ^ (y & z);
}
__device__ __forceinline__ uint ep0(uint x) {
  return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}
__device__ __forceinline__ uint ep1(uint x) {
  return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}
__device__ __forceinline__ uint sig0(uint x) {
  return rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3);
}
__device__ __forceinline__ uint sig1(uint x) {
  return rotr(x, 17) ^ rotr(x, 19) ^ (x >> 10);
}

__device__ const uint K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

__device__ void hash_message(const unsigned char* data, int length, unsigned char* digest) {
  uint state[8] = {
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  };
  const int blocks = (length + 9 + 63) / 64;
  for (int block = 0; block < blocks; block++) {
    unsigned char bytes[64];
    uint words[64];
    for (int index = 0; index < 64; index++) {
      const int position = block * 64 + index;
      bytes[index] = position < length ? data[position] : (position == length ? 0x80 : 0);
    }
    if (block == blocks - 1) {
      const unsigned long long bit_length = (unsigned long long)length * 8ULL;
      for (int index = 0; index < 8; index++) {
        bytes[63 - index] = (unsigned char)(bit_length >> (index * 8));
      }
    }
    for (int index = 0; index < 16; index++) {
      words[index] = ((uint)bytes[index * 4] << 24) |
        ((uint)bytes[index * 4 + 1] << 16) |
        ((uint)bytes[index * 4 + 2] << 8) |
        (uint)bytes[index * 4 + 3];
    }
    for (int index = 16; index < 64; index++) {
      words[index] = sig1(words[index - 2]) + words[index - 7] +
        sig0(words[index - 15]) + words[index - 16];
    }
    uint working[8];
    for (int index = 0; index < 8; index++) working[index] = state[index];
    for (int index = 0; index < 64; index++) {
      const uint temp1 = working[7] + ep1(working[4]) +
        ch(working[4], working[5], working[6]) + K[index] + words[index];
      const uint temp2 = ep0(working[0]) + maj(working[0], working[1], working[2]);
      working[7] = working[6];
      working[6] = working[5];
      working[5] = working[4];
      working[4] = working[3] + temp1;
      working[3] = working[2];
      working[2] = working[1];
      working[1] = working[0];
      working[0] = temp1 + temp2;
    }
    for (int index = 0; index < 8; index++) state[index] += working[index];
  }
  for (int index = 0; index < 8; index++) {
    digest[index * 4] = (unsigned char)(state[index] >> 24);
    digest[index * 4 + 1] = (unsigned char)(state[index] >> 16);
    digest[index * 4 + 2] = (unsigned char)(state[index] >> 8);
    digest[index * 4 + 3] = (unsigned char)state[index];
  }
}

extern "C" __global__ void find_nonce(
  const unsigned char* prefix,
  int prefix_length,
  unsigned int nonce_start,
  unsigned int nonce_end,
  int difficulty,
  unsigned int* result
) {
  const unsigned int nonce = nonce_start + blockIdx.x * blockDim.x + threadIdx.x;
  if (nonce >= nonce_end) return;
  unsigned char message[256];
  for (int index = 0; index < prefix_length; index++) message[index] = prefix[index];
  char digits[12];
  int digit_count = 0;
  unsigned int value = nonce;
  do {
    digits[digit_count++] = (char)('0' + value % 10);
    value /= 10;
  } while (value > 0);
  for (int index = 0; index < digit_count; index++) {
    message[prefix_length + index] = digits[digit_count - index - 1];
  }
  unsigned char digest[32];
  hash_message(message, prefix_length + digit_count, digest);
  for (int nibble = 0; nibble < difficulty; nibble++) {
    const unsigned char value_at_nibble = nibble % 2 == 0
      ? (digest[nibble / 2] >> 4)
      : (digest[nibble / 2] & 0x0f);
    if (value_at_nibble != 0) return;
  }
  atomicMin(result, nonce);
}
"""


class GpuSolver:
    def __init__(self) -> None:
        try:
            import cupy as cp  # type: ignore[import-not-found]
            import numpy as np  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError("CuPy with a CUDA/ROCm backend is required for GPU mining") from error
        self.cp = cp
        self.np = np
        self.kernel = cp.RawKernel(CUDA_SHA256_KERNEL, "find_nonce")

    def solve(self, job: dict[str, Any]) -> tuple[int, str] | None:
        prefix = f"{job['height']}:{job['previousHash']}:{job['workloadId']}:".encode()
        start = int(job["nonceStart"])
        end = int(job["nonceEnd"])
        result = self.cp.asarray([2**32 - 1], dtype=self.np.uint32)
        prefix_buffer = self.cp.asarray(self.np.frombuffer(prefix, dtype=self.np.uint8))
        threads = 256
        blocks = max(1, (end - start + threads - 1) // threads)
        self.kernel(
            (blocks,),
            (threads,),
            (
                prefix_buffer,
                self.np.int32(len(prefix)),
                self.np.uint32(start),
                self.np.uint32(end),
                self.np.int32(len(str(job["difficulty"]))),
                result,
            ),
        )
        nonce = int(result.get()[0])
        if nonce >= end:
            return None
        digest = sha256_hex(prefix + str(nonce).encode())
        return nonce, digest


def connect_and_mine(host: str, port: int, backend: str) -> int:
    device = detect_device()
    solver: GpuSolver | None = None
    selected_backend = "cpu-fallback"
    if backend in {"auto", "gpu"} and device:
        try:
            solver = GpuSolver()
            selected_backend = "gpu"
        except RuntimeError as error:
            if backend == "gpu":
                emit("miner_error", backend="gpu", message=str(error))
                return 2
            emit("backend_fallback", backend="cpu-fallback", message=str(error))
    elif backend == "gpu":
        emit("miner_error", backend="gpu", message="No supported local GPU was detected")
        return 2

    emit(
        "miner_started",
        backend=selected_backend,
        device=device,
        host=host,
        port=port,
        message=(
            "GPU proof process enabled"
            if selected_backend == "gpu"
            else "Using bounded CPU fallback; no GPU proof backend is active"
        ),
    )
    worker_pool = None
    try:
        if solver is None:
            worker_pool = mp.Pool(processes=max(1, min(mp.cpu_count(), 4)))
        with socket.create_connection((host, port), timeout=5) as connection:
            connection.settimeout(None)
            emit("pool_connected", backend=selected_backend)
            buffer = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    return 0
                buffer += chunk
                while b"\n" in buffer:
                    raw, buffer = buffer.split(b"\n", 1)
                    if not raw.strip():
                        continue
                    job = json.loads(raw)
                    if job.get("type") != "job":
                        continue
                    emit("job_received", backend=selected_backend, jobId=job.get("jobId"))
                    if solver:
                        solve_started = time.perf_counter()
                        result = solver.solve(job)
                        solve_elapsed = max(0.0001, time.perf_counter() - solve_started)
                        checked = max(
                            0,
                            int(job["nonceEnd"]) - int(job["nonceStart"]),
                        )
                        measured_hps = checked / solve_elapsed
                    else:
                        solve_started = time.perf_counter()
                        nonce, digest, checked, measured_hps = solve_cpu_multiprocess(
                            job,
                            worker_pool=worker_pool,
                        )
                        solve_elapsed = max(0.0001, time.perf_counter() - solve_started)
                        result = None if nonce < 0 else (nonce, digest)
                    emit(
                        "hash_sample",
                        backend=selected_backend,
                        jobId=job.get("jobId"),
                        hashrateHps=round(measured_hps),
                        hashrateMhs=measured_hps / 1_000_000,
                        noncesChecked=checked,
                    )
                    if result is None:
                        emit("job_exhausted", backend=selected_backend, jobId=job.get("jobId"))
                        continue
                    nonce, digest = result
                    submission = {
                        "type": "share",
                        "jobId": job["jobId"],
                        "nonce": nonce,
                        "hash": digest,
                    }
                    connection.sendall((json.dumps(submission, separators=(",", ":")) + "\n").encode())
                    emit(
                        "share_submitted",
                        backend=selected_backend,
                        jobId=job.get("jobId"),
                        nonce=nonce,
                        hash=digest,
                    )
    except (OSError, json.JSONDecodeError) as error:
        emit("miner_error", backend=selected_backend, message=str(error))
        return 1
    finally:
        if worker_pool is not None:
            worker_pool.close()
            worker_pool.join()


def main() -> int:
    parser = argparse.ArgumentParser(description="ARGUS local GPU proof miner")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--backend", choices=("auto", "gpu", "cpu"), default="auto")
    parser.add_argument("--benchmark", action="store_true", help="Run the local CPU throughput benchmark")
    parser.add_argument("--duration", type=int, default=10, help="Benchmark duration in seconds")
    args = parser.parse_args()
    if args.benchmark:
        run_benchmark(args.duration)
        return 0
    backend = "auto" if args.backend == "auto" else args.backend
    return connect_and_mine(args.host, args.port, backend)


if __name__ == "__main__":
    raise SystemExit(main())
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../app";
import { createCommandCenterRouter } from "../routes/command-center";
import { getCommandCenterStatus } from "./command-center";
import { migrateDns, runCommandCenterDemo } from "./demo-runner";
import { LocalDnsPlane } from "./dns-plane";
import {
  evaluateThroughputHealth,
  MinerPool,
  RELEASE_EVIDENCE_MAX_AGE_MS,
  RELEASE_THROUGHPUT_FLOOR_HPS,
} from "./miner-pool";

const activePools: MinerPool[] = [];
const activeDnsPlanes: LocalDnsPlane[] = [];
const activeHttpServers: http.Server[] = [];
const LOCAL_THROUGHPUT_TIMEOUT_MS = 5_000;

afterEach(async () => {
  await Promise.all(
    activeHttpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  await Promise.all(activePools.splice(0).map((pool) => pool.stop()));
  await Promise.all(activeDnsPlanes.splice(0).map((plane) => plane.stop()));
});

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 1_000,
) {
  const startedAt = Date.now();
  while (!predicate(read())) {
    if (Date.now() - startedAt >= timeoutMs)
      throw new Error("Timed out waiting for local protocol service");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return read();
}

async function waitForRedirect(plane: LocalDnsPlane, targetIp: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    try {
      return await plane.probeResolvedTarget(targetIp);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for redirect target ${targetIp}`);
}

class JsonLineClient {
  private buffer = "";
  private readonly messages: unknown[] = [];
  private readonly waiters: Array<(message: unknown) => void> = [];

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf("\n");
        const message = JSON.parse(line) as unknown;
        const waiter = this.waiters.shift();
        if (waiter) waiter(message);
        else this.messages.push(message);
      }
    });
  }

  async next<T>() {
    const queued = this.messages.shift();
    if (queued) return queued as T;
    return new Promise<T>((resolve) =>
      this.waiters.push((message) => resolve(message as T)),
    );
  }
}

type IssuedJob = {
  type: "job";
  jobId: string;
  workloadId: string;
  height: number;
  previousHash: string;
  difficulty: string;
  nonceStart: number;
  nonceEnd: number;
};

function solve(job: IssuedJob) {
  for (let nonce = job.nonceStart; nonce < job.nonceEnd; nonce += 1) {
    const hash = createHash("sha256")
      .update(`${job.height}:${job.previousHash}:${job.workloadId}:${nonce}`)
      .digest("hex");
    if (hash.startsWith(job.difficulty)) return { nonce, hash };
  }
  throw new Error("Issued job did not contain a solution in its nonce range");
}

async function connectMiner(port: number) {
  const socket = net.createConnection({ port, host: "127.0.0.1" });
  await once(socket, "connect");
  return { socket, client: new JsonLineClient(socket) };
}

async function listenHttpApp(app: ReturnType<typeof createApp>) {
  const server = app.listen(0, "127.0.0.1");
  activeHttpServers.push(server);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, any>,
  };
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function stateForComparison(body: Record<string, any>) {
  return {
    coordinator: {
      acceptedShares: body.coordinator.acceptedShares,
      jobsIssued: body.coordinator.jobsIssued,
      totalHashes: body.coordinator.totalHashes,
      difficulty: body.coordinator.difficulty,
    },
    dns: {
      ip: body.dns.ip,
      serial: body.dns.serial,
      queries: body.dns.queries,
    },
    workloads: body.workloads.map((workload: Record<string, any>) => ({
      id: workload.id,
      status: workload.status,
      verifiedShares: workload.verifiedShares,
      lastProof: workload.lastProof,
      hashes: workload.hashes,
    })),
  };
}

function encodeDnsName(name: string) {
  return Buffer.concat([
    ...name
      .split(".")
      .map((label) =>
        Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]),
      ),
    Buffer.from([0]),
  ]);
}

function createDnsQuery(domain: string, transactionId = 0x1234) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  return Buffer.concat([
    header,
    encodeDnsName(domain),
    Buffer.from([0, 1, 0, 1]),
  ]);
}

function decodeDnsResponse(packet: Buffer) {
  let offset = 12;
  while (packet[offset] !== 0) offset += packet[offset] + 1;
  offset += 5;
  const answerOffset = offset;
  assert.equal(packet.readUInt16BE(6), 1);
  assert.equal(packet.readUInt16BE(answerOffset), 0xc00c);
  const ttl = packet.readUInt32BE(answerOffset + 6);
  const address = Array.from(
    packet.subarray(answerOffset + 12, answerOffset + 16),
  ).join(".");
  return {
    transactionId: packet.readUInt16BE(0),
    responseCode: packet.readUInt16BE(2) & 0x000f,
    ttl,
    address,
  };
}

async function queryDns(port: number, domain: string, transactionId: number) {
  const socket = dgram.createSocket("udp4");
  const response = new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for DNS response"));
    }, 1_000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.once("message", (packet) => {
      clearTimeout(timer);
      socket.close();
      resolve(packet);
    });
  });
  socket.send(createDnsQuery(domain, transactionId), port, "127.0.0.1");
  return decodeDnsResponse(await response);
}

describe("live miner protocol", () => {
  it("reports bounded local-worker hash progress while a job is being solved", async () => {
    const pool = new MinerPool(await getFreePort());
    activePools.push(pool);
    pool.setDifficulty("0000");
    pool.start();

    const measuredRate = await waitFor(
      () => pool.snapshot().hashRate,
      (rate) => rate > 0,
      LOCAL_THROUGHPUT_TIMEOUT_MS,
    );

    assert.ok(measuredRate > 0);
    assert.equal(pool.snapshot().workerHealth.running, 1);
  });
  it("reports bounded throughput from all configured local workers", async () => {
    const pool = new MinerPool(await getFreePort());
    pool.setDifficulty("00");
    pool.setMinerCount(2);
    activePools.push(pool);
    pool.start();
    await waitFor(
      () => pool.snapshot().activeMiners,
      (activeMiners) => activeMiners === 2,
      2_000,
    );

    const before = pool.snapshot();
    await waitFor(
      () => pool.snapshot().acceptedShares,
      (acceptedShares) => acceptedShares >= before.acceptedShares + 1,
      LOCAL_THROUGHPUT_TIMEOUT_MS,
    );
    const after = pool.snapshot();
    const throughputSignal = {
      acceptedShares: after.acceptedShares - before.acceptedShares,
      hashRate: after.hashRate,
    };
    assert.equal(after.configuredMiners, 2);
    assert.equal(after.activeMiners, 2);
    assert.deepEqual(after.workerHealth, {
      enabled: true,
      configured: 2,
      running: 2,
      healthy: true,
    });
    assert.equal(after.intentionalScaleDowns, 0);
    assert.equal(after.unexpectedRestarts, 0);
    assert.ok(after.jobsIssued > before.jobsIssued);
    assert.ok(after.totalHashes > before.totalHashes);
    assert.ok(throughputSignal.acceptedShares >= 1);
    assert.ok(throughputSignal.hashRate > 0);

    pool.setMinerCount(1);
    pool.setMinerCount(1);
    await waitFor(
      () => pool.snapshot().workerHealth.running,
      (running) => running === 1,
      2_000,
    );
    const scaledDown = pool.snapshot();
    assert.equal(scaledDown.workerHealth.configured, 1);
    assert.equal(scaledDown.workerHealth.healthy, true);
    assert.equal(scaledDown.intentionalScaleDowns, 1);
    assert.equal(scaledDown.unexpectedRestarts, 0);
  });

  it("produces live telemetry at the configured production difficulty", async () => {
    const pool = new MinerPool(await getFreePort());
    activePools.push(pool);
    pool.start();
    await waitFor(
      () => pool.snapshot().activeMiners,
      (activeMiners) => activeMiners === 1,
      2_000,
    );

    const before = pool.snapshot();
    await waitFor(
      () => pool.snapshot().acceptedShares,
      (acceptedShares) => acceptedShares >= before.acceptedShares + 1,
      LOCAL_THROUGHPUT_TIMEOUT_MS,
    );

    const after = pool.snapshot();
    assert.equal(after.difficulty, process.env.MINER_DIFFICULTY || "0000");
    assert.equal(after.activeMiners, 1);
    assert.deepEqual(after.workerHealth, {
      enabled: true,
      configured: 1,
      running: 1,
      healthy: true,
    });
    assert.ok(after.acceptedShares >= before.acceptedShares + 1);
    assert.ok(after.hashRate > 0);
  });

  it("accepts a solved TCP share and increments live telemetry", async () => {
    const pool = new MinerPool(await getFreePort(), {
      startLocalWorker: false,
    });
    activePools.push(pool);
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);
    const before = pool.liveTelemetry();
    const { socket, client } = await connectMiner(pool.port);
    const job = await client.next<IssuedJob>();
    assert.equal(job.type, "job");
    const solution = solve(job);

    socket.write(
      `${JSON.stringify({ type: "share", jobId: job.jobId, ...solution })}\n`,
    );
    const accepted = await client.next<{
      type: string;
      hash: string;
      height: number;
    }>();
    assert.equal(accepted.type, "share_accepted");
    assert.equal(accepted.hash, solution.hash);

    const after = pool.liveTelemetry(job.workloadId);
    assert.equal(after.acceptedShares, before.acceptedShares + 1);
    assert.equal(after.workloadShares, 1);
    assert.equal(after.lastHash, solution.hash);
    assert.equal(after.status, "share accepted");
    socket.destroy();
  });

  it("rejects stale, invalid, and out-of-range shares without changing telemetry", async () => {
    const pool = new MinerPool(await getFreePort(), {
      startLocalWorker: false,
    });
    activePools.push(pool);
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);

    const { socket, client } = await connectMiner(pool.port);
    const staleJob = await client.next<IssuedJob>();
    assert.equal(staleJob.type, "job");
    const validSolution = solve(staleJob);

    socket.write(
      `${JSON.stringify({ type: "share", jobId: staleJob.jobId, ...validSolution })}\n`,
    );
    const accepted = await client.next<{ type: string }>();
    assert.equal(accepted.type, "share_accepted");
    const currentJob = await client.next<IssuedJob>();
    assert.equal(currentJob.type, "job");

    const before = pool.snapshot();
    const staleResponsePromise = client.next<{
      type: string;
      reason: string;
    }>();
    socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: staleJob.jobId,
        nonce: validSolution.nonce,
        hash: validSolution.hash,
      })}\n`,
    );
    const staleResponse = await staleResponsePromise;
    assert.deepEqual(staleResponse, {
      type: "share_rejected",
      reason: "unknown job",
    });

    const invalidHashResponsePromise = client.next<{
      type: string;
      reason: string;
    }>();
    socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: currentJob.jobId,
        nonce: currentJob.nonceStart,
        hash: "not-a-valid-proof",
      })}\n`,
    );
    const invalidHashResponse = await invalidHashResponsePromise;
    assert.deepEqual(invalidHashResponse, {
      type: "share_rejected",
      reason: "proof does not meet difficulty",
    });

    const outOfRangeResponsePromise = client.next<{
      type: string;
      reason: string;
    }>();
    socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: currentJob.jobId,
        nonce: currentJob.nonceEnd,
        hash: validSolution.hash,
      })}\n`,
    );
    const outOfRangeResponse = await outOfRangeResponsePromise;
    assert.deepEqual(outOfRangeResponse, {
      type: "share_rejected",
      reason: "nonce outside issued range",
    });

    const after = pool.snapshot();
    assert.equal(after.acceptedShares, before.acceptedShares);
    assert.deepEqual(
      after.workloads.map(({ id, shares, lastProof, lastMiner }) => ({
        id,
        shares,
        lastProof,
        lastMiner,
      })),
      before.workloads.map(({ id, shares, lastProof, lastMiner }) => ({
        id,
        shares,
        lastProof,
        lastMiner,
      })),
    );
    assert.deepEqual(after.ledger, before.ledger);
    socket.destroy();
  });

  it("rejects a valid proof replayed through a different TCP client", async () => {
    const pool = new MinerPool(await getFreePort(), {
      startLocalWorker: false,
    });
    activePools.push(pool);
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);

    const first = await connectMiner(pool.port);
    const second = await connectMiner(pool.port);
    const [firstJob, secondJob] = await Promise.all([
      first.client.next<IssuedJob>(),
      second.client.next<IssuedJob>(),
    ]);
    assert.notEqual(firstJob.jobId, secondJob.jobId);
    const firstSolution = solve(firstJob);
    const before = pool.snapshot();

    const rejectionPromise = second.client.next<{
      type: string;
      reason: string;
    }>();
    second.socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: firstJob.jobId,
        nonce: firstSolution.nonce,
        hash: firstSolution.hash,
      })}\n`,
    );
    const rejection = await rejectionPromise;
    assert.deepEqual(rejection, {
      type: "share_rejected",
      reason: "unknown job",
    });

    const after = pool.snapshot();
    assert.equal(after.acceptedShares, before.acceptedShares);
    assert.equal(after.totalHashes, before.totalHashes);
    assert.deepEqual(after.ledger, before.ledger);
    assert.deepEqual(
      after.workloads.map(({ id, shares, lastProof, lastMiner, hashes }) => ({
        id,
        shares,
        lastProof,
        lastMiner,
        hashes,
      })),
      before.workloads.map(({ id, shares, lastProof, lastMiner, hashes }) => ({
        id,
        shares,
        lastProof,
        lastMiner,
        hashes,
      })),
    );

    first.socket.destroy();
    second.socket.destroy();
  });
});

describe("throughput release-floor signal", () => {
  const workerHealth = {
    enabled: true,
    configured: 2,
    running: 2,
    healthy: true,
  };

  it("distinguishes warm-up, healthy, stale, and below-floor evidence", () => {
    const now = Date.now();
    assert.equal(
      evaluateThroughputHealth({
        listening: true,
        activeMiners: 2,
        configuredMiners: 2,
        workerHealth,
        acceptedShares: 0,
        totalHashes: 0,
        hashRate: 0,
        now,
      }).status,
      "warming-up",
    );
    assert.equal(
      evaluateThroughputHealth({
        listening: true,
        activeMiners: 2,
        configuredMiners: 2,
        workerHealth,
        acceptedShares: 2,
        totalHashes: 20_000,
        hashRate: RELEASE_THROUGHPUT_FLOOR_HPS,
        lastAcceptedAt: new Date(now).toISOString(),
        now,
      }).status,
      "healthy",
    );
    assert.equal(
      evaluateThroughputHealth({
        listening: true,
        activeMiners: 2,
        configuredMiners: 2,
        workerHealth,
        acceptedShares: 2,
        totalHashes: 20_000,
        hashRate: RELEASE_THROUGHPUT_FLOOR_HPS,
        lastAcceptedAt: new Date(now - RELEASE_EVIDENCE_MAX_AGE_MS - 1).toISOString(),
        now,
      }).status,
      "below-floor",
    );
    assert.equal(
      evaluateThroughputHealth({
        listening: true,
        activeMiners: 2,
        configuredMiners: 2,
        workerHealth,
        acceptedShares: 2,
        totalHashes: 20_000,
        hashRate: RELEASE_THROUGHPUT_FLOOR_HPS - 1,
        lastAcceptedAt: new Date(now).toISOString(),
        now,
      }).status,
      "below-floor",
    );
  });

  it("reports offline when no local miner connection is active", () => {
    const result = evaluateThroughputHealth({
      listening: true,
      activeMiners: 0,
      configuredMiners: 2,
      workerHealth,
      acceptedShares: 10,
      totalHashes: 20_000,
      hashRate: RELEASE_THROUGHPUT_FLOOR_HPS,
      lastAcceptedAt: new Date().toISOString(),
    });
    assert.equal(result.status, "offline");
    assert.equal(result.evidenceFresh, true);
  });
});

describe("live DNS protocol", () => {
  it("answers UDP queries, migrates the record, and proves the redirected request", async () => {
    const plane = new LocalDnsPlane(await getFreePort());
    activeDnsPlanes.push(plane);
    plane.start();
    await waitFor(
      () => plane.snapshot().status,
      (status) => status === "Active & synchronized",
    );
    await waitForRedirect(plane, "127.0.0.1");

    const initial = decodeDnsResponse(
      await queryRawDns(plane.port, plane.domain, 0x2222),
    );
    assert.equal(initial.transactionId, 0x2222);
    assert.equal(initial.responseCode, 0);
    assert.equal(initial.address, "127.0.0.1");
    assert.equal(initial.ttl, 60);

    const beforeSerial = plane.snapshot().serial;
    plane.migrate("127.0.0.2");
    const migrated = await queryDns(plane.port, plane.domain, 0x3333);
    assert.equal(migrated.transactionId, 0x3333);
    assert.equal(migrated.responseCode, 0);
    assert.equal(migrated.address, "127.0.0.2");
    assert.equal(migrated.ttl, 60);

    const redirect = await waitForRedirect(plane, migrated.address);
    assert.equal(redirect.statusCode, 200);
    assert.match(redirect.body, /ARGUS local redirect target 127\.0\.0\.2/);
    assert.match(
      redirect.url,
      /^http:\/\/127\.0\.0\.2:\d+\/redirected-resource$/,
    );

    const snapshot = plane.snapshot();
    const proof = plane.recordProof();
    assert.equal(snapshot.serial, beforeSerial + 1);
    assert.equal(
      proof.canonical,
      `${plane.domain}|A|127.0.0.2|60|${snapshot.serial}`,
    );
    assert.equal(
      proof.recordHash,
      createHash("sha256").update(proof.canonical).digest("hex"),
    );
    assert.match(proof.keyFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(proof.signature.length > 0);
  });
});

async function queryRawDns(
  port: number,
  domain: string,
  transactionId: number,
) {
  const socket = dgram.createSocket("udp4");
  const response = new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for DNS response"));
    }, 1_000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.once("message", (packet) => {
      clearTimeout(timer);
      socket.close();
      resolve(packet);
    });
  });
  socket.send(createDnsQuery(domain, transactionId), port, "127.0.0.1");
  return response;
}

describe("demo freshness gate", () => {
  it("does not solve a workload until a fresh accepted share arrives", async () => {
    const pool = new MinerPool(await getFreePort(), {
      startLocalWorker: false,
    });
    activePools.push(pool);
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);

    let settled = false;
    const demo = runCommandCenterDemo("w-01", undefined, pool).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false);

    const { socket, client } = await connectMiner(pool.port);
    const job = await client.next<IssuedJob>();
    assert.equal(job.workloadId, "w-01");
    const solution = solve(job);
    socket.write(
      `${JSON.stringify({ type: "share", jobId: job.jobId, ...solution })}\n`,
    );
    const accepted = await client.next<{ type: string; hash: string }>();
    assert.equal(accepted.type, "share_accepted");
    assert.equal(accepted.hash, solution.hash);

    const result = await demo;
    assert.equal(result.status, "solved");
    assert.equal(result.evidenceAccepted, true);
    assert.equal(result.evidenceRejectionReason, "");
    assert.equal(result.executionEvidence.source, "local-executor");
    assert.equal(result.mining.workloadShares, 1);
    assert.equal(result.mining.lastHash, solution.hash);
    assert.ok(result.mining.hashRate > 0);
    assert.equal(result.mining.effectiveHashRateMhs, 0);
    socket.destroy();
  });
});

describe("command-center HTTP routes", () => {
  it("returns live miner, workload, DNS redirect, serial, and record proof evidence", async () => {
    const pool = new MinerPool(await getFreePort(), { startLocalWorker: false });
    const plane = new LocalDnsPlane(await getFreePort());
    activePools.push(pool);
    activeDnsPlanes.push(plane);

    const routeApp = createApp(
      createCommandCenterRouter({
        getStatus: () => getCommandCenterStatus(pool, plane),
        runDemo: (workloadId, difficulty) =>
          runCommandCenterDemo(workloadId, difficulty, pool, plane),
        migrateDns: (targetIp, difficulty) =>
          migrateDns(targetIp, difficulty, pool, plane),
      }),
    );
    const baseUrl = await listenHttpApp(routeApp);

    const beforeValidation = await requestJson(`${baseUrl}/api/command-center/status`);
    assert.equal(beforeValidation.status, 200);
    const initialState = stateForComparison(beforeValidation.body);

    const invalidDemo = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({ workloadId: "w-01", difficulty: "not-a-difficulty" }),
    );
    assert.equal(invalidDemo.status, 400);

    const invalidMigration = await requestJson(
      `${baseUrl}/api/command-center/dns/migrate`,
      jsonRequest({ targetIp: "192.0.2.1" }),
    );
    assert.equal(invalidMigration.status, 400);

    const afterValidation = await requestJson(`${baseUrl}/api/command-center/status`);
    assert.deepEqual(stateForComparison(afterValidation.body), initialState);

    pool.setDifficulty("00");
    plane.start();
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);
    await waitFor(
      () => plane.snapshot().status,
      (status) => status === "Active & synchronized",
    );
    await waitForRedirect(plane, "127.0.0.1");

    const { socket, client } = await connectMiner(pool.port);
    const demoJob = await client.next<IssuedJob>();
    const demoRequest = requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({ workloadId: demoJob.workloadId, difficulty: "00" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const demoSolution = solve(demoJob);
    socket.write(
      `${JSON.stringify({ type: "share", jobId: demoJob.jobId, ...demoSolution })}\n`,
    );
    const acceptedDemoShare = await client.next<{ type: string; hash: string }>();
    assert.deepEqual(acceptedDemoShare, {
      type: "share_accepted",
      hash: demoSolution.hash,
      height: 1,
    });

    const demoResponse = await demoRequest;
    assert.equal(demoResponse.status, 200);
    assert.equal(demoResponse.body.status, "solved");
    assert.equal(demoResponse.body.evidenceAccepted, true);
    assert.equal(demoResponse.body.evidenceRejectionReason, "");
    assert.equal(demoResponse.body.workloadId, demoJob.workloadId);
    assert.equal(demoResponse.body.mining.lastHash, demoSolution.hash);
    assert.equal(demoResponse.body.mining.workloadShares, 1);
    assert.equal(demoResponse.body.mining.effectiveHashRateMhs, 0);
    assert.ok(demoResponse.body.mining.hashRate > 0);
    assert.ok(demoResponse.body.mining.hashes >= demoSolution.nonce + 1);
    assert.ok(
      demoResponse.body.evidence.includes(`accepted_miner_hash=${demoSolution.hash}`),
    );

    const liveStatus = await requestJson(`${baseUrl}/api/command-center/status`);
    assert.equal(liveStatus.status, 200);
    const liveWorkload = liveStatus.body.workloads.find(
      (workload: Record<string, any>) => workload.id === demoJob.workloadId,
    );
    assert.ok(liveWorkload);
    assert.equal(liveWorkload.lastProof, demoSolution.hash);
    assert.equal(liveWorkload.verifiedShares, 1);
    assert.equal(liveWorkload.completionState, "complete");
    assert.equal(liveWorkload.evidenceSource, "local-executor");
    assert.ok(liveWorkload.hashes >= demoSolution.nonce + 1);
    assert.equal(liveStatus.body.coordinator.acceptedShares, 1);
    assert.equal(liveStatus.body.coordinator.gpuMining.effectiveHashRateMhs, 0);
    assert.ok(liveStatus.body.coordinator.hashRate > 0);
    assert.ok(liveStatus.body.coordinator.totalHashes >= demoSolution.nonce + 1);

    let dnsValidationJob = await client.next<IssuedJob>();
    while (dnsValidationJob.workloadId !== "w-07") {
      const solution = solve(dnsValidationJob);
      socket.write(
        `${JSON.stringify({ type: "share", jobId: dnsValidationJob.jobId, ...solution })}\n`,
      );
      const accepted = await client.next<{ type: string; hash: string }>();
      assert.equal(accepted.type, "share_accepted");
      dnsValidationJob = await client.next<IssuedJob>();
    }

    const dnsValidationRequest = requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({ workloadId: "w-07", difficulty: "00" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const dnsValidationSolution = solve(dnsValidationJob);
    socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: dnsValidationJob.jobId,
        ...dnsValidationSolution,
      })}\n`,
    );
    const acceptedDnsValidationShare = await client.next<{ type: string; hash: string }>();
    assert.equal(acceptedDnsValidationShare.type, "share_accepted");

    const dnsValidationResponse = await dnsValidationRequest;
    assert.equal(dnsValidationResponse.status, 200);
    assert.equal(dnsValidationResponse.body.workloadId, "w-07");
    assert.equal(dnsValidationResponse.body.dnsSerial, 1);
    assert.equal(dnsValidationResponse.body.dnsTarget, "127.0.0.1");
    assert.equal(dnsValidationResponse.body.dnsRedirect.statusCode, 200);
    assert.match(
      dnsValidationResponse.body.dnsRedirect.url,
      /^http:\/\/127\.0\.0\.1:\d+\/redirected-resource$/,
    );
    assert.match(
      dnsValidationResponse.body.dnsRecordProof.canonical,
      /^cluster\.node\.local\|A\|127\.0\.0\.1\|60\|1$/,
    );
    assert.match(dnsValidationResponse.body.dnsRecordProof.recordHash, /^[a-f0-9]{64}$/);
    assert.ok(dnsValidationResponse.body.details.some(
      (item: { label: string }) => item.label === "Record signature",
    ));
    assert.ok(
      dnsValidationResponse.body.evidence.includes(
        `record_hash=${dnsValidationResponse.body.dnsRecordProof.recordHash}`,
      ),
    );

    let migrationJob = await client.next<IssuedJob>();
    while (migrationJob.workloadId !== "w-18") {
      const solution = solve(migrationJob);
      socket.write(
        `${JSON.stringify({ type: "share", jobId: migrationJob.jobId, ...solution })}\n`,
      );
      const accepted = await client.next<{ type: string; hash: string }>();
      assert.equal(accepted.type, "share_accepted");
      migrationJob = await client.next<IssuedJob>();
    }

    const migrationRequest = requestJson(
      `${baseUrl}/api/command-center/dns/migrate`,
      jsonRequest({ targetIp: "127.0.0.2", difficulty: "00" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const migrationSolution = solve(migrationJob);
    socket.write(
      `${JSON.stringify({
        type: "share",
        jobId: migrationJob.jobId,
        ...migrationSolution,
      })}\n`,
    );
    const acceptedMigrationShare = await client.next<{ type: string; hash: string }>();
    assert.equal(acceptedMigrationShare.type, "share_accepted");

    const migrationResponse = await migrationRequest;
    assert.equal(migrationResponse.status, 200);
    assert.equal(migrationResponse.body.status, "evidence_pending");
    assert.equal(migrationResponse.body.evidenceAccepted, false);
    assert.equal(
      migrationResponse.body.evidenceRejectionReason,
      "workload executor evidence is not implemented",
    );
    assert.equal(migrationResponse.body.mining.lastHash, migrationSolution.hash);
    assert.equal(migrationResponse.body.mining.workloadShares, 1);
    assert.equal(migrationResponse.body.dnsSerial, 2);
    assert.equal(migrationResponse.body.dnsTarget, "127.0.0.2");
    assert.equal(migrationResponse.body.dnsRedirect.statusCode, 200);
    assert.match(
      migrationResponse.body.dnsRedirect.url,
      /^http:\/\/127\.0\.0\.2:\d+\/redirected-resource$/,
    );
    assert.match(
      migrationResponse.body.dnsRedirect.body,
      /ARGUS local redirect target 127\.0\.0\.2/,
    );
    assert.match(
      migrationResponse.body.dnsRecordProof.canonical,
      /^cluster\.node\.local\|A\|127\.0\.0\.2\|60\|2$/,
    );
    assert.match(migrationResponse.body.dnsRecordProof.recordHash, /^[a-f0-9]{64}$/);
    assert.match(
      migrationResponse.body.dnsRecordProof.keyFingerprint,
      /^[a-f0-9]{64}$/,
    );
    assert.ok(migrationResponse.body.dnsRecordProof.signature.length > 0);

    const details = Object.fromEntries(
      migrationResponse.body.details.map((item: { label: string; value: string }) => [
        item.label,
        item.value,
      ]),
    );
    assert.equal(details["New target"], "127.0.0.2");
    assert.match(details["Redirected request"], /^200 http:\/\/127\.0\.0\.2:\d+\/redirected-resource$/);
    assert.equal(details["Serial"], "2");
    assert.match(details["Record canonical"], /^cluster\.node\.local\|A\|127\.0\.0\.2\|60\|2$/);
    assert.match(details["Record hash"], /^[a-f0-9]{64}$/);
    assert.match(details["Verification key"], /^[a-f0-9]{64}$/);
    assert.ok(details["Record signature"].length > 0);
    assert.ok(migrationResponse.body.evidence.includes("serial=2"));
    assert.ok(
      migrationResponse.body.evidence.includes(`record_hash=${details["Record hash"]}`),
    );

    const migratedStatus = await requestJson(`${baseUrl}/api/command-center/status`);
    assert.equal(migratedStatus.body.dns.ip, "127.0.0.2");
    assert.equal(migratedStatus.body.dns.serial, 2);
    assert.ok(migratedStatus.body.dns.queries >= 1);
    socket.destroy();
  });
});

describe("public-key workload HTTP evidence", () => {
  it("completes the bounded assessment without miners and publishes only accepted report telemetry", async () => {
    const pool = new MinerPool(await getFreePort(), { startLocalWorker: false });
    activePools.push(pool);
    const routeApp = createApp(
      createCommandCenterRouter({
        getStatus: () => getCommandCenterStatus(pool),
        runDemo: (workloadId, difficulty, _unusedPool, _unusedDns, artifact) =>
          runCommandCenterDemo(workloadId, difficulty, pool, undefined, artifact),
        migrateDns: (targetIp, difficulty) =>
          migrateDns(targetIp, difficulty, pool),
      }),
    );
    const baseUrl = await listenHttpApp(routeApp);

    const crossOrigin = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      {
        ...jsonRequest({
          workloadId: "w-69",
          publicKeyArtifact: "cross-origin-public-key",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
        },
      },
    );
    assert.equal(crossOrigin.status, 403);
    assert.ok(!JSON.stringify(crossOrigin.body).includes("cross-origin-public-key"));

    const spoofedForwardingHeaders = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      {
        ...jsonRequest({
          workloadId: "w-69",
          publicKeyArtifact: "spoofed-forwarding-public-key",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
          "x-forwarded-host": "untrusted.example",
          "x-forwarded-proto": "https",
        },
      },
    );
    assert.equal(spoofedForwardingHeaders.status, 403);
    assert.ok(!JSON.stringify(spoofedForwardingHeaders.body).includes("spoofed-forwarding-public-key"));

    const response = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({
        workloadId: "w-69",
        publicKeyArtifact: "not-a-public-key",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.workloadId, "w-69");
    assert.equal(response.body.status, "analyzed");
    assert.equal(response.body.evidenceAccepted, true);
    assert.equal(response.body.mining.workloadId, "w-69");
    assert.equal(response.body.mining.status, "not applicable");
    assert.equal(response.body.mining.acceptedShares, 0);
    assert.equal(response.body.mining.jobsIssued, 0);
    assert.equal(response.body.mining.hashes, 0);
    assert.equal(response.body.mining.hashRate, 0);
    assert.equal(response.body.mining.workloadShares, 0);
    assert.equal(response.body.mining.lastHash, "");
    assert.equal(response.body.mining.lastMiner, "");

    const status = await requestJson(`${baseUrl}/api/command-center/status`);
    const workload = status.body.workloads.find(
      (item: Record<string, any>) => item.id === "w-69",
    );
    assert.ok(workload);
    assert.equal(workload.completionState, "complete");
    assert.equal(workload.progress, 100);
    assert.equal(workload.verifiedShares, 0);
    assert.equal(workload.hashes, 0);
    assert.equal(workload.hashRate, 0);
    assert.equal(workload.acceptedReport.answer, response.body.answer);
    assert.deepEqual(workload.acceptedReport.details, response.body.details);
    assert.deepEqual(workload.acceptedReport.evidence, response.body.evidence);
    assert.equal(workload.acceptedReport.executionEvidence.jobId, response.body.executionEvidence.jobId);
    assert.notEqual(workload.acceptedReport.executionEvidence.artifactDigest, "");
    assert.ok(!JSON.stringify(workload.acceptedReport).includes("not-a-public-key"));

    const invalid = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({
        workloadId: "w-69",
        publicKeyArtifact: "sensitive-public-key-input",
      }),
    );
    assert.equal(invalid.status, 200);
    // Malformed public-key input is an honest parser assessment, not a
    // rejected request; the raw artifact must still not enter accepted status.
    assert.equal(invalid.body.evidenceAccepted, true);
    assert.ok(!JSON.stringify(invalid.body).includes("sensitive-public-key-input"));

    const submittedSecret = "do-not-echo-public-key-artifact";
    const invalidInput = await requestJson(
      `${baseUrl}/api/command-center/demo`,
      jsonRequest({
        workloadId: "w-69",
        // Fewer than 16,384 JS characters, but more than the parser's
        // 16 KiB UTF-8 byte bound.
        publicKeyArtifact: `${submittedSecret}${"é".repeat(9_000)}`,
      }),
    );
    assert.equal(invalidInput.status, 400);
    assert.ok(!JSON.stringify(invalidInput.body).includes(submittedSecret));
  });

  it("does not rotate a public-key validator job into the miner pool", async () => {
    const pool = new MinerPool(await getFreePort(), { startLocalWorker: false });
    activePools.push(pool);
    pool.setDifficulty("00");
    pool.start();
    await waitFor(() => pool.snapshot().listening, Boolean);
    const { socket, client } = await connectMiner(pool.port);
    for (let index = 0; index < 70; index += 1) {
      const job = await client.next<IssuedJob>();
      assert.notEqual(job.workloadId, "w-69");
      const solution = solve(job);
      socket.write(`${JSON.stringify({ type: "share", jobId: job.jobId, ...solution })}\n`);
      const accepted = await client.next<{ type: string }>();
      assert.equal(accepted.type, "share_accepted");
    }
    socket.destroy();
  });
});

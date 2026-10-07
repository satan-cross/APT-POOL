import dgram from "node:dgram";
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { isIP } from "node:net";
import { logger } from "./logger";

type DnsRecord = {
  domain: string;
  targetIp: string;
  ttl: number;
  serial: number;
};

type QueryLog = {
  id: string;
  requestedName: string;
  qtype: string;
  answer: string;
  responseCode: string;
  timestamp: string;
};

const DEFAULT_DOMAIN = "cluster.node.local";
const DEFAULT_TTL = 60;
const ALLOWED_LAB_IPS = new Set(["127.0.0.1", "127.0.0.2"]);

function readName(packet: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let cursor = offset;
  while (cursor < packet.length) {
    const length = packet[cursor];
    cursor += 1;
    if (length === 0) return { name: labels.join(".").toLowerCase(), next: cursor };
    if ((length & 0xc0) !== 0 || cursor + length > packet.length) {
      throw new Error("unsupported or truncated DNS name");
    }
    labels.push(packet.subarray(cursor, cursor + length).toString("ascii"));
    cursor += length;
  }
  throw new Error("unterminated DNS name");
}

function encodeName(name: string): Buffer {
  return Buffer.concat([
    ...name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

export class LocalDnsPlane {
  readonly port: number;
  readonly domain: string;
  private readonly socket = dgram.createSocket("udp4");
  private readonly targetServers: http.Server[] = [];
  private readonly targetPorts = new Map<string, number>();
  private readonly signingKeys = generateKeyPairSync("ed25519");
  private record: DnsRecord;
  private readonly queries: QueryLog[] = [];
  private totalQueries = 0;
  private started = false;

  constructor(port = Number(process.env.DNS_PORT ?? 5353), domain = DEFAULT_DOMAIN) {
    this.port = port;
    this.domain = domain;
    this.record = {
      domain,
      targetIp: "127.0.0.1",
      ttl: DEFAULT_TTL,
      serial: 1,
    };

    this.socket.on("message", (packet, rinfo) => {
      try {
        const response = this.respond(packet);
        this.socket.send(response, rinfo.port, rinfo.address);
      } catch (error) {
        logger.warn({ err: error }, "Rejected malformed DNS packet");
      }
    });
    this.socket.on("error", (error) => {
      logger.error({ err: error, port: this.port }, "Local DNS plane error");
    });
  }

  start() {
    if (this.started) return;
    this.socket.bind(this.port, "127.0.0.1", () => {
      this.started = true;
      logger.info({ port: this.port, domain: this.domain }, "Local authoritative DNS plane listening");
    });
    for (const ip of ALLOWED_LAB_IPS) {
      const target = http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(`ARGUS local redirect target ${ip}\n`);
      });
      target.on("error", (error) => logger.warn({ err: error, ip }, "Local redirect target error"));
      target.on("listening", () => {
        const address = target.address();
        if (address && typeof address !== "string") this.targetPorts.set(ip, address.port);
      });
      target.listen(0, ip);
      this.targetServers.push(target);
    }
  }

  async stop() {
    this.started = false;
    await Promise.all(
      this.targetServers.map(
        (target) =>
          new Promise<void>((resolve, reject) => {
            if (!target.listening) {
              resolve();
              return;
            }
            target.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    this.targetPorts.clear();
    await new Promise<void>((resolve, reject) => {
      try {
        this.socket.close(() => resolve());
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING") {
          resolve();
          return;
        }
        reject(error);
      }
    });
  }

  private respond(packet: Buffer): Buffer {
    if (packet.length < 17) throw new Error("short DNS packet");
    const transactionId = packet.subarray(0, 2);
    const requestFlags = packet.readUInt16BE(2);
    const question = readName(packet, 12);
    if (question.next + 4 > packet.length) throw new Error("missing DNS question");
    const qtype = packet.readUInt16BE(question.next);
    const qclass = packet.readUInt16BE(question.next + 2);
    const questionSection = packet.subarray(12, question.next + 4);
    const isARecord = question.name === this.record.domain && qtype === 1 && qclass === 1;
    const responseCode = isARecord ? 0 : 3;
    const flags = 0x8000 | (requestFlags & 0x0100) | responseCode;
    let answer = Buffer.alloc(0);
    if (isARecord) {
      answer = Buffer.concat([
        Buffer.from([0xc0, 0x0c]),
        Buffer.from([0, 1, 0, 1]),
        Buffer.alloc(4),
        Buffer.from([0, 4]),
        Buffer.from(this.record.targetIp.split(".").map(Number)),
      ]);
      answer.writeUInt32BE(this.record.ttl, 6);
    }
    const header = Buffer.alloc(12);
    transactionId.copy(header, 0);
    header.writeUInt16BE(flags, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(isARecord ? 1 : 0, 6);
    const response = Buffer.concat([header, questionSection, answer]);
    this.queries.unshift({
      id: randomBytes(6).toString("hex"),
      requestedName: question.name,
      qtype: qtype === 1 ? "A" : String(qtype),
      answer: isARecord ? this.record.targetIp : "NXDOMAIN",
      responseCode: isARecord ? "NOERROR" : "NXDOMAIN",
      timestamp: new Date().toISOString(),
    });
    this.totalQueries += 1;
    this.queries.splice(30);
    return response;
  }

  async queryCurrent(): Promise<{
    requestName: string;
    answer: string;
    ttl: number;
    responseCode: string;
    rawResponseBytes: number;
    queryId: string;
  }> {
    if (!this.started) throw new Error("DNS plane is not listening");
    const transactionId = randomBytes(2);
    const question = Buffer.concat([
      encodeName(this.domain),
      Buffer.from([0, 1, 0, 1]),
    ]);
    const header = Buffer.alloc(12);
    transactionId.copy(header);
    header.writeUInt16BE(0x0100, 2);
    header.writeUInt16BE(1, 4);
    const request = Buffer.concat([header, question]);
    const response = await new Promise<Buffer>((resolve, reject) => {
      const client = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        client.close();
        reject(new Error("DNS query timed out"));
      }, 1000);
      client.once("error", (error) => {
        clearTimeout(timer);
        client.close();
        reject(error);
      });
      client.once("message", (data) => {
        clearTimeout(timer);
        client.close();
        resolve(data);
      });
      client.send(request, this.port, "127.0.0.1");
    });
    const questionInResponse = readName(response, 12);
    const answerCount = response.readUInt16BE(6);
    const responseCode = response.readUInt16BE(2) & 0x000f;
    const answerOffset = questionInResponse.next + 4;
    let answer = "NXDOMAIN";
    let ttl = 0;
    if (answerCount > 0 && answerOffset + 12 <= response.length) {
      ttl = response.readUInt32BE(answerOffset + 6);
      const length = response.readUInt16BE(answerOffset + 10);
      answer = Array.from(response.subarray(answerOffset + 12, answerOffset + 12 + length)).join(".");
    }
    const lastQuery = this.queries[0];
    return {
      requestName: questionInResponse.name,
      answer,
      ttl,
      responseCode: responseCode === 0 ? "NOERROR" : "NXDOMAIN",
      rawResponseBytes: response.length,
      queryId: lastQuery?.id ?? "unlogged",
    };
  }

  migrate(targetIp: string) {
    if (!ALLOWED_LAB_IPS.has(targetIp) || isIP(targetIp) !== 4) {
      throw new Error("targetIp must be 127.0.0.1 or 127.0.0.2");
    }
    this.record = { ...this.record, targetIp, serial: this.record.serial + 1 };
  }

  recordProof() {
    const canonical = `${this.record.domain}|A|${this.record.targetIp}|${this.record.ttl}|${this.record.serial}`;
    const signature = sign(null, Buffer.from(canonical), this.signingKeys.privateKey).toString("base64");
    const publicKey = this.signingKeys.publicKey.export({ type: "spki", format: "der" });
    return {
      canonical,
      signature,
      keyFingerprint: createHash("sha256").update(publicKey).digest("hex"),
      recordHash: createHash("sha256").update(canonical).digest("hex"),
    };
  }

  verifyRecordProof(proof: { canonical: string; signature: string }) {
    const canonical = `${this.record.domain}|A|${this.record.targetIp}|${this.record.ttl}|${this.record.serial}`;
    return proof.canonical === canonical
      && verify(null, Buffer.from(canonical), this.signingKeys.publicKey, Buffer.from(proof.signature, "base64"));
  }

  async probeResolvedTarget(targetIp: string) {
    const port = this.targetPorts.get(targetIp);
    if (!port) throw new Error(`No local redirect target is listening for ${targetIp}`);
    return new Promise<{ statusCode: number; body: string; url: string }>((resolve, reject) => {
      const request = http.get(
        { hostname: targetIp, port, path: "/redirected-resource", headers: { host: this.domain } },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: body.trim(), url: `http://${targetIp}:${port}/redirected-resource` }));
        },
      );
      request.setTimeout(1000, () => { request.destroy(new Error("local redirect target timed out")); });
      request.on("error", reject);
    });
  }

  snapshot() {
    return {
      status: this.started ? "Active & synchronized" : "Starting",
      domain: this.record.domain,
      ip: this.record.targetIp,
      ttl: this.record.ttl,
      port: this.port,
      queries: this.totalQueries,
      serial: this.record.serial,
      lastQuery: this.queries[0] ?? null,
    };
  }
}

export const dnsPlane = new LocalDnsPlane();
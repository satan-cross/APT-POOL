import http from "node:http";

type LabResponse = Record<string, unknown>;

export class LocalSecurityLab {
  private readonly server = http.createServer((request, response) => {
    this.handleRequest(request, response);
  });

  private listening = false;
  private boundPort = 0;

  constructor(private readonly configuredPort = Number(process.env.SECURITY_LAB_PORT ?? 0)) {}

  get port() {
    return this.boundPort || this.configuredPort;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    if (this.listening) return this;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Local security lab did not expose a TCP address"));
          return;
        }
        this.boundPort = address.port;
        this.listening = true;
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.configuredPort, "127.0.0.1");
    });
    return this;
  }

  async stop() {
    if (!this.listening) return;
    this.listening = false;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async getJson(path: string): Promise<LabResponse> {
    if (!path.startsWith("/")) throw new Error("Local security lab paths must be absolute");
    if (!this.listening) await this.start();
    return new Promise<LabResponse>((resolve, reject) => {
      const request = http.get(`${this.baseUrl}${path}`, { headers: { accept: "application/json" } }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Local security lab returned HTTP ${response.statusCode ?? "unknown"}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as LabResponse);
          } catch {
            reject(new Error("Local security lab returned invalid JSON"));
          }
        });
      });
      request.on("error", reject);
    });
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");

    if (request.method !== "GET") {
      this.writeJson(response, 405, { error: "GET only" });
      return;
    }

    switch (request.url?.split("?")[0]) {
      case "/healthz":
        this.writeJson(response, 200, {
          status: "ok",
          service: "argus-local-security-lab",
          profile: "production-shaped-local",
          subject: "loopback-test-subject",
        });
        return;
      case "/api/security/headers":
        response.setHeader("strict-transport-security", "max-age=31536000");
        response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
        this.writeJson(response, 200, {
          tlsMinimum: "TLSv1.2",
          headers: ["strict-transport-security", "content-security-policy", "x-content-type-options"],
          legacyProtocols: ["SSLv3", "TLSv1.0"],
        });
        return;
      case "/api/security/auth":
        this.writeJson(response, 200, {
          subject: "lab-user",
          authenticated: true,
          mfa: true,
          lockout: true,
          policyVersion: "2026.09-local",
        });
        return;
      case "/api/security/query":
        this.writeJson(response, 200, {
          queryMode: "parameterized",
          rows: [{ id: "lab-account-1", state: "active" }],
          inputBoundary: "bound-parameter",
        });
        return;
      case "/api/security/events":
        this.writeJson(response, 200, {
          events: [
            { actor: "lab-user", action: "login", success: true },
            { actor: "lab-user", action: "login", success: false },
            { actor: "lab-admin", action: "role-change", success: true },
          ],
          source: "local-security-lab",
        });
        return;
      case "/api/security/manifest":
        this.writeJson(response, 200, {
          assets: ["web-01", "api-01", "db-01", "dns-lab"],
          components: ["express@5", "zod@4", "drizzle-orm@0.44"],
          source: "local-security-lab",
        });
        return;
      default:
        this.writeJson(response, 404, { error: "Not found" });
    }
  }

  private writeJson(response: http.ServerResponse, statusCode: number, body: LabResponse) {
    response.statusCode = statusCode;
    response.end(JSON.stringify(body));
  }
}

export const localSecurityLab = new LocalSecurityLab();
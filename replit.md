# Security Mining Command Center

ARGUS is a live defensive security workload command center with verifiable proof telemetry, a local authoritative DNS probe, and bounded security assessments.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/security-command-center run dev` — run the live dashboard
- `python3 artifacts/security-command-center/security_command_center.py` — run the standalone Python coordinator on HTTP 8080, TCP 9000, and UDP 5353
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/security-command-center/src/pages/command-center.tsx` — live dashboard UI
- `artifacts/security-command-center/src/pages/command-center.tsx` — workload detail pages at `/task/:taskId` with live demo result panels
- `artifacts/security-command-center/security_command_center.py` — standard-library-only standalone coordinator
- `artifacts/api-server/src/lib/command-center.ts` — in-memory telemetry and proof ledger used by the dashboard API
- `artifacts/api-server/src/lib/workload-catalog.ts` — the shared 68-workload catalog, safety classes, algorithms, and execution modes
- `artifacts/api-server/src/lib/safe-workload-runner.ts` — bounded live local executors for production-shaped defensive lab tasks
- `artifacts/api-server/src/lib/local-security-lab.ts` — loopback HTTP test subject exposing real local security responses and policy features
- `artifacts/api-server/src/lib/demo-runner.ts` — bounded workload demos, including generated BIP39 entropy/checksum validation, PBKDF2 seed derivation, secp256k1 public-key derivation, and catalog executors
- `artifacts/api-server/src/lib/dns-plane.ts` — real UDP authoritative DNS listener and query client on port 5353
- `artifacts/api-server/src/lib/miner-pool.ts` — loopback TCP pool on port 9000, local worker connection, issued jobs, accepted-share validation, and live miner telemetry
- `artifacts/api-server/src/lib/gpu-miner-process.ts` — local GPU capability detection and bounded child-process miner lifecycle
- `artifacts/security-command-center/miners/gpu_miner.py` — JSON-line Python miner with optional CuPy CUDA/ROCm acceleration and explicit CPU fallback
- `artifacts/security-command-center/miners/gpu_miner.cpp` — portable native C++ loopback miner with stdout telemetry
- `artifacts/api-server/src/lib/command-center-settings.ts` — persisted Home difficulty and configured real miner count
- `lib/api-spec/openapi.yaml` — source of truth for the typed status endpoint

## Architecture decisions

- The dashboard reads typed polling data from the shared API service instead of fabricating counters in the browser.
- The Python coordinator keeps DNS, TCP pool, and HTTP dashboard behavior in one file so it can run as a local lab process without third-party packages.
- All security-taxonomy workloads use bounded loopback services, local computation, or controlled fixtures; the app does not search private keys, crack real credentials, execute discovered code, or probe arbitrary remote systems.
- Proof submissions are checked against the issued job range and a hash prefix before a block is appended to the in-memory ledger.
- Dashboard percentages, rates, miner counts, job counts, hashes, and ledger rows come from live TCP miner connections and accepted shares; there are no timer-generated mining counters.
- Hash counts are derived from the validated nonce span for each accepted share, with per-workload and aggregate hashes-per-second telemetry; accepted proof counts remain separate from attempted hashes.
- The miner difficulty is four leading hexadecimal zeroes (`0000`) with a bounded one-million-nonce job range; BIP39 demos generate fresh 128-bit entropy instead of showing a fixed mnemonic.
- Home difficulty and miner-count defaults are stored in the `command_center_settings` development database table and loaded before the API starts; the Home production preset uses `0000` and worker count is bounded to 1–16.
- Legacy mining demonstrations wait for a fresh accepted share. Supplied public-key assessments instead complete from their named parser/validator with artifact-bound evidence; completion is not private-key recovery. DNS demos query the local UDP listener, make a local request to the resolved target, and the migration action only permits loopback lab addresses.

## Product

Operators can monitor coordinator health, active miners, local DNS propagation, 68 security workload states, verified shares, and the latest proof ledger blocks. The dashboard refreshes automatically, supports workload-category filtering, and includes mobile navigation, pause/resume polling, retry handling, and copyable hashes.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The standalone Python process owns ports 8080, 9000, and 5353 by default; do not start it alongside the shared API workflow on the same machine without changing one set of ports.
- The Python implementation is intentionally a defensive lab simulator, not an offensive recovery or cracking tool.
- GPU process mining is local-only and defaults to `MINER_BACKEND=auto`; a supported local GPU starts the Python process automatically, while `MINER_BACKEND=gpu` requires a supported GPU/CuPy backend and `MINER_BACKEND=disabled` or `GPU_MINING_ENABLED=false` disables it. Miner stdout is newline-delimited JSON; diagnostics go to stderr.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

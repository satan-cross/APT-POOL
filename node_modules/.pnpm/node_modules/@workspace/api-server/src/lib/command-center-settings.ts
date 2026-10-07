import { eq } from "drizzle-orm";
import { commandCenterSettings, db } from "@workspace/db";
import { minerPool, type MinerDifficulty } from "./miner-pool";
import { gpuMiner, type RequestedBackend } from "./gpu-miner-process";

const SETTINGS_ID = "default";
const DEFAULT_DIFFICULTY: MinerDifficulty = "000";
const DEFAULT_MINERS = 1;
const DEFAULT_GPU_BACKEND: RequestedBackend = "auto";

export type CommandCenterSettings = {
  difficulty: MinerDifficulty;
  minerCount: number;
  gpuBackend: RequestedBackend;
};

function normalizeDifficulty(value: string | undefined): MinerDifficulty {
  if (value === "00" || value === "000" || value === "0000") return value;
  return DEFAULT_DIFFICULTY;
}

function normalizeMinerCount(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16 ? value : DEFAULT_MINERS;
}

function normalizeGpuBackend(value: string | undefined): RequestedBackend {
  if (value === "auto" || value === "gpu" || value === "disabled") return value;
  return DEFAULT_GPU_BACKEND;
}

export async function loadCommandCenterSettings(): Promise<CommandCenterSettings> {
  const existing = await db
    .select()
    .from(commandCenterSettings)
    .where(eq(commandCenterSettings.id, SETTINGS_ID))
    .limit(1);
  const row = existing[0];
  const settings = {
    difficulty: normalizeDifficulty(row?.difficulty),
    minerCount: normalizeMinerCount(row?.minerCount),
    gpuBackend: normalizeGpuBackend(row?.gpuBackend),
  };
  if (!row) {
    await db.insert(commandCenterSettings).values({
      id: SETTINGS_ID,
      difficulty: settings.difficulty,
      minerCount: settings.minerCount,
      gpuBackend: settings.gpuBackend,
    });
  }
  minerPool.setDifficulty(settings.difficulty);
  minerPool.setMinerCount(settings.minerCount);
  await gpuMiner.setRequestedBackend(settings.gpuBackend);
  return settings;
}

export async function saveCommandCenterSettings(input: Partial<CommandCenterSettings>) {
  const difficulty = normalizeDifficulty(input.difficulty);
  const minerCount = normalizeMinerCount(input.minerCount);
  const gpuBackend = normalizeGpuBackend(input.gpuBackend);
  minerPool.setDifficulty(difficulty);
  minerPool.setMinerCount(minerCount);
  await gpuMiner.setRequestedBackend(gpuBackend);
  await db
    .insert(commandCenterSettings)
    .values({ id: SETTINGS_ID, difficulty, minerCount, gpuBackend })
    .onConflictDoUpdate({
      target: commandCenterSettings.id,
      set: { difficulty, minerCount, gpuBackend, updatedAt: new Date() },
    });
  return { difficulty, minerCount, gpuBackend };
}
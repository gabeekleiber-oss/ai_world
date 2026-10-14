import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { WorldStateSchema, type WorldState } from "@ai-world/shared";
import { writeFileAtomic } from "../fs/atomic";

export const SNAPSHOT_LATEST = "snapshot-latest.json";
export const SNAPSHOT_DIR = "snapshots";

export interface SnapshotInput {
  /** Sequence number of the last event already reflected in `world`. -1 if none. */
  last_seq: number;
  game_day: number;
  world: WorldState;
  /** Opaque extra state owned by upper layers (for example per-mind counters). Must be JSON. */
  extra?: Record<string, unknown>;
  saved_at?: string;
}

export interface Snapshot {
  schema_version: 1;
  saved_at: string;
  last_seq: number;
  game_day: number;
  beat: number;
  world: WorldState;
  extra: Record<string, unknown>;
  /** sha256 of the canonical JSON of every other field. Detects truncation and bit rot. */
  checksum: string;
}

/** JSON with sorted object keys, so the checksum does not depend on key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumOf(body: Omit<Snapshot, "checksum">): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export function buildSnapshot(input: SnapshotInput, now: () => string = () => new Date().toISOString()): Snapshot {
  const world = WorldStateSchema.parse(input.world);
  if (!Number.isInteger(input.last_seq) || input.last_seq < -1) throw new RangeError("last_seq must be an integer of at least -1");
  const body = {
    schema_version: 1 as const,
    saved_at: input.saved_at ?? now(),
    last_seq: input.last_seq,
    game_day: input.game_day,
    beat: world.beat,
    world,
    extra: input.extra ?? {},
  };
  return { ...body, checksum: checksumOf(body) };
}

export type SnapshotCheck = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

/** Parse and verify snapshot text. Never throws. */
export function parseSnapshot(text: string): SnapshotCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON (truncated or damaged)" };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not a JSON object" };
  const r = raw as Record<string, unknown>;
  if (r.schema_version !== 1) return { ok: false, reason: `unsupported schema_version ${String(r.schema_version)}` };
  if (typeof r.checksum !== "string") return { ok: false, reason: "missing checksum" };
  if (typeof r.last_seq !== "number" || !Number.isInteger(r.last_seq) || r.last_seq < -1) return { ok: false, reason: "bad last_seq" };
  if (typeof r.game_day !== "number" || typeof r.beat !== "number" || typeof r.saved_at !== "string") return { ok: false, reason: "missing header fields" };
  const world = WorldStateSchema.safeParse(r.world);
  if (!world.success) return { ok: false, reason: `world state failed validation: ${world.error.issues[0]?.path.join(".") ?? ""} ${world.error.issues[0]?.message ?? ""}`.trim() };
  const extra = typeof r.extra === "object" && r.extra !== null && !Array.isArray(r.extra) ? (r.extra as Record<string, unknown>) : {};
  const body = { schema_version: 1 as const, saved_at: r.saved_at, last_seq: r.last_seq, game_day: r.game_day, beat: r.beat, world: world.data, extra };
  // Compare against the raw world so a field the schema would strip still counts as damage.
  const rawBody = { ...body, world: r.world };
  if (checksumOf(rawBody as Omit<Snapshot, "checksum">) !== r.checksum) return { ok: false, reason: "checksum mismatch" };
  return { ok: true, snapshot: { ...body, checksum: r.checksum } };
}

export async function readSnapshotFile(path: string): Promise<SnapshotCheck> {
  try {
    return parseSnapshot(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "file missing" };
    return { ok: false, reason: `unreadable: ${(error as Error).message}` };
  }
}

export interface WriteSnapshotOptions {
  /** How many rotated older snapshots to keep in snapshots/. Default 10. */
  keep?: number;
  /** Injectable for tests. */
  writeFile?: typeof writeFileAtomic;
}

export function rotatedName(snapshot: Pick<Snapshot, "beat" | "last_seq">): string {
  return `snapshot-b${String(snapshot.beat).padStart(9, "0")}-s${String(snapshot.last_seq + 1).padStart(10, "0")}.json`;
}

/**
 * Save a snapshot. The previous valid latest is first copied into snapshots/, then the new file replaces
 * snapshot-latest.json atomically, so a crash at any point leaves at least one valid snapshot on disk.
 */
export async function writeSnapshot(worldDir: string, input: SnapshotInput, options: WriteSnapshotOptions = {}): Promise<Snapshot> {
  const write = options.writeFile ?? writeFileAtomic;
  const dir = join(worldDir, SNAPSHOT_DIR);
  await mkdir(dir, { recursive: true });
  const snapshot = buildSnapshot(input);
  const latestPath = join(worldDir, SNAPSHOT_LATEST);

  const previous = await readSnapshotFile(latestPath);
  if (previous.ok) await write(join(dir, rotatedName(previous.snapshot)), `${JSON.stringify(previous.snapshot)}\n`);
  await write(latestPath, `${JSON.stringify(snapshot)}\n`);

  await pruneSnapshots(worldDir, options.keep ?? 10);
  return snapshot;
}

/** Rotated snapshot file names, oldest first. */
export async function listRotatedSnapshots(worldDir: string): Promise<string[]> {
  try {
    return (await readdir(join(worldDir, SNAPSHOT_DIR))).filter((n) => /^snapshot-b\d+-s\d+\.json$/.test(n)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function pruneSnapshots(worldDir: string, keep: number): Promise<string[]> {
  const names = await listRotatedSnapshots(worldDir);
  const drop = names.slice(0, Math.max(0, names.length - Math.max(1, keep)));
  await Promise.all(drop.map((n) => rm(join(worldDir, SNAPSHOT_DIR, n), { force: true })));
  return drop;
}

export interface LoadedSnapshot {
  snapshot: Snapshot;
  /** "latest" or the rotated file name that was used. */
  source: string;
  /** Candidates that were tried first and rejected, with the reason. */
  rejected: Array<{ source: string; reason: string }>;
}

/** Latest valid snapshot: snapshot-latest.json, else rotated snapshots from newest to oldest. Null if none is usable. */
export async function loadLatestValidSnapshot(worldDir: string): Promise<LoadedSnapshot | null> {
  const rejected: LoadedSnapshot["rejected"] = [];
  const latest = await readSnapshotFile(join(worldDir, SNAPSHOT_LATEST));
  if (latest.ok) return { snapshot: latest.snapshot, source: "latest", rejected };
  if (!(latest.reason === "file missing")) rejected.push({ source: "latest", reason: latest.reason });
  for (const name of (await listRotatedSnapshots(worldDir)).reverse()) {
    const check = await readSnapshotFile(join(worldDir, SNAPSHOT_DIR, name));
    if (check.ok) return { snapshot: check.snapshot, source: name, rejected };
    rejected.push({ source: name, reason: check.reason });
  }
  return null;
}

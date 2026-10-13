import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const RUN_DIRECTORIES = [
  "world/snapshots",
  "events",
  "cave/marks",
  "priests/priest-001",
  "minds",
  "analysis",
  "observatory",
  "logs",
] as const;

export interface RunLayout {
  runDir: string;
  directories: readonly string[];
}

/** Create the directory skeleton described in DESIGN.md §15. */
export async function createRunLayout(dataRoot: string, runId: string): Promise<RunLayout> {
  if (!RUN_ID_PATTERN.test(runId) || runId === "." || runId === "..") {
    throw new Error("runId must be a simple filename (letters, digits, dot, underscore, hyphen)");
  }
  const root = resolve(dataRoot);
  const runDir = resolve(root, "runs", runId);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (isAbsolute(runDir) && !runDir.startsWith(prefix)) {
    throw new Error("runId resolves outside the data root");
  }

  const directories = RUN_DIRECTORIES.map((part) => resolve(runDir, part));
  await mkdir(runDir, { recursive: true });
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  return { runDir, directories };
}

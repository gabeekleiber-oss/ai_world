import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendJsonl, stampSchemaVersion } from "../src/fs/jsonl";
import { createRunLayout } from "../src/fs/layout";
import { writeFileAtomic } from "../src/fs/atomic";

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-world-persist-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomic persistence", () => {
  it("replaces a file only after the temp file is durable", async () => {
    const root = await tempRoot();
    const target = join(root, "world", "snapshot.json");
    await writeFileAtomic(target, '{"version":1}');
    await writeFileAtomic(target, '{"version":2}');
    expect(await readFile(target, "utf8")).toBe('{"version":2}');
  });

  it("keeps the old target intact if the process fails between temp fsync and rename", async () => {
    const root = await tempRoot();
    const target = join(root, "snapshot.json");
    await writeFileAtomic(target, "old");
    await expect(writeFileAtomic(target, "new", {
      renameFile: async () => { throw new Error("simulated crash before rename"); },
    })).rejects.toThrow("simulated crash");
    expect(await readFile(target, "utf8")).toBe("old");
    const files = await readdir(root);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(true);
  });

  it("stamps and appends one schema-versioned JSON object per line with flush", async () => {
    const root = await tempRoot();
    const file = join(root, "events", "events.jsonl");
    expect(stampSchemaVersion({ seq: 1 })).toEqual({ seq: 1, schema_version: 1 });
    await appendJsonl(file, { seq: 1 });
    await appendJsonl(file, { seq: 2 }, { schemaVersion: 2 });
    const lines = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([{ seq: 1, schema_version: 1 }, { seq: 2, schema_version: 2 }]);
  });

  it("creates the section 15 run layout and rejects path traversal", async () => {
    const root = await tempRoot();
    const { runDir, directories } = await createRunLayout(root, "run-001");
    expect(runDir).toBe(join(root, "runs", "run-001"));
    expect(directories).toHaveLength(8);
    await Promise.all(directories.map((directory) => stat(directory)));
    await expect(createRunLayout(root, "../escape")).rejects.toThrow(/runId/);
  });
});

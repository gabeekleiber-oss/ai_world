import { mkdir, rename, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LeafEntry } from "@ai-world/shared";
import { appendJsonl, writeFileAtomic } from "../fs/index";

export interface LeafSink { write(entry: LeafEntry): Promise<void> }
export interface ClosingRecord { schema_version: 1; priest_number: number; game_day: number; cause: string; age_days: number; entry_count: number }

const bookName = (number: number) => `priest-${String(number).padStart(3, "0")}`;

/** Durable per-priest book storage. This class never feeds archived content back into a new book. */
export class FileLeafSink implements LeafSink {
  constructor(private readonly priestsDir: string, readonly priestNumber: number) {}
  get directory(): string { return join(this.priestsDir, bookName(this.priestNumber)); }

  async write(entry: LeafEntry): Promise<void> {
    if (entry.priest_number !== this.priestNumber) throw new Error("entry belongs to a different book");
    await mkdir(this.directory, { recursive: true });
    // appendJsonl fsyncs before the readable rendering is updated.
    await appendJsonl(join(this.directory, "book.jsonl"), entry);
    await writeFileAtomic(join(this.directory, "book.md"), await this.renderBook());
  }

  async closeAndArchive(record: Omit<ClosingRecord, "schema_version" | "priest_number" | "entry_count">): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const entryCount = await this.entries().then((entries) => entries.length);
    await writeFileAtomic(join(this.directory, "closing.json"), JSON.stringify({ schema_version: 1, priest_number: this.priestNumber, entry_count: entryCount, ...record }, null, 2));
    const archiveDir = join(this.priestsDir, "archive");
    await mkdir(archiveDir, { recursive: true });
    const target = join(archiveDir, bookName(this.priestNumber));
    await rename(this.directory, target);
    return target;
  }

  async entries(): Promise<LeafEntry[]> {
    try { return (await readFile(join(this.directory, "book.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as LeafEntry); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async renderBook(): Promise<string> {
    const entries = await this.entries();
    return entries.map((entry) => `## ${entry.game_day}:${entry.beat}\n\n${entry.text}\n`).join("\n");
  }
}

/** Create the successor's directory without copying any archived entries. */
export async function startNewBook(priestsDir: string, priestNumber: number): Promise<FileLeafSink> {
  const sink = new FileLeafSink(priestsDir, priestNumber);
  await mkdir(sink.directory, { recursive: true });
  // Refuse a non-empty live directory: silently reusing it would leak memory.
  if ((await readdir(sink.directory)).length) throw new Error(`book ${priestNumber} already exists`);
  return sink;
}

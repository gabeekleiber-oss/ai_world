import { copyFile, mkdir, open, readFile, truncate } from "node:fs/promises";
import { basename, join } from "node:path";
import { MarkRecordSchema, type MarkRecord } from "@ai-world/shared";
import { appendJsonl, writeFileAtomic } from "../fs/index";
import { renderGallery } from "./gallery";
import { renderPng } from "./raster";
import { renderSvg } from "./render";

export { renderGallery } from "./gallery";
export { renderPng, rasterizeMark, PREVIEW_W, PREVIEW_H } from "./raster";
export { renderSvg, wrapText, PIGMENT_COLORS } from "./render";
export { encodePng, pngSize } from "./png";

export interface MarkFiles { json: string; svg: string; png: string }
/** Implemented here for SIM-10. `commit` resolves only once every durable artifact is on disk, so the caller may then spend the author's charge (R8). */
export interface MarkSink { commit(mark: MarkRecord): Promise<MarkFiles> }

export interface MarkWriterOptions {
  /** Number of further attempts after the first failed write. Default 2. */
  retries?: number;
  /** Wait before retry n is `retryDelayMs * n`. Default 10. */
  retryDelayMs?: number;
  writeAtomic?: typeof writeFileAtomic;
  append?: typeof appendJsonl;
  /** If set, the cave files are copied here after every commit (DESIGN.md section 15 mirror). Best effort. */
  mirrorDir?: string | null;
  /** Called for problems that must not fail a commit: the gallery or mirror could not be updated. */
  onWarning?: (message: string, cause: unknown) => void;
}

export interface MarkIndex {
  /** Valid marks in mark_id order, one per id. */
  marks: MarkRecord[];
  /** Lines that were not valid mark records (reported, never fatal). */
  corrupt: number;
  /** Repeated ids after the first. Ignored. */
  duplicates: number;
}

/** Read cave/marks.jsonl tolerantly. A missing file is an empty index. */
export async function readMarkIndex(caveDir: string): Promise<MarkIndex> {
  let text: string;
  try { text = await readFile(join(caveDir, "marks.jsonl"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { marks: [], corrupt: 0, duplicates: 0 };
    throw error;
  }
  const byId = new Map<number, MarkRecord>();
  let corrupt = 0, duplicates = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = MarkRecordSchema.safeParse(JSON.parse(line)); } catch { parsed = undefined; }
    if (!parsed?.success) { corrupt += 1; continue; }
    if (byId.has(parsed.data.mark_id)) { duplicates += 1; continue; }
    byId.set(parsed.data.mark_id, parsed.data);
  }
  return { marks: [...byId.values()].sort((a, b) => a.mark_id - b.mark_id), corrupt, duplicates };
}

/** Cut a torn final line so the next append starts on a fresh line. */
async function trimTornTail(path: string): Promise<void> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (text === "" || text.endsWith("\n")) return;
  await truncate(path, Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1), "utf8"));
  const handle = await open(path, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

export class FileMarkSink implements MarkSink {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly caveDir: string, private readonly options: MarkWriterOptions = {}) {}

  /**
   * Write the record, vector image and raster preview, append to marks.jsonl, and only then resolve. Writes are retried
   * and repeating a commit of the identical mark is harmless (the index never gets two lines for one id). Commits run one
   * at a time. The gallery and mirror are regenerable, so a failure there is reported through `onWarning`, not thrown.
   */
  commit(markInput: MarkRecord): Promise<MarkFiles> {
    const run = this.#queue.then(() => this.#commit(markInput));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #commit(markInput: MarkRecord): Promise<MarkFiles> {
    const mark = MarkRecordSchema.parse(markInput);
    const retries = this.options.retries ?? 2;
    const delay = this.options.retryDelayMs ?? 10;
    let failure: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const files = await this.#writeOnce(mark);
        await this.#afterCommit(files);
        return files;
      } catch (error) {
        if (error instanceof MarkConflictError) throw error;
        failure = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
    throw new Error(`mark ${mark.mark_id} was not committed after ${retries + 1} attempts`, { cause: failure });
  }

  #paths(mark: MarkRecord): MarkFiles {
    const dir = join(this.caveDir, "marks");
    return { json: join(dir, `${mark.mark_id}.json`), svg: join(dir, `${mark.mark_id}.svg`), png: join(dir, `${mark.mark_id}.png`) };
  }

  async #writeOnce(mark: MarkRecord): Promise<MarkFiles> {
    const files = this.#paths(mark);
    const write = this.options.writeAtomic ?? writeFileAtomic;
    await mkdir(join(this.caveDir, "marks"), { recursive: true });

    // A mark is permanent: an id that is already indexed may only be re-committed with identical content.
    const indexed = (await readMarkIndex(this.caveDir)).marks.find((m) => m.mark_id === mark.mark_id);
    if (indexed && JSON.stringify(indexed) !== JSON.stringify(mark)) throw new MarkConflictError(mark.mark_id);

    // Durability boundary (section 12): record, vector, raster, then the append-only index. Each write is
    // write-to-temp, fsync, rename. Nothing resolves before all four are on disk.
    await write(files.json, `${JSON.stringify(mark, null, 2)}\n`);
    await write(files.svg, renderSvg(mark));
    await write(files.png, renderPng(mark));
    if (!indexed) {
      const index = join(this.caveDir, "marks.jsonl");
      await trimTornTail(index);
      await (this.options.append ?? appendJsonl)(index, mark as unknown as Record<string, unknown>);
    }
    return files;
  }

  async #afterCommit(files: MarkFiles): Promise<void> {
    const warn = this.options.onWarning ?? (() => undefined);
    try {
      await this.regenerateGallery();
    } catch (cause) { warn("gallery.html could not be regenerated; it will be rebuilt on the next commit", cause); }
    const mirror = this.options.mirrorDir;
    if (mirror) {
      try {
        await mkdir(join(mirror, "marks"), { recursive: true });
        for (const f of [files.json, files.svg, files.png]) await copyFile(f, join(mirror, "marks", basename(f)));
        for (const name of ["marks.jsonl", "gallery.html"]) await copyFile(join(this.caveDir, name), join(mirror, name)).catch(() => undefined);
      } catch (cause) { warn("mirror copy failed", cause); }
    }
  }

  /** Rebuild gallery.html from marks.jsonl. Also callable by tooling. */
  async regenerateGallery(): Promise<void> {
    const { marks } = await readMarkIndex(this.caveDir);
    await (this.options.writeAtomic ?? writeFileAtomic)(join(this.caveDir, "gallery.html"), renderGallery(marks));
  }
}

export class MarkConflictError extends Error {
  constructor(readonly markId: number) {
    super(`mark ${markId} already exists with different content; marks are permanent`);
    this.name = "MarkConflictError";
  }
}

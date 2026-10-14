import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MarkRecord } from "@ai-world/shared";
import { appendJsonl, writeFileAtomic } from "../fs/index";

export interface MarkFiles { json: string; svg: string; png: string }
export interface MarkSink { commit(mark: MarkRecord): Promise<MarkFiles> }
export interface MarkWriterOptions {
  /** Number of further attempts after the first failed write. */
  retries?: number;
  writeAtomic?: typeof writeFileAtomic;
  append?: typeof appendJsonl;
}

// A valid 1×1 transparent PNG. The SVG is the authoritative, lossless artwork;
// this preview is deliberately small until the viewer's raster renderer replaces it.
const PNG_PREVIEW = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9mQAAAABJRU5ErkJggg==", "base64");

export class FileMarkSink implements MarkSink {
  constructor(private readonly caveDir: string, private readonly options: MarkWriterOptions = {}) {}

  async commit(mark: MarkRecord): Promise<MarkFiles> {
    const retries = this.options.retries ?? 2;
    let failure: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await this.writeOnce(mark); }
      catch (error) { failure = error; if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1))); }
    }
    throw new Error(`mark ${mark.mark_id} was not committed after ${retries + 1} attempts`, { cause: failure });
  }

  private async writeOnce(mark: MarkRecord): Promise<MarkFiles> {
    const marksDir = join(this.caveDir, "marks");
    const base = String(mark.mark_id);
    const files: MarkFiles = { json: join(marksDir, `${base}.json`), svg: join(marksDir, `${base}.svg`), png: join(marksDir, `${base}.png`) };
    const write = this.options.writeAtomic ?? writeFileAtomic;
    await mkdir(marksDir, { recursive: true });
    // This ordering is the durability boundary: no caller receives success before
    // all durable artifacts and the append-only index exist.
    await write(files.json, JSON.stringify(mark, null, 2));
    await write(files.svg, renderSvg(mark));
    await write(files.png, PNG_PREVIEW);
    await (this.options.append ?? appendJsonl)(join(this.caveDir, "marks.jsonl"), mark);
    await this.regenerateGallery();
    return files;
  }

  private async regenerateGallery(): Promise<void> {
    const index = join(this.caveDir, "marks.jsonl");
    let records: MarkRecord[] = [];
    try { records = (await readFile(index, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as MarkRecord); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await (this.options.writeAtomic ?? writeFileAtomic)(join(this.caveDir, "gallery.html"), gallery(records));
  }
}

function renderSvg(mark: MarkRecord): string {
  if (typeof mark.content === "string") return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="4" y="12" fill="${mark.pigment ?? "dark"}">${escape(mark.content)}</text></svg>`;
  const strokes = mark.content.strokes.map((stroke) => `<polyline fill="none" stroke="${stroke.pigment}" stroke-width="${({ thin: 1, medium: 2, thick: 4 })[stroke.width]}" points="${stroke.points.map((p) => p.join(",")).join(" ")}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${strokes}</svg>`;
}
function escape(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function gallery(records: readonly MarkRecord[]): string {
  const cards = records.map((mark) => `<article><h2>Mark ${mark.mark_id}</h2><p>day ${mark.game_day}, beat ${mark.beat}</p><img src="marks/${mark.mark_id}.png" alt="Mark ${mark.mark_id} preview"><a href="marks/${mark.mark_id}.svg">vector</a></article>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Marks</title><main><h1>Marks</h1>${cards}</main>`;
}

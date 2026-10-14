import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { MarkRecord } from "@ai-world/shared";
import { FileMarkSink, MarkConflictError, PREVIEW_H, PREVIEW_W, pngSize, readMarkIndex, renderGallery, renderPng, renderSvg, wrapText } from "../src/marks";
import { crc32 } from "../src/marks/png";
import { writeFileAtomic } from "../src/fs/atomic";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function cave(): Promise<string> { const d = await mkdtemp(join(tmpdir(), "ai-world-cave-")); dirs.push(d); return d; }

const base = { schema_version: 1 as const, author_mind_id: "mind-1", author_slot: "slot-0", game_day: 3, beat: 7, real_time: "2026-01-01T00:00:00Z", wall_slot: 4, position_3d: [1, 2, 3] as [number, number, number], witnesses: ["other-1"], context: { thought: "t", last_events: [], body_state: {} } };
const text = (id: number, content = "hello wall", pigment: MarkRecord["pigment"] = "red"): MarkRecord => ({ ...base, mark_id: id, kind: "text", content, pigment });
const drawing = (id: number): MarkRecord => ({ ...base, mark_id: id, kind: "drawing", content: { strokes: [
  { pigment: "red", width: "thick", points: [[10, 25], [90, 25]] },
  { pigment: "pale", width: "medium", points: [[50, 10]] },
] } });

/** Minimal PNG reader for tests: checks signature, every chunk CRC, and returns RGBA rows. */
function decodePng(png: Buffer): { width: number; height: number; px: (x: number, y: number) => [number, number, number, number] } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8; let idat = Buffer.alloc(0); let w = 0, h = 0; const types: string[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    expect(png.readUInt32BE(off + 8 + len), `crc of ${type}`).toBe(crc32(png.subarray(off + 4, off + 8 + len)));
    types.push(type);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); expect(data[8]).toBe(8); expect(data[9]).toBe(6); }
    if (type === "IDAT") idat = Buffer.concat([idat, data]);
    off += 12 + len;
  }
  expect(types[0]).toBe("IHDR"); expect(types.at(-1)).toBe("IEND");
  const raw = inflateSync(idat);
  expect(raw.length).toBe((w * 4 + 1) * h);
  return { width: w, height: h, px: (x, y) => { const i = y * (w * 4 + 1) + 1 + x * 4; return [raw[i]!, raw[i + 1]!, raw[i + 2]!, raw[i + 3]!]; } };
}

describe("FileMarkSink: what a commit writes", () => {
  it("writes the record, vector image, raster preview, index line and gallery", async () => {
    const dir = await cave();
    const sink = new FileMarkSink(dir);
    const files = await sink.commit(text(1));
    expect(files).toEqual({ json: join(dir, "marks", "1.json"), svg: join(dir, "marks", "1.svg"), png: join(dir, "marks", "1.png") });
    expect(JSON.parse(await readFile(files.json, "utf8"))).toEqual(text(1));
    expect(await readFile(files.svg, "utf8")).toContain("<svg");
    expect(pngSize(await readFile(files.png))).toEqual({ width: PREVIEW_W, height: PREVIEW_H });
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    expect(await readFile(join(dir, "gallery.html"), "utf8")).toContain("Mark 1");
    expect((await readdir(join(dir, "marks"))).filter((n) => n.endsWith(".tmp") || n.startsWith("."))).toEqual([]);
  });

  it("the gallery lists every mark, in id order, with its text and metadata", async () => {
    const dir = await cave(); const sink = new FileMarkSink(dir);
    await sink.commit(text(2, "second")); await sink.commit(text(1, "first")); await sink.commit(drawing(3));
    const html = await readFile(join(dir, "gallery.html"), "utf8");
    expect(html).toContain("3 mark(s)");
    const order = [...html.matchAll(/id="mark-(\d+)"/g)].map((m) => Number(m[1]));
    expect(order).toEqual([1, 2, 3]);
    expect(html).toContain("first"); expect(html).toContain("second"); expect(html).toContain("drawing: 2 stroke(s)");
    expect(html).toContain('src="marks/3.png"');
  });

  it("escapes anything an agent wrote, in the gallery and the vector image", async () => {
    const dir = await cave(); const sink = new FileMarkSink(dir);
    const evil = `<script>alert("x")</script> & 'q'`;
    const files = await sink.commit(text(1, evil));
    for (const out of [await readFile(join(dir, "gallery.html"), "utf8"), await readFile(files.svg, "utf8")]) {
      expect(out).not.toContain("<script>");
      expect(out).toContain("&lt;script&gt;");
    }
  });

  it("commits in order are all kept, even when issued at the same time", async () => {
    const dir = await cave(); const sink = new FileMarkSink(dir);
    await Promise.all([1, 2, 3, 4, 5].map((i) => sink.commit(text(i, `mark number ${i}`))));
    const idx = await readMarkIndex(dir);
    expect(idx.marks.map((m) => m.mark_id)).toEqual([1, 2, 3, 4, 5]);
    expect(idx.duplicates).toBe(0);
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(5);
    expect((await readFile(join(dir, "gallery.html"), "utf8")).match(/<article/g)).toHaveLength(5);
  });

  it("rejects a record that is not a valid mark, writing nothing", async () => {
    const dir = await cave(); const sink = new FileMarkSink(dir);
    await expect(sink.commit({ ...text(1), kind: "poster" } as never)).rejects.toThrow();
    await expect(sink.commit({ ...text(1), content: { strokes: [] } } as never)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("FileMarkSink: durability and retry (R8)", () => {
  it("never resolves before the files and the index are on disk", async () => {
    const dir = await cave(); const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const sink = new FileMarkSink(dir, {
      writeAtomic: async (p, d, o) => { if (p.endsWith("1.png")) await gate; events.push(p.slice(dir.length + 1)); return writeFileAtomic(p, d, o); },
      append: async (p, r, o) => { events.push("index"); const { appendJsonl } = await import("../src/fs/jsonl"); return appendJsonl(p, r, o); },
    });
    let resolved = false;
    const pending = sink.commit(text(1)).then((f) => { resolved = true; return f; });
    await new Promise((r) => setTimeout(r, 60));
    expect(resolved).toBe(false);
    expect(events).toEqual(["marks/1.json", "marks/1.svg"]);
    release(); await pending;
    expect(resolved).toBe(true);
    expect(events.slice(0, 4)).toEqual(["marks/1.json", "marks/1.svg", "marks/1.png", "index"]);
  });

  it("retries a failing disk and then succeeds with exactly one index line", async () => {
    const dir = await cave(); let failures = 2;
    const sink = new FileMarkSink(dir, { retryDelayMs: 1, writeAtomic: async (p, d, o) => { if (p.endsWith(".png") && failures-- > 0) throw new Error("disk full"); return writeFileAtomic(p, d, o); } });
    await sink.commit(text(1));
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    expect(failures).toBe(-1);
  });

  it("gives up after the retries, reports failure, and leaves no index line", async () => {
    const dir = await cave(); let calls = 0;
    const sink = new FileMarkSink(dir, { retries: 2, retryDelayMs: 1, writeAtomic: async (p, d, o) => { calls++; if (p.endsWith(".svg")) throw new Error("disk gone"); return writeFileAtomic(p, d, o); } });
    const err = await sink.commit(text(1)).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("not committed after 3 attempts");
    expect(((err as Error).cause as Error).message).toBe("disk gone");
    expect((await readMarkIndex(dir)).marks).toEqual([]);
    expect(calls).toBe(6); // json then the failing svg, three times
  });

  it("a failing index append is retried and never leaves two lines for one mark", async () => {
    const dir = await cave(); let n = 0;
    const sink = new FileMarkSink(dir, { retryDelayMs: 1, append: async (p, r, o) => {
      const { appendJsonl } = await import("../src/fs/jsonl");
      await appendJsonl(p, r, o);                       // the line lands...
      if (n++ === 0) throw new Error("fsync failed");   // ...but the caller is told it failed
    } });
    await sink.commit(text(1));
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("a gallery failure does not fail the commit or duplicate the index line, and is reported", async () => {
    const dir = await cave(); const warnings: string[] = [];
    const sink = new FileMarkSink(dir, { onWarning: (m) => warnings.push(m), writeAtomic: async (p, d, o) => { if (p.endsWith("gallery.html")) throw new Error("no space"); return writeFileAtomic(p, d, o); } });
    await sink.commit(text(1));
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    expect(warnings[0]).toContain("gallery.html");
  });

  it("committing the identical mark again is harmless; different content under the same id is refused without retrying", async () => {
    const dir = await cave(); let writes = 0;
    const sink = new FileMarkSink(dir, { writeAtomic: async (p, d, o) => { writes++; return writeFileAtomic(p, d, o); } });
    await sink.commit(text(1));
    await sink.commit(text(1));
    expect((await readFile(join(dir, "marks.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    const before = writes;
    await expect(sink.commit(text(1, "changed"))).rejects.toBeInstanceOf(MarkConflictError);
    expect(writes).toBe(before);
    expect(JSON.parse(await readFile(join(dir, "marks", "1.json"), "utf8")).content).toBe("hello wall");
  });

  it("repairs a torn last line in the index before appending", async () => {
    const dir = await cave(); const sink = new FileMarkSink(dir);
    await sink.commit(text(1));
    await appendFile(join(dir, "marks.jsonl"), '{"schema_version":1,"mark_id":2,"auth');
    await sink.commit(text(3));
    const idx = await readMarkIndex(dir);
    expect(idx.marks.map((m) => m.mark_id)).toEqual([1, 3]);
    expect(idx.corrupt).toBe(0);
  });

  it("copies the cave files to the mirror folder when one is set", async () => {
    const dir = await cave(); const mirror = await cave();
    await new FileMarkSink(dir, { mirrorDir: mirror }).commit(text(1));
    expect((await readdir(join(mirror, "marks"))).sort()).toEqual(["1.json", "1.png", "1.svg"]);
    expect(await readFile(join(mirror, "marks.jsonl"), "utf8")).toBe(await readFile(join(dir, "marks.jsonl"), "utf8"));
    expect(await readFile(join(mirror, "gallery.html"), "utf8")).toContain("Mark 1");
  });

  it("an unusable mirror is reported, not fatal", async () => {
    const dir = await cave(); const warnings: string[] = [];
    await writeFile(join(dir, "blocker"), "x");
    await new FileMarkSink(dir, { mirrorDir: join(dir, "blocker", "sub"), onWarning: (m) => warnings.push(m) }).commit(text(1));
    expect(warnings).toContain("mirror copy failed");
  });
});

describe("readMarkIndex", () => {
  it("counts bad lines and repeated ids and sorts by id", async () => {
    const dir = await cave();
    await writeFile(join(dir, "marks.jsonl"), [JSON.stringify(text(2)), "garbage", JSON.stringify(text(1)), JSON.stringify(text(2, "again")), JSON.stringify({ mark_id: 9 })].join("\n") + "\n");
    const idx = await readMarkIndex(dir);
    expect(idx.marks.map((m) => m.mark_id)).toEqual([1, 2]);
    expect(idx.marks[1]!.content).toBe("hello wall");
    expect(idx).toMatchObject({ corrupt: 2, duplicates: 1 });
  });
  it("a missing index is empty", async () => {
    expect(await readMarkIndex(await cave())).toEqual({ marks: [], corrupt: 0, duplicates: 0 });
  });
});

describe("images", () => {
  it("the PNG is valid and shows a drawing in its pigments on the rock", () => {
    const png = decodePng(renderPng(drawing(1)));
    expect(png).toMatchObject({ width: PREVIEW_W, height: PREVIEW_H });
    expect(png.px(5, 5)).toEqual([0x6b, 0x65, 0x5c, 255]);                         // bare rock in the corner
    expect(png.px(Math.round(50 * 4.32), Math.round(25 * 4.32))).toEqual([0xa8, 0x39, 0x2b, 255]); // red line through the middle
    expect(png.px(Math.round(50 * 4.32), Math.round(10 * 4.32))).toEqual([0xeb, 0xe2, 0xcb, 255]); // pale dot
  });

  it("a single-point stroke is a visible dot in both the PNG and the SVG", () => {
    const m: MarkRecord = { ...drawing(1), content: { strokes: [{ pigment: "dark", width: "thick", points: [[20, 20]] }] } };
    expect(renderSvg(m)).toContain("<circle");
    expect(decodePng(renderPng(m)).px(Math.round(20 * 4.32), Math.round(20 * 4.32))).toEqual([0x26, 0x21, 0x1d, 255]);
  });

  it("text draws in the mark's pigment, and a 280-character text wraps into at most 8 lines", () => {
    const long = "the quick brown fox jumps over the lazy dog ".repeat(7).trim().slice(0, 280);
    const png = decodePng(renderPng(text(1, long, "dark")));
    let ink = 0;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) { const p = png.px(x, y); if (p[0] === 0x26 && p[1] === 0x21) ink++; }
    expect(ink).toBeGreaterThan(500);
    expect(wrapText(long).length).toBeLessThanOrEqual(8);
  });

  it("different text gives a different picture; the same text gives identical bytes", () => {
    expect(renderPng(text(1, "abc")).equals(renderPng(text(2, "abd")))).toBe(false);
    expect(renderPng(text(1, "abc")).equals(renderPng(text(9, "abc")))).toBe(true);
  });

  it("the SVG uses real colors for the four pigments, wraps text, and keeps newlines", () => {
    const svg = renderSvg(drawing(1));
    expect(svg).toContain('stroke="#a8392b"');
    expect(svg).not.toContain("brown-yellow");
    const t = renderSvg(text(1, "x".repeat(100) + "\nsecond line", "brown-yellow"));
    expect(t).toContain('fill="#b0832f"');
    expect((t.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("wrapText breaks on words, splits very long words, and caps the rows", () => {
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("x".repeat(10), 4)).toEqual(["xxxx", "xxxx", "xx"]);
    expect(wrapText("one\ntwo")).toEqual(["one", "two"]);
    expect(wrapText("a\n".repeat(20)).length).toBe(8);
  });

  it("an empty gallery is still a valid page", () => {
    expect(renderGallery([])).toContain("0 mark(s)");
  });
});

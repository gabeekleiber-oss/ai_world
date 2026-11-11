import type { Drawing, MarkRecord } from "@ai-world/shared";
import { GLYPH_H, GLYPH_W, glyph } from "./font";
import { encodePng } from "./png";
import { CANVAS_W, ROCK, TEXT_COLUMNS, WIDTH_UNITS, pigmentColor, wrapText } from "./render";

/** Preview size: 4.32 pixels per canvas unit so a 36-column line of 12-pixel glyph cells fills the width exactly. */
export const PREVIEW_W = 432;
export const PREVIEW_H = 216;
const PX = PREVIEW_W / CANVAS_W;
const GLYPH_SCALE = 2;
const CELL_W = (GLYPH_W + 1) * GLYPH_SCALE;
const CELL_H = (GLYPH_H + 1) * GLYPH_SCALE;

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

class Canvas {
  readonly data = new Uint8Array(PREVIEW_W * PREVIEW_H * 4);
  constructor(background: string) {
    const [r, g, b] = hex(background);
    for (let i = 0; i < this.data.length; i += 4) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255; }
  }
  set(x: number, y: number, rgb: [number, number, number]): void {
    if (x < 0 || y < 0 || x >= PREVIEW_W || y >= PREVIEW_H) return;
    const i = (y * PREVIEW_W + x) * 4;
    this.data[i] = rgb[0]; this.data[i + 1] = rgb[1]; this.data[i + 2] = rgb[2]; this.data[i + 3] = 255;
  }
  disc(cx: number, cy: number, r: number, rgb: [number, number, number]): void {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, rgb);
  }
  line(ax: number, ay: number, bx: number, by: number, r: number, rgb: [number, number, number]): void {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, r / 2)));
    for (let i = 0; i <= n; i++) this.disc(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, r, rgb);
  }
}

function drawDrawing(c: Canvas, drawing: Drawing): void {
  for (const s of drawing.strokes) {
    const rgb = hex(pigmentColor(s.pigment));
    const r = Math.max(0.8, ((WIDTH_UNITS[s.width] ?? 1.6) * PX) / 2);
    const pts = s.points.map(([x, y]) => [x * PX, y * PX] as const);
    if (pts.length === 1) { c.disc(pts[0]![0], pts[0]![1], r, rgb); continue; }
    for (let i = 1; i < pts.length; i++) c.line(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], r, rgb);
  }
}

function drawText(c: Canvas, text: string, pigment: string | undefined): void {
  const rgb = hex(pigmentColor(pigment));
  wrapText(text, TEXT_COLUMNS).forEach((line, row) => {
    [...line].forEach((ch, col) => {
      glyph(ch).forEach((bits, gy) => {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (!(bits & (1 << (GLYPH_W - 1 - gx)))) continue;
          for (let dy = 0; dy < GLYPH_SCALE; dy++) for (let dx = 0; dx < GLYPH_SCALE; dx++) c.set(col * CELL_W + gx * GLYPH_SCALE + dx + 2, row * CELL_H + gy * GLYPH_SCALE + dy + 2, rgb);
        }
      });
    });
  });
}

/** Raster preview of a mark as RGBA pixels. Same pigments and background as the SVG. */
export function rasterizeMark(mark: Pick<MarkRecord, "content" | "pigment">): { width: number; height: number; rgba: Uint8Array } {
  const c = new Canvas(ROCK);
  if (typeof mark.content === "string") drawText(c, mark.content, mark.pigment);
  else drawDrawing(c, mark.content);
  return { width: PREVIEW_W, height: PREVIEW_H, rgba: c.data };
}

export function renderPng(mark: Pick<MarkRecord, "content" | "pigment">): Buffer {
  const { width, height, rgba } = rasterizeMark(mark);
  return encodePng(width, height, rgba);
}


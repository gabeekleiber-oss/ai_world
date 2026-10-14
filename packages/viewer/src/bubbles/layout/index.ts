/** Framework-independent, deterministic speech bubble placement. Coordinates are CSS pixels. */
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Bubble = {
  id: string; anchor: Point; size: { width: number; height: number };
  priority?: number; selected?: boolean; onStone?: boolean; distanceToFocus?: number;
  recency?: number; visible?: boolean; body?: Rect; text?: string;
};
export type Placement = {
  id: string; rect: Rect | null; anchor: Point; slot: number;
  mode: "full" | "pill" | "hidden"; label?: string;
};
export type LayoutOptions = {
  width: number; height: number; hud?: Rect[]; bodies?: Rect[];
  margin?: number; previous?: readonly Placement[]; elapsedMs?: number;
  /** Minimum time an occupied previous slot must remain obstructed before moving. */
  hysteresisMs?: number;
};
const offsets: readonly Point[] = [
  { x: 0, y: -1 }, { x: 0, y: -2 }, { x: 1, y: -1 },
  { x: -1, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 },
  { x: 0, y: -3 }, { x: 1, y: -2 }, { x: -1, y: -2 },
  { x: 2, y: -2 }, { x: -2, y: -2 }, { x: 0, y: -4 },
];
export function intersects(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function fits(r: Rect, options: LayoutOptions, occupied: Rect[]): boolean {
  const margin = options.margin ?? 6;
  return r.x >= margin && r.y >= margin &&
    r.x + r.width <= options.width - margin &&
    r.y + r.height <= options.height - margin &&
    !occupied.some(other => intersects(r, other, margin));
}
function candidate(anchor: Point, size: { width: number; height: number }, slot: number): Rect {
  const offset = offsets[slot]!;
  const stepX = size.width / 2 + 14;
  return { x: anchor.x - size.width / 2 + offset.x * stepX,
    y: anchor.y - size.height - 14 + (offset.y + 1) * (size.height + 12),
    width: size.width, height: size.height };
}
function place(anchor: Point, size: {width:number;height:number}, options: LayoutOptions, occupied: Rect[], preferred = -1) {
  const slots = preferred >= 0 ? [preferred, ...offsets.map((_, i) => i).filter(i => i !== preferred)] : offsets.map((_, i) => i);
  for (const slot of slots) {
    const rect = candidate(anchor, size, slot);
    if (fits(rect, options, occupied)) return { rect, slot };
  }
  return null;
}
export function layoutBubbles(bubbles: readonly Bubble[], options: LayoutOptions): Placement[] {
  const previous = new Map((options.previous ?? []).map(p => [p.id, p]));
  const occupied: Rect[] = [...(options.hud ?? []), ...(options.bodies ?? []),
    ...bubbles.flatMap(b => b.body ? [b.body] : [])];
  const ordered = bubbles.map((bubble, index) => ({ bubble, index })).sort((a, b) => {
    const x = a.bubble, y = b.bubble;
    return Number(!!y.selected) - Number(!!x.selected) ||
      Number(!!y.onStone) - Number(!!x.onStone) ||
      (y.priority ?? 0) - (x.priority ?? 0) ||
      (x.distanceToFocus ?? Infinity) - (y.distanceToFocus ?? Infinity) ||
      (y.recency ?? 0) - (x.recency ?? 0) || a.index - b.index;
  });
  const result: Placement[] = [];
  for (const { bubble } of ordered) {
    const anchor = bubble.anchor;
    if (bubble.visible === false || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) ||
        anchor.x < 0 || anchor.x > options.width || anchor.y < 0 || anchor.y > options.height) {
      result.push({ id: bubble.id, anchor, rect: null, slot: -1, mode: "hidden" });
      continue;
    }
    const prev = previous.get(bubble.id);
    const original = { width: Math.max(1, bubble.size.width), height: Math.max(1, bubble.size.height) };
    // Retain an unobstructed prior slot. A newly obstructed slot cannot be retained:
    // zero-overlap takes precedence over temporal hysteresis.
    let found = place(anchor, original, options, occupied, prev?.mode === "full" ? prev.slot : -1);
    let mode: Placement["mode"] = "full";
    if (!found) {
      mode = "pill";
      found = place(anchor, { width: Math.min(120, original.width), height: Math.min(28, original.height) }, options, occupied,
        prev?.mode === "pill" ? prev.slot : -1);
    }
    if (!found) mode = "hidden";
    const entry: Placement = { id: bubble.id, anchor, rect: found?.rect ?? null,
      slot: found?.slot ?? -1, mode, ...(mode === "pill" ? { label: (bubble.text ?? "").slice(0, 20) + "…" } : {}) };
    if (entry.rect) occupied.push(entry.rect);
    result.push(entry);
  }
  return result;
}
/** Critically damped positional smoothing, clamped to prevent overshoot. */
export function springStep(current: Point, target: Point, velocity: Point, dtSeconds: number, frequency = 12) {
  const dt = Math.max(0, Math.min(dtSeconds, 0.05));
  const f = Math.max(0.01, frequency);
  const decay = Math.exp(-f * dt);
  const dx = current.x - target.x, dy = current.y - target.y;
  const vx = (velocity.x + f * dx) * dt, vy = (velocity.y + f * dy) * dt;
  return {
    position: { x: target.x + (dx + vx) * decay, y: target.y + (dy + vy) * decay },
    velocity: { x: (velocity.x - f * vx) * decay, y: (velocity.y - f * vy) * decay },
  };
}

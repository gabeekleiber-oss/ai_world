import { describe, expect, it } from "vitest";
import { intersects, layoutBubbles, springStep, type Bubble } from "./index.js";
const hud = [{ x: 0, y: 0, width: 160, height: 90 }];
function verify(bubbles: Bubble[], width = 900, height = 600) {
  const out = layoutBubbles(bubbles, { width, height, hud });
  const rects = out.flatMap(p => p.rect ? [p.rect] : []);
  for (let i = 0; i < rects.length; i++) {
    expect(intersects(rects[i]!, hud[0]!)).toBe(false);
    for (let j = i + 1; j < rects.length; j++) expect(intersects(rects[i]!, rects[j]!)).toBe(false);
  }
  return out;
}
describe("speech bubble layout", () => {
  it("avoids overlap with four identical anchors across zoom sweep", () => {
    for (let zoom = 0; zoom < 50; zoom++) {
      const anchor = { x: 450 + zoom / 10, y: 350 };
      const bubbles = Array.from({ length: 4 }, (_, i) => ({
        id: String(i), anchor, size: { width: 250, height: 95 },
        text: "long utterance ".repeat(40), priority: 4 - i,
      }));
      verify(bubbles);
    }
  });
  it("hides offscreen and nonprojectable anchors", () => {
    const out = verify([{ id: "a", anchor: { x: -1, y: 100 }, size: { width: 80, height: 30 } },
      { id: "b", anchor: { x: NaN, y: 100 }, size: { width: 80, height: 30 } }]);
    expect(out.every(x => x.mode === "hidden")).toBe(true);
  });
  it("collapses or hides when space is exhausted", () => {
    const bubbles = Array.from({ length: 4 }, (_, i) => ({
      id: String(i), anchor: { x: 120, y: 120 }, size: { width: 260, height: 120 }, text: "<tag>🌿".repeat(100),
    }));
    const out = verify(bubbles, 260, 200);
    expect(out.some(x => x.mode !== "full")).toBe(true);
  });
  it("respects projected bodies and HUD", () => {
    const body = { x: 420, y: 200, width: 60, height: 160 };
    const out = layoutBubbles([{ id: "a", anchor: { x: 450, y: 220 }, size: { width: 120, height: 40 } }],
      { width: 900, height: 600, bodies: [body], hud });
    for (const p of out) if (p.rect) expect(intersects(p.rect, body)).toBe(false);
  });
  it("retains stable slots for stationary agents", () => {
    const bubbles = [{ id: "a", anchor: { x: 450, y: 350 }, size: { width: 150, height: 50 } }];
    const a = verify(bubbles);
    const b = layoutBubbles(bubbles, { width: 900, height: 600, previous: a, hud });
    expect(b).toEqual(a);
  });
  it("spring converges without overshoot", () => {
    let position = { x: 0, y: 0 }, velocity = { x: 0, y: 0 };
    for (let i = 0; i < 120; i++) {
      const step = springStep(position, { x: 100, y: 0 }, velocity, 1 / 60);
      position = step.position; velocity = step.velocity;
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(100);
    }
    expect(position.x).toBeCloseTo(100, 4);
  });
});

import { describe, expect, it } from "vitest";
import { Rng, canonical, stateHash } from "../src";

describe("Rng", () => {
  it("is deterministic per seed and label, and streams are independent", () => {
    const a = new Rng(42, "x"), b = new Rng(42, "x"), c = new Rng(42, "y"), d = new Rng(43, "x");
    const seqA = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(seqA);
    expect(Array.from({ length: 8 }, () => d.next())).not.toEqual(seqA);
  });
  it("resumes exactly from a saved state", () => {
    const a = new Rng(7, "s"); for (let i = 0; i < 100; i++) a.next();
    const saved = a.getState(), next = [a.next(), a.next(), a.next()];
    const b = Rng.fromState(saved);
    expect([b.next(), b.next(), b.next()]).toEqual(next);
  });
  it("respects bounds and is roughly uniform", () => {
    const r = new Rng(1, "u"); let sum = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.02);
    for (let i = 0; i < 500; i++) { const n = r.int(3, 7); expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThan(7); }
  });
  it("shuffle is a permutation and does not mutate its input", () => {
    const src = [1, 2, 3, 4, 5, 6], out = new Rng(5, "sh").shuffle(src);
    expect([...out].sort()).toEqual(src); expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("state hash", () => {
  it("ignores key order and changes with content", () => {
    expect(canonical({ a: 1, b: [1, { d: 2, c: 3 }] })).toBe(canonical({ b: [1, { c: 3, d: 2 }], a: 1 }));
    expect(stateHash({ a: 1 })).toBe(stateHash({ a: 1 }));
    expect(stateHash({ a: 1 })).not.toBe(stateHash({ a: 2 }));
  });
});

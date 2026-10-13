/**
 * Seeded random numbers (DESIGN.md section 11, Determinism). sfc32 seeded through splitmix32.
 * Streams are named: a stream's output depends only on the run seed and its label, never on how many
 * draws other streams have made, so adding a feature never reshuffles unrelated randomness.
 */
export type RngState = [number, number, number, number];

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97); t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  private s: RngState;
  /** Number of draws made, for the event log and debugging. */
  draws = 0;

  constructor(seed: number, label = "", state?: RngState) {
    if (state) { this.s = [...state] as RngState; return; }
    const sm = splitmix32((seed ^ hashString(label)) | 0);
    this.s = [sm(), sm(), sm(), sm()];
    for (let i = 0; i < 12; i++) this.next();
    this.draws = 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.draws++;
    let [a, b, c, d] = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a, b, c, d];
    return (t >>> 0) / 4294967296;
  }

  /** Float in [lo, hi). */
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  /** Integer in [lo, hi). */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[this.int(0, items.length)]!;
  }
  /** Fisher-Yates; returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) { const j = this.int(0, i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
    return out;
  }
  getState(): RngState { return [...this.s] as RngState; }
  static fromState(state: RngState): Rng { return new Rng(0, "", state); }
}

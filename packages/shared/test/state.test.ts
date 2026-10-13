import { describe, expect, it } from "vitest";
import { AgentStateSchema, BodySchema, BushSchema, ClockStateSchema, WorldStateSchema } from "../src";

const body = {
  id: "mind-1", slot: 0, kind: "plain", malicious: false,
  appearance: { skin: 0.4, hair: 0.2, height_cm: 170, build: "average", mark: "none" },
  strength: 1.02, pos: { x: 3, z: -4 }, health: 100, satiety: 70, fatigue: 0, start_age_days: 15, spawn_beat: 0,
  awake: true, alive: true, carried: [],
} as const;

describe("state schemas", () => {
  it("round-trips a body, with and without a death record", () => {
    expect(BodySchema.parse(body)).toEqual(body);
    const dead = { ...body, alive: false, awake: false, death: { beat: 90, cause: "starvation" } };
    expect(BodySchema.parse(dead)).toEqual(dead);
  });
  it("extends a body into an agent state", () => {
    expect(AgentStateSchema.parse({ ...body, lifecycle: "awake", marks_left: 2 }).lifecycle).toBe("awake");
    expect(() => AgentStateSchema.parse({ ...body, lifecycle: "flying", marks_left: 2 })).toThrow();
  });
  it("rejects out-of-range needs and unknown enums", () => {
    expect(() => BodySchema.parse({ ...body, satiety: 140 })).toThrow();
    expect(() => BodySchema.parse({ ...body, kind: "priest" })).toThrow();
  });
  it("parses a bush and a clock", () => {
    const bush = { id: "bush-1", pos: { x: 1, z: 2 }, berries: 12, capacity: 12, progress: 0, phase: "normal", phase_until: 0 };
    expect(BushSchema.parse(bush)).toEqual(bush);
    const clock = { beat: 41, day: 1, beatOfDay: 1, phase: "dawn", isNight: false };
    expect(ClockStateSchema.parse(clock)).toEqual(clock);
  });
  it("requires schema_version 1 on the world", () => {
    expect(() => WorldStateSchema.parse({ schema_version: 2 })).toThrow();
  });
});

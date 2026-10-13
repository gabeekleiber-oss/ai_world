import { describe, expect, it } from "vitest";
import { HandleRegistry } from "./handles";
import { KnownPlaces } from "./places";

describe("HandleRegistry", () => {
  it("assigns stable handles in first-seen order across kinds", () => {
    const mind = new HandleRegistry();
    expect(mind.getOrCreate("reed", "thing")).toBe("thing-1");
    expect(mind.getOrCreate("MIND-2", "other")).toBe("other-2");
    expect(mind.getOrCreate("pool", "place")).toBe("place-3");
    expect(mind.getOrCreate("reed", "thing")).toBe("thing-1");
    expect(mind.getOrCreate("reed", "place")).toBe("thing-1");
  });

  it("keeps mappings and labels private to each mind", () => {
    const firstMind = new HandleRegistry();
    const secondMind = new HandleRegistry();
    const first = firstMind.getOrCreate("same-world-entity", "thing");
    firstMind.label(first, "sleep-grass");

    // The second mind's first handle is local to its own encounter order.
    const secondMindFirst = secondMind.getOrCreate("unrelated-entity", "thing");
    expect(secondMindFirst).toBe("thing-1");
    expect(secondMind.getLabel(secondMindFirst)).toBeUndefined();
    expect(secondMind.getOrCreate("same-world-entity", "other")).toBe("other-2");
    expect(firstMind.getLabel(first)).toBe("sleep-grass");
  });

  it("supports relabeling and removing a label", () => {
    const mind = new HandleRegistry();
    const handle = mind.getOrCreate("pool", "place");
    mind.label(handle, "still-water");
    mind.label(handle, "blue-place");
    expect(mind.getLabel(handle)).toBe("blue-place");
    mind.label(handle, null);
    expect(mind.getLabel(handle)).toBeUndefined();
  });

  it("rejects labels longer than forty characters", () => {
    const mind = new HandleRegistry();
    const handle = mind.getOrCreate("pool", "place");
    expect(() => mind.label(handle, "x".repeat(41))).toThrow(/40 characters/);
  });
});

describe("KnownPlaces", () => {
  it("preserves first-observed order and refreshes last-seen details", () => {
    const handles = new HandleRegistry();
    const grass = handles.getOrCreate("grass", "thing");
    const pool = handles.getOrCreate("pool", "place");
    const places = new KnownPlaces(handles);

    places.observe({ handle: grass, description: "soft flat ground", bearing: "left", steps: 5, seenAt: 2 });
    places.observe({ handle: pool, description: "still water", bearing: "ahead", steps: 8, seenAt: 3 });
    places.observe({ handle: grass, description: "soft flat ground", bearing: "behind", steps: 2, seenAt: 9 });

    expect(places.list().map((entry) => entry.handle)).toEqual([grass, pool]);
    expect(places.get(grass)).toMatchObject({ bearing: "behind", steps: 2, seenAt: 9 });
  });

  it("reflects a relabel in known-place entries", () => {
    const handles = new HandleRegistry();
    const pool = handles.getOrCreate("pool", "place");
    const places = new KnownPlaces(handles);
    places.observe({ handle: pool, description: "still water", bearing: "ahead", steps: 8, seenAt: 3 });

    handles.label(pool, "sleep-grass");
    expect(places.get(pool)?.label).toBe("sleep-grass");
  });
});

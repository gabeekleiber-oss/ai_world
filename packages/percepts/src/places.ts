import type { Handle } from "@ai-world/shared";
import type { HandleRegistry } from "./handles";

export interface PlaceObservation {
  handle: Handle;
  description: string;
  bearing: string;
  steps: number;
  /** Simulation time at which this handle was last perceived. */
  seenAt: number;
}

export interface KnownPlace extends PlaceObservation {
  label: string | null;
}

/**
 * Per-mind spatial memory for places and things. Observation updates the last-seen
 * time and current relative position without changing the entry's original order.
 */
export class KnownPlaces {
  private readonly entries = new Map<Handle, PlaceObservation>();

  constructor(private readonly handles: HandleRegistry) {}

  observe(observation: PlaceObservation): void {
    if (!this.handles.has(observation.handle)) {
      throw new Error(`handle is not known to this mind: ${observation.handle}`);
    }
    if (!observation.description.trim()) throw new Error("description must not be empty");
    if (!observation.bearing.trim()) throw new Error("bearing must not be empty");
    if (!Number.isFinite(observation.steps) || observation.steps < 0) {
      throw new Error("steps must be a finite non-negative number");
    }
    if (!Number.isFinite(observation.seenAt) || observation.seenAt < 0) {
      throw new Error("seenAt must be a finite non-negative number");
    }

    this.entries.set(observation.handle, { ...observation });
  }

  /** Entries are returned in first-observed order, with current labels attached. */
  list(): KnownPlace[] {
    return [...this.entries.values()].map((entry) => ({
      ...entry,
      label: this.handles.getLabel(entry.handle) ?? null,
    }));
  }

  get(handle: Handle): KnownPlace | undefined {
    const entry = this.entries.get(handle);
    if (!entry) return undefined;
    return { ...entry, label: this.handles.getLabel(handle) ?? null };
  }

  forget(handle: Handle): boolean {
    return this.entries.delete(handle);
  }

  get size(): number {
    return this.entries.size;
  }
}

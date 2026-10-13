import type { Handle } from "@ai-world/shared";

export type HandleKind = "thing" | "other" | "place";

const HANDLE_PATTERN = /^(thing|other|place)-\\d+$/;
const MAX_LABEL_LENGTH = 40;

/**
 * A per-mind registry. Create one registry for each mind; never share it between agents.
 * Numbering follows first-seen order across all kinds, while the prefix describes the kind.
 */
export class HandleRegistry {
  private nextNumber = 1;
  private readonly byEntity = new Map<string, Handle>();
  private readonly labels = new Map<Handle, string>();

  /** Return the existing handle for an entity, or assign its first-seen handle. */
  getOrCreate(entityKey: string, kind: HandleKind): Handle {
    if (!entityKey.trim()) throw new Error("entityKey must not be empty");

    const existing = this.byEntity.get(entityKey);
    if (existing) return existing;

    const handle = `${kind}-${this.nextNumber++}` as Handle;
    this.byEntity.set(entityKey, handle);
    return handle;
  }

  /** Resolve an entity key without assigning a handle. */
  get(entityKey: string): Handle | undefined {
    return this.byEntity.get(entityKey);
  }

  /** Attach or replace this mind's private label. Pass null to remove it. */
  label(handle: Handle, text: string | null): void {
    this.assertKnownHandle(handle);
    if (text === null || text.length === 0) {
      this.labels.delete(handle);
      return;
    }
    if (text.length > MAX_LABEL_LENGTH) {
      throw new Error(`label must be ${MAX_LABEL_LENGTH} characters or fewer`);
    }
    this.labels.set(handle, text);
  }

  /** Return the private label, if any. */
  getLabel(handle: Handle): string | undefined {
    this.assertKnownHandle(handle);
    return this.labels.get(handle);
  }

  /** True only when this registry assigned the handle. */
  has(handle: string): handle is Handle {
    return HANDLE_PATTERN.test(handle) && [...this.byEntity.values()].includes(handle as Handle);
  }

  private assertKnownHandle(handle: Handle): void {
    if (!this.has(handle)) throw new Error(`unknown handle: ${handle}`);
  }
}

import type { SimEvent } from "@ai-world/shared";

/** What a cursor needs from a replay. Kept structural so cursor.ts and reader.ts do not import each other. */
export interface CursorSource {
  readonly events: readonly SimEvent[];
  indexAtSeq(seq: number): number;
  indexAtBeat(beat: number): number;
}

/**
 * A playback position in a replay: step through events, jump to a beat or a sequence number, and scrub
 * backwards. Pause, speed and timing belong to the viewer; the cursor only knows order.
 *
 * `index` is the number of events already played, so the cursor sits between events. `0` is the start and
 * `events.length` is the end.
 */
export class ReplayCursor {
  #index = 0;

  constructor(private readonly source: CursorSource) {}

  get index(): number {
    return this.#index;
  }

  get atStart(): boolean {
    return this.#index === 0;
  }

  get atEnd(): boolean {
    return this.#index >= this.source.events.length;
  }

  get remaining(): number {
    return this.source.events.length - this.#index;
  }

  /** The event that `next()` would return, without moving. */
  peek(): SimEvent | undefined {
    return this.source.events[this.#index];
  }

  /** The event just played, or undefined at the start. */
  get current(): SimEvent | undefined {
    return this.source.events[this.#index - 1];
  }

  next(): SimEvent | undefined {
    const event = this.source.events[this.#index];
    if (event) this.#index += 1;
    return event;
  }

  /** All remaining events of the beat the cursor is in or about to enter, and move past them. Empty at the end. */
  nextBeat(): SimEvent[] {
    const first = this.peek();
    if (!first) return [];
    const out: SimEvent[] = [];
    for (let event = this.peek(); event && event.beat === first.beat; event = this.peek()) {
      out.push(event);
      this.#index += 1;
    }
    return out;
  }

  /** Put the cursor just before the first event with `seq` at or above the given number. Returns the new index. */
  seekToSeq(seq: number): number {
    this.#index = this.source.indexAtSeq(seq);
    return this.#index;
  }

  /** Put the cursor at the start of a beat (before any of its events), or at the end if the beat is after the last one. */
  seekToBeat(beat: number): number {
    this.#index = this.source.indexAtBeat(beat);
    return this.#index;
  }

  rewind(): void {
    this.#index = 0;
  }

  toEnd(): void {
    this.#index = this.source.events.length;
  }

  /** Play every remaining event in order, advancing the cursor as it goes. */
  *play(): Generator<SimEvent> {
    for (let event = this.next(); event; event = this.next()) yield event;
  }
}

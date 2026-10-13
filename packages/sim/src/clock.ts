import type { Config } from "@ai-world/shared";

export type Phase = "dawn" | "day" | "dusk" | "night";
export interface Clock { beat: number; day: number; beatOfDay: number; phase: Phase; isNight: boolean }

const within = (b: number, r: readonly [number, number]) => b >= r[0] && b < r[1];

/** Beat to calendar. One game day is `beats_per_day` beats (DESIGN.md section 5). */
export function clockAt(beat: number, t: Config["time"]): Clock {
  const day = Math.floor(beat / t.beats_per_day);
  const beatOfDay = beat % t.beats_per_day;
  const phase: Phase = within(beatOfDay, t.dawn_beats) ? "dawn" : within(beatOfDay, t.day_beats) ? "day" : within(beatOfDay, t.dusk_beats) ? "dusk" : "night";
  return { beat, day, beatOfDay, phase, isNight: phase === "night" };
}

import type { TypedEvent } from "@ai-world/shared";

export interface Evidence { event_seq: number; game_day: number; actor: string; source: "speech" | "label" | "leaf"; text: string }
export interface TokenFinding { token: string; first: Evidence; speakers: string[]; uses: Evidence[]; adopted_by: string[]; half_life_beats: number | null }
export interface DailyLeakCount { agent: string; game_day: number; M0: number; M1: number; M2: number; M3: number; M4: number; evidence: number[] }
export interface LexiconReport { coinages: TokenFinding[]; adoptions: TokenFinding[]; daily: DailyLeakCount[] }

const meta = new Set(["ai", "assistant", "model", "simulation", "game", "world", "player", "user", "agent", "character", "bot", "prompt", "program", "npc", "system", "instruction"]);
const borrowed = new Set(["god", "gods", "pray", "prayer", "ancestors", "divine", "holy", "sacred", "worship", "religion", "priest", "church", "temple", "altar", "sermon", "bless", "spirit", "soul", "heaven", "hell", "ritual", "ceremony"]);
const tokenise = (text: string) => text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? [];

function textEvidence(event: TypedEvent): Evidence[] {
  const actor = event.actor;
  if (!actor) return [];
  if (event.type === "speech" || event.type === "gathering_speech") return [{ event_seq: event.seq, game_day: event.game_day, actor, source: "speech", text: event.data.text }];
  if (event.type === "label") return [{ event_seq: event.seq, game_day: event.game_day, actor, source: "label", text: event.data.text }];
  if (event.type === "leaf_written") return [{ event_seq: event.seq, game_day: event.game_day, actor, source: "leaf", text: event.data.text }];
  return [];
}

/** Offline-only deterministic M0–M4 detector. Dictionary membership is supplied by the caller. */
export function analyzeLexicon(events: readonly TypedEvent[], dictionary: ReadonlySet<string>): LexiconReport {
  const uses = new Map<string, Evidence[]>();
  for (const event of events) for (const evidence of textEvidence(event)) {
    for (const token of tokenise(evidence.text)) (uses.get(token) ?? (uses.set(token, []), uses.get(token)!)).push(evidence);
  }
  const daily = new Map<string, DailyLeakCount>();
  const count = (e: Evidence, kind: keyof Pick<DailyLeakCount, "M0" | "M1" | "M2" | "M3" | "M4">) => {
    const key = `${e.actor}:${e.game_day}`;
    const row = daily.get(key) ?? { agent: e.actor, game_day: e.game_day, M0: 0, M1: 0, M2: 0, M3: 0, M4: 0, evidence: [] };
    row[kind]++; row.evidence.push(e.event_seq); daily.set(key, row);
  };
  const coinages: TokenFinding[] = [];
  const adoptions: TokenFinding[] = [];
  for (const [token, entries] of uses) {
    const first = entries[0]!;
    const speakers = [...new Set(entries.map((entry) => entry.actor))];
    if (meta.has(token)) { entries.forEach((e) => count(e, "M0")); continue; }
    if (borrowed.has(token)) entries.forEach((e) => count(e, "M1"));
    if (dictionary.has(token)) continue;
    const adopted_by = speakers.filter((speaker) => speaker !== first.actor);
    const finding: TokenFinding = { token, first, speakers, uses: entries, adopted_by, half_life_beats: entries.length > 1 ? (entries.at(-1)!.event_seq - first.event_seq) / 2 : null };
    coinages.push(finding); entries.forEach((e) => count(e, "M2"));
    if (adopted_by.length) { adoptions.push(finding); entries.filter((e) => e.actor !== first.actor).forEach((e) => count(e, "M4")); }
  }
  return { coinages: coinages.sort((a, b) => a.first.event_seq - b.first.event_seq), adoptions: adoptions.sort((a, b) => a.first.event_seq - b.first.event_seq), daily: [...daily.values()].sort((a, b) => a.game_day - b.game_day || a.agent.localeCompare(b.agent)) };
}

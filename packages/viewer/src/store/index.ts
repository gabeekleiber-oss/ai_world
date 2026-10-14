import type { ServerMessage } from "@ai-world/shared";
export type Point = { x: number; z: number };
export interface Motion { from: Point; to: Point; started: number; duration: number }
export class ViewerStore {
  agents = new Map<string, Point>(); motions = new Map<string, Motion>();
  apply(message: ServerMessage): void {
    if (message.type === "world_state") for (const raw of message.agents) { const a = raw as { id?: unknown; pos?: unknown }; const p = a.pos as Point | undefined; if (typeof a.id === "string" && p) this.agents.set(a.id, p); }
    if (message.type === "beat_plan") for (const plan of message.plans) { const path = plan.path; if (path?.length && path[0] && path.at(-1)) this.motions.set(plan.mind_id, { from: { x: path[0][0], z: path[0][1] }, to: { x: path.at(-1)![0], z: path.at(-1)![1] }, started: performance.now(), duration: message.beat_seconds * 1000 * plan.duration_beats }); }
  }
  position(id: string, now = performance.now()): Point | undefined { const m = this.motions.get(id); if (!m) return this.agents.get(id); const t = Math.min(1, (now - m.started) / m.duration); return { x: m.from.x + (m.to.x - m.from.x) * t, z: m.from.z + (m.to.z - m.from.z) * t }; }
}

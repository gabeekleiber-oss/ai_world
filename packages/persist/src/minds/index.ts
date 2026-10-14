import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl, writeFileAtomic } from "../fs/index";

export interface MindProfile { [key: string]: unknown; id: string }
export interface MindCall { [key: string]: unknown; beat: number; prompt: string; raw_response: string }
export interface MindThought { [key: string]: unknown; beat: number; text: string }
export interface MindMemory { [key: string]: unknown; beat: number; old_account: string; new_account: string }
export interface MindSpeech { [key: string]: unknown; beat: number; text: string }

/**
 * Owns one mind's on-disk records. Every append fsyncs through appendJsonl,
 * which is stricter than the required per-beat flush. Thoughts are accepted
 * only by writeThought and only ever written to thoughts.jsonl (R5).
 */
export class MindLogWriter {
  constructor(private readonly mindsDir: string, readonly mindId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mindId)) throw new Error("mindId must be a simple filename");
  }
  get directory(): string { return join(this.mindsDir, this.mindId); }

  async writeProfile(profile: MindProfile): Promise<void> {
    if (profile.id !== this.mindId) throw new Error("profile id does not match writer");
    await this.ensure();
    await writeFileAtomic(join(this.directory, "profile.json"), JSON.stringify({ ...profile, schema_version: 1 }, null, 2));
  }
  async writeCall(call: MindCall): Promise<void> { await this.append("calls.jsonl", call); }
  async writeThought(thought: MindThought): Promise<void> { await this.append("thoughts.jsonl", thought); }
  async writeMemory(memory: MindMemory): Promise<void> { await this.append("memory.jsonl", memory); }
  async writeSpeech(speech: MindSpeech): Promise<void> { await this.append("speech.jsonl", speech); }

  private async append(file: string, record: Record<string, unknown>): Promise<void> {
    await this.ensure();
    await appendJsonl(join(this.directory, file), record);
  }
  private async ensure(): Promise<void> { await mkdir(this.directory, { recursive: true }); }
}

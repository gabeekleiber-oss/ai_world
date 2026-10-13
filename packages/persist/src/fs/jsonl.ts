import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonRecord = Record<string, unknown>;

export function stampSchemaVersion<T extends JsonRecord>(value: T, schemaVersion = 1): T & { schema_version: number } {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new RangeError("schemaVersion must be a positive integer");
  }
  return { ...value, schema_version: schemaVersion };
}

/** Append one JSON object, add a newline, and fsync before resolving. */
export async function appendJsonl(
  filePath: string,
  value: JsonRecord,
  options: { schemaVersion?: number } = {},
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const record = stampSchemaVersion(value, options.schemaVersion ?? 1);
  const line = `${JSON.stringify(record)}\n`;
  const handle = await open(filePath, "a", 0o666);
  try {
    await handle.writeFile(line, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

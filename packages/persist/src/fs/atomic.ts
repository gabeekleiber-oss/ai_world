import { randomUUID } from "node:crypto";
import { open, mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  /** File mode for the temporary file (and therefore the replaced target). */
  mode?: number;
  /** Injectable rename operation for filesystem adapters and failure testing. */
  renameFile?: typeof rename;
}

export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  let mode = options.mode;
  try {
    const current = await stat(filePath);
    mode ??= current.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", mode ?? 0o666);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  // A failed rename leaves the previous target untouched. A hard process crash
  // at this point can leave an orphaned .tmp file, which recovery may safely ignore.
  await (options.renameFile ?? rename)(temporaryPath, filePath);
  await syncDirectory(directory);
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some platforms/filesystems do not permit opening or fsyncing directories.
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"].includes(code ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}

import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishImmutableJson(output, value, { mode = 0o600 } = {}) {
  const directory = path.dirname(output);
  await mkdir(directory, { recursive: true });
  await syncDirectory(directory);
  const stage = path.join(
    directory,
    `.${path.basename(output)}.stage-${process.pid}-${randomUUID()}`,
  );
  let handle = await open(stage, "wx", mode);
  let published = false;
  try {
    await syncDirectory(directory);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(stage, output);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`immutable receipt already exists: ${output}`);
      }
      throw error;
    }
    published = true;
    await syncDirectory(directory);
    await unlink(stage);
    await syncDirectory(directory);
    return output;
  } finally {
    if (handle !== null) await handle.close();
    if (!published) {
      try {
        await unlink(stage);
        await syncDirectory(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDurableDirectory(directory) {
  try {
    await syncDirectory(directory);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(directory);
  assertDistinctParent(directory, parent);
  await ensureDurableDirectory(parent);
  try {
    await mkdir(directory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await syncDirectory(parent);
  await syncDirectory(directory);
}

function assertDistinctParent(directory, parent) {
  if (directory === parent) throw new Error(`cannot create receipt directory: ${directory}`);
}

export async function publishImmutableJson(output, value, { mode = 0o600 } = {}) {
  const directory = path.dirname(output);
  await ensureDurableDirectory(directory);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const stage = path.join(
    directory,
    `.${path.basename(output)}.stage-${process.pid}-${randomUUID()}`,
  );
  let handle = await open(stage, "wx", mode);
  let stagePresent = true;
  try {
    await syncDirectory(directory);
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(stage, output);
    } catch (error) {
      if (error?.code === "EEXIST") {
        const existing = await readFile(output, "utf8");
        if (existing === serialized) return output;
        throw new Error(`immutable receipt already exists: ${output}`);
      }
      throw error;
    }
    await syncDirectory(directory);
    await unlink(stage);
    stagePresent = false;
    await syncDirectory(directory);
    return output;
  } finally {
    if (handle !== null) await handle.close();
    if (stagePresent) {
      try {
        await unlink(stage);
        stagePresent = false;
        await syncDirectory(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const sha256HexPattern = /^[a-f0-9]{64}$/;

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath) {
  return sha256Hex(await readFile(filePath));
}

export function isSha256Hex(value) {
  return typeof value === "string" && sha256HexPattern.test(value);
}

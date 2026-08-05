import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse the generated `export type Command =` union in types.ts into variant tag names.
 * Regenerated via `cargo run -p wire --bin export_types -- --write`.
 */
export function readGeneratedCommandTags() {
  const typesPath = join(dirname(fileURLToPath(import.meta.url)), "types.ts");
  const text = readFileSync(typesPath, "utf8");
  const match = /export type Command = (.+);/su.exec(text);
  if (match === null) {
    throw new Error(
      "export type Command not found in frontend/src/lib/wire/types.ts; run export_types --write",
    );
  }
  const tags = [...match[1].matchAll(/\{\s*"([A-Za-z0-9_]+)"\s*:/gu)].map(
    (entry) => entry[1],
  );
  if (tags.length === 0) {
    throw new Error("no Command variant tags parsed from types.ts");
  }
  return new Set(tags);
}

/** Wire commands are externally tagged: exactly one own key is the variant name. */
export function commandVariantTag(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw new TypeError("command must be a single-key wire variant object");
  }
  const keys = Object.keys(command);
  if (keys.length !== 1) {
    throw new TypeError(
      `command must have exactly one variant key, got: ${keys.join(", ")}`,
    );
  }
  return keys[0];
}

// Lexical SQL-source guard: eventstore owns direct event-body reads. This is
// deliberately a source-text check, not a SQL parser or proof of all decoding.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProofInputPaths, proofSourceFiles } from "./proof_input_paths.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Match Rust str::split_whitespace, then to_ascii_lowercase, from the original
// eventstore integration-test guard. Comments and cfg(test) source still count.
const RUST_WHITESPACE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u;

export function containsDirectEventBodySql(source) {
  const normalized = source.split(RUST_WHITESPACE).filter(Boolean).join(" ")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return normalized.includes("select payload from events") ||
    (normalized.includes("from events") && normalized.includes("payload->"));
}

export async function inspectEventBodyAuthority(root = REPO_ROOT, { files = proofSourceFiles(root) } = {}) {
  root = path.resolve(root);
  const selector = { kind: "glob", path: "crates/*/src/**/*.rs" };
  // Use the same Git-visible inventory and path guard as proof selection and
  // caching. All candidate paths reach the guard so directory links cannot
  // conceal source files. Ignored scratch/build files are outside this contract.
  assertProofInputPaths({ root, files, selectors: [selector] });
  const scannedFiles = [];
  const violations = [];
  for (const relative of [...new Set(files)].sort()) {
    if (!path.matchesGlob(relative, selector.path) || relative.startsWith("crates/eventstore/")) continue;
    let source;
    try {
      source = await readFile(path.join(root, relative), "utf8");
    } catch (error) {
      // git ls-files retains tracked paths deleted from the working tree.
      // Fingerprinting also omits these absent inputs.
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
    scannedFiles.push(relative);
    if (containsDirectEventBodySql(source)) violations.push(relative);
  }
  return { scannedFiles, violations };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== "--root" || !argv[1])) {
    throw new Error("usage: node tools/event_body_authority.mjs [--root <repository>]");
  }
  const result = await inspectEventBodyAuthority(argv[1] ?? REPO_ROOT);
  if (result.violations.length > 0) {
    for (const filename of result.violations) {
      console.error(`repository event-body SQL-source guard: direct body read outside eventstore: ${filename}`);
    }
    return 1;
  }
  console.log(`repository event-body SQL-source guard passed (${result.scannedFiles.length} Git-visible Rust files scanned)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`repository event-body SQL-source guard: ${error.message}`);
    process.exitCode = 1;
  }
}

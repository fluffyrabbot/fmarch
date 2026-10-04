import assert from "node:assert/strict";
import path from "node:path";

function relativeReference(value, label) {
  assert.ok(
    typeof value === "string" && value.length > 0,
    `${label} is required; rerun the role-smoke producer`,
  );
  assert.ok(
    !value.includes("\0") &&
      !path.posix.isAbsolute(value) &&
      !path.win32.isAbsolute(value) &&
      !/^[A-Za-z]:/.test(value),
    `${label} must be relative`,
  );
  const reference = value.replaceAll("\\", "/");
  assert.equal(path.posix.normalize(reference), reference, `${label} must be canonical`);
  return reference;
}

// Receipt paths retain their original logical namespace. Only their suffix
// beneath the declared producer root is resolved in the materialized directory;
// no old checkout is read and no receipt or cached artifact is rewritten.
export function screenshotEvidencePaths(evidence, { artifactDir }) {
  const sourceRoot = relativeReference(evidence.artifactRoot, "role-smoke artifactRoot");
  const prefix = sourceRoot === "." ? "" : `${sourceRoot}/`;
  const currentRoot = path.resolve(artifactDir);
  const paths = new Set();
  const visit = (entry, key = "") => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
    } else if (entry !== null && typeof entry === "object") {
      for (const [childKey, child] of Object.entries(entry)) visit(child, childKey);
    } else if (
      typeof entry === "string" && /screenshot$/i.test(key) && entry.endsWith(".png")
    ) {
      const reference = relativeReference(entry, "role-smoke screenshot");
      assert.ok(reference.startsWith(prefix), "role-smoke screenshot belongs to a foreign artifact root");
      const suffix = reference.slice(prefix.length);
      assert.ok(
        suffix.length > 0 &&
          suffix.split("/").every(part => part !== ".." && part !== "." && part !== ""),
        "role-smoke screenshot escapes its artifact root",
      );
      const destination = path.resolve(currentRoot, suffix);
      const relative = path.relative(currentRoot, destination);
      assert.ok(
        relative !== "" && relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        "role-smoke screenshot escapes the materialized artifact root",
      );
      paths.add(destination);
    }
  };
  visit(evidence);
  return paths;
}

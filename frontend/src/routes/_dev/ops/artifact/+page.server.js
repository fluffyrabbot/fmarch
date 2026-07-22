import { readFile } from "node:fs/promises";
import path from "node:path";
import { error } from "@sveltejs/kit";
import { _requireDevOps } from "../+page.server.js";

export async function load({ locals, url }) {
  _requireDevOps();
  const capabilities = Array.isArray(locals.resolvedCapabilities)
    ? locals.resolvedCapabilities
    : [];
  if (
    !capabilities.some((capability) =>
      ["GlobalAdmin", "GlobalMod"].includes(capability?.kind),
    )
  ) {
    throw error(403, "Local artifact inspection requires GlobalAdmin or GlobalMod");
  }

  const artifactPath = normalizeLocalArtifactPath(url.searchParams.get("path"));
  const game = url.searchParams.get("game") ?? "midsummer";
  let contents = "";
  try {
    contents = await readFile(path.resolve(process.cwd(), artifactPath), "utf8");
  } catch {
    throw error(404, `Local artifact ${artifactPath} is not available.`);
  }

  return { artifact: { path: artifactPath, game, contents } };
}

function normalizeLocalArtifactPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw error(400, "Local artifact path is required.");
  }
  const normalized = path.posix.normalize(value.trim());
  if (
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    !normalized.startsWith("target/dev-test-game/") ||
    !normalized.endsWith(".json")
  ) {
    throw error(400, "Artifact path is outside the local proof surface.");
  }
  return normalized;
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { error } from "@sveltejs/kit";

export async function load({ locals, url }) {
  const capabilities = Array.isArray(locals.resolvedCapabilities)
    ? locals.resolvedCapabilities
    : [];
  if (!capabilities.some((capability) => capability?.kind === "GlobalAdmin")) {
    throw error(403, "Admin artifact inspection requires GlobalAdmin");
  }

  const artifactPath = normalizeDevTestGameArtifactPath(
    url.searchParams.get("path"),
  );
  const game = url.searchParams.get("game") ?? "midsummer";
  let contents = "";
  try {
    contents = await readFile(path.resolve(process.cwd(), artifactPath), "utf8");
  } catch {
    throw error(404, `Admin artifact ${artifactPath} is not available.`);
  }

  return {
    artifact: {
      path: artifactPath,
      game,
      contents,
    },
  };
}

function normalizeDevTestGameArtifactPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw error(400, "Admin artifact path is required.");
  }
  const normalized = path.posix.normalize(value.trim());
  if (
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    !normalized.startsWith("target/dev-test-game/") ||
    !normalized.endsWith(".json")
  ) {
    throw error(400, "Admin artifact path is outside the local proof surface.");
  }
  return normalized;
}

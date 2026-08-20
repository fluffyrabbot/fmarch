import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePodmanComposeArgs,
  podmanComposeCommand,
  podmanComposeEnvironment,
  podmanComposeProvider,
  repoRoot,
  requirePodmanCompose,
  runPodmanCompose,
} from "./podman_compose.mjs";

test("Podman Compose wrapper pins the podman-compose provider", () => {
  assert.equal(podmanComposeProvider, "podman-compose");
  assert.deepEqual(podmanComposeEnvironment({ PODMAN_COMPOSE_PROVIDER: "docker-compose", KEEP: "yes" }), {
    PODMAN_COMPOSE_PROVIDER: "podman-compose",
    KEEP: "yes",
  });
  assert.deepEqual(
    podmanComposeCommand(["up", "-d", "postgres"], { PODMAN_COMPOSE_PROVIDER: "docker-compose" }),
    {
      command: "podman",
      args: ["compose", "up", "-d", "postgres"],
      cwd: repoRoot,
      env: { PODMAN_COMPOSE_PROVIDER: "podman-compose" },
    },
  );
});

test("Podman Compose wrapper requires Podman and podman-compose", async () => {
  const required = [];
  await requirePodmanCompose({
    env: { PATH: "/test/bin" },
    requireExecutableFn: async (executable, { env }) => {
      required.push({ executable, env });
    },
  });
  assert.deepEqual(required, [
    { executable: "podman", env: { PATH: "/test/bin" } },
    { executable: "podman-compose", env: { PATH: "/test/bin" } },
  ]);
});

test("Podman Compose wrapper pins its provider before invoking compose", async () => {
  const invocations = [];
  await runPodmanCompose(["config"], {
    env: { PODMAN_COMPOSE_PROVIDER: "docker-compose" },
    requirePodmanComposeFn: async () => {},
    invokeCommandFn: async (command, args, options) => {
      invocations.push({ command, args, options });
    },
  });

  assert.deepEqual(invocations, [
    {
      command: "podman",
      args: ["compose", "config"],
      options: { cwd: repoRoot, env: { PODMAN_COMPOSE_PROVIDER: "podman-compose" } },
    },
  ]);
});

test("Podman Compose wrapper requires a compose command", () => {
  assert.deepEqual(parsePodmanComposeArgs(["--help"]), { help: true, args: [] });
  assert.throws(() => parsePodmanComposeArgs([]), /compose command is required/);
});

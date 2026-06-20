import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  boardScenario,
  routeStateScenarios,
  roles,
} from "./frontend_role_smoke_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-static-focusability");
const evidencePath = path.join(artifactDir, "focusability.json");
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);

await mkdir(artifactDir, { recursive: true });
await runRouteStateRenderContract();

const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);

const evidence = {
  status: "passed",
  proof: "ssr-static-focusability-contract",
  boundary:
    "Parses build-mode Svelte SSR markup without opening localhost or launching Chromium. This proves every modeled keyboard focus target owns a real enabled focusable element and every forbidden focus id is absent from the static tab order. It does not prove CSS focus-ring visibility, browser Tab traversal, pointer behavior, hydration, command dispatch, TCP transport, or WebSocket delivery.",
  surfaces: [],
  routeStates: [],
};

for (const scenario of surfaceScenarios()) {
  const rendered = await bundle[scenario.render]();
  const html = rendered.html;
  const document = parseHtml(html);
  const focusability = assertFocusability(document, {
    label: scenario.id,
    focus: scenario.focus,
  });
  evidence.surfaces.push({
    id: scenario.id,
    role: scenario.role,
    render: scenario.render,
    expectedFocusCount: scenario.focus.expectedOrder.length,
    forbiddenFocusCount: scenario.focus.forbiddenTestIds.length,
    htmlBytes: Buffer.byteLength(html),
    focusability,
  });
}

for (const scenario of routeStateScenarios) {
  const rendered = await bundle.renderScenario(scenario.role, scenario.state);
  const html = rendered.html;
  const document = parseHtml(html);
  const focusability = assertFocusability(document, {
    label: scenario.id,
    focus: scenario.focus,
  });
  evidence.routeStates.push({
    id: scenario.id,
    role: scenario.role,
    surface: scenario.surface,
    state: scenario.state,
    path: scenario.path,
    actionTestId: scenario.actionTestId,
    expectedFocusCount: scenario.focus.expectedOrder.length,
    forbiddenFocusCount: scenario.focus.forbiddenTestIds.length,
    htmlBytes: Buffer.byteLength(html),
    focusability,
  });
}

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function surfaceScenarios() {
  return [
    {
      id: "board",
      role: "board",
      render: "renderBoardPlayerSurface",
      focus: boardScenario.focus,
    },
    ...roles.map((role) => ({
      id: role.id,
      role: role.id,
      render: roleRenderFunction(role.id),
      focus: role.focus,
    })),
  ];
}

function roleRenderFunction(role) {
  if (role === "admin") {
    return "renderAdminSurface";
  }
  if (role === "player") {
    return "renderPlayerSurface";
  }
  if (role === "moderator") {
    return "renderModeratorSurface";
  }
  throw new Error(`unknown static focusability role ${role}`);
}

function assertFocusability(document, { label, focus }) {
  const expected = focus.expectedOrder.map((testId) => {
    const owner = findByTestId(document, testId);
    assert.notEqual(owner, null, `${label} expected focus id missing: ${testId}`);
    const target = firstOwnedFocusable(owner, testId);
    assert.notEqual(target, null, `${label} expected focus id is not focusable: ${testId}`);
    return {
      testId,
      ownerTag: owner.tag,
      focusableTag: target.tag,
      focusableTestId: target.attrs["data-testid"] ?? null,
      href: target.attrs.href ?? null,
      tabindex: target.attrs.tabindex ?? null,
      ownedByDescendant: target !== owner,
    };
  });

  const forbidden = focus.forbiddenTestIds.map((testId) => {
    const owner = findByTestId(document, testId);
    assert.notEqual(owner, null, `${label} forbidden focus id missing: ${testId}`);
    const target = firstOwnedFocusable(owner, testId);
    assert.equal(target, null, `${label} forbidden focus id is focusable: ${testId}`);
    return {
      testId,
      ownerTag: owner.tag,
      ariaDisabled: owner.attrs["aria-disabled"] ?? null,
      disabled: Object.hasOwn(owner.attrs, "disabled"),
    };
  });

  return {
    expected,
    forbidden,
  };
}

function firstOwnedFocusable(owner, testId) {
  for (const node of walk(owner)) {
    if (!isFocusable(node)) {
      continue;
    }
    if (closestTestId(node) === testId) {
      return node;
    }
  }
  return null;
}

function isFocusable(node) {
  if (node.attrs["aria-hidden"] === "true" || node.attrs["aria-disabled"] === "true") {
    return false;
  }
  if (Object.hasOwn(node.attrs, "disabled")) {
    return false;
  }
  if (node.attrs.tabindex !== undefined) {
    return node.attrs.tabindex !== "-1";
  }
  if (node.tag === "a") {
    return typeof node.attrs.href === "string" && node.attrs.href.length > 0;
  }
  return ["button", "input", "select", "textarea"].includes(node.tag);
}

function closestTestId(node) {
  let current = node;
  while (current !== null) {
    if (current.attrs["data-testid"] !== undefined) {
      return current.attrs["data-testid"];
    }
    current = current.parent;
  }
  return null;
}

function findByTestId(root, testId) {
  for (const node of walk(root)) {
    if (node.attrs["data-testid"] === testId) {
      return node;
    }
  }
  return null;
}

function* walk(node) {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

function parseHtml(html) {
  const root = element("root", {}, null);
  const stack = [root];
  const tagPattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/gu;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith("<!--")) {
      continue;
    }
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (full.startsWith("</")) {
      while (stack.length > 1 && stack.at(-1).tag !== tag) {
        stack.pop();
      }
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    const attrs = parseAttrs(match[2] ?? "");
    const parent = stack.at(-1);
    const node = element(tag, attrs, parent);
    parent.children.push(node);
    if (!isVoidElement(tag) && !full.endsWith("/>")) {
      stack.push(node);
    }
  }
  return root;
}

function element(tag, attrs, parent) {
  return {
    tag,
    attrs,
    parent,
    children: [],
  };
}

function parseAttrs(source) {
  const attrs = {};
  const pattern = /([:@A-Za-z_][:@A-Za-z0-9_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function isVoidElement(tag) {
  return new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]).has(tag);
}

async function runRouteStateRenderContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/frontend_route_state_render_contract.mjs"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend route-state render contract failed with exit ${code}`);
  }
}

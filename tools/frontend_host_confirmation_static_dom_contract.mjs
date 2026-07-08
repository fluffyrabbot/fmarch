import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODERATOR_CRITICAL_ACTION_IDS } from "./frontend_proof_expectations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(
  repoRoot,
  "target",
  "frontend-host-confirmation-static-dom",
);
const evidencePath = path.join(artifactDir, "static-dom.json");
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
const manifest = await bundle.renderModeratorCriticalActionManifest();

const evidence = {
  status: "passed",
  proof: "host-confirmation-static-dom-contract",
  boundary:
    "Parses build-mode Svelte SSR for every moderator critical host action with its confirmation already open. This proves each deadline, replacement, phase/thread lock, votecount, host-prompt, slot-lifecycle, and role-reveal action owns exactly one alertdialog confirmation with confirm/cancel controls, DOM-visible message text naming the affected object and outcome, initial-focus/return-focus/Escape/tab-containment metadata, and shared 44px touch-control classes. It does not prove browser focus movement, Tab trapping, Escape handling, pointer delivery, command dispatch, TCP transport, WebSocket delivery, or localhost-backed app acceptance.",
  generatedFrom: {
    routeStateRender: "target/frontend-route-state-render/route-state-render.json",
    routeStateBundle: "target/frontend-route-state-render/bundle/entry.js",
  },
  game: manifest.game,
  actionCount: manifest.actionCount,
  actions: [],
};

assert.deepEqual(
  manifest.actions.map((action) => action.id),
  [...MODERATOR_CRITICAL_ACTION_IDS],
);

for (const action of manifest.actions) {
  const rendered = await bundle.renderModeratorActionConfirmation(action.id);
  evidence.actions.push(assertHostActionConfirmation({
    action,
    html: rendered.html,
  }));
}

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function assertHostActionConfirmation({ action, html }) {
  const document = parseHtml(html);
  const root = exactlyOne(
    document,
    "data-component",
    "host-action",
    `${action.id} host action root`,
  );
  assert.equal(root.attrs.role, "group");
  assert.equal(root.attrs["data-action-id"], action.id);

  const trigger = exactlyOne(
    root,
    "data-testid",
    "critical-host-action-trigger",
    `${action.id} trigger`,
  );
  assert.equal(trigger.tag, "button");
  assert.equal(trigger.attrs["aria-expanded"], "true");
  assert.equal(
    trigger.attrs["data-danger"],
    String(action.irreversible === true),
  );
  assertTouchControl(trigger, `${action.id} trigger`);

  const confirmation = exactlyOne(
    root,
    "data-testid",
    "critical-host-action-confirmation",
    `${action.id} confirmation`,
  );
  assert.equal(confirmation.attrs.role, "alertdialog");
  assert.equal(confirmation.attrs["aria-modal"], "true");
  assert.equal(
    confirmation.attrs["data-initial-focus-testid"],
    "critical-host-action-confirm",
  );
  assert.equal(
    confirmation.attrs["data-return-focus-testid"],
    "critical-host-action-trigger",
  );
  assert.equal(confirmation.attrs["data-escape-cancels"], "true");
  assert.equal(confirmation.attrs["data-tab-containment"], "confirm-cancel");

  const message = exactlyOne(
    confirmation,
    "data-testid",
    "critical-host-action-confirmation-message",
    `${action.id} confirmation message`,
  );
  const messageText = normalizeText(textContent(message));
  assert.equal(message.attrs.id, `host-action-confirmation-message-${action.id}`);
  assert.equal(
    confirmation.attrs["aria-describedby"],
    message.attrs.id,
  );
  assertIncludes(messageText, action.objectLabel, `${action.id} object label`);
  assertIncludes(messageText, action.outcomeLabel, `${action.id} outcome label`);
  assert.equal(messageText, normalizeText(action.confirmationText));

  const confirm = exactlyOne(
    confirmation,
    "data-testid",
    "critical-host-action-confirm",
    `${action.id} confirm`,
  );
  const cancel = exactlyOne(
    confirmation,
    "data-testid",
    "critical-host-action-cancel",
    `${action.id} cancel`,
  );
  assert.equal(confirm.tag, "button");
  assert.equal(cancel.tag, "button");
  assert.equal(isFocusable(confirm), true);
  assert.equal(isFocusable(cancel), true);
  assertTouchControl(confirm, `${action.id} confirm`);
  assertTouchControl(cancel, `${action.id} cancel`);

  const allConfirmButtons = [...walk(confirmation)].filter(
    (node) => node.attrs["data-testid"] === "critical-host-action-confirm",
  );
  const allCancelButtons = [...walk(confirmation)].filter(
    (node) => node.attrs["data-testid"] === "critical-host-action-cancel",
  );
  assert.equal(allConfirmButtons.length, 1);
  assert.equal(allCancelButtons.length, 1);

  return {
    id: action.id,
    payloadKind: action.payloadKind,
    label: action.label,
    objectLabel: action.objectLabel,
    outcomeLabel: action.outcomeLabel,
    htmlBytes: Buffer.byteLength(html),
    root: {
      role: root.attrs.role,
      component: root.attrs["data-component"],
      actionId: root.attrs["data-action-id"],
    },
    confirmation: {
      role: confirmation.attrs.role,
      ariaModal: confirmation.attrs["aria-modal"],
      ariaDescribedBy: confirmation.attrs["aria-describedby"],
      messageId: message.attrs.id,
      initialFocusTestId: confirmation.attrs["data-initial-focus-testid"],
      returnFocusTestId: confirmation.attrs["data-return-focus-testid"],
      escapeCancels: confirmation.attrs["data-escape-cancels"],
      tabContainment: confirmation.attrs["data-tab-containment"],
    },
    controls: [
      summarizeControl(trigger),
      summarizeControl(confirm),
      summarizeControl(cancel),
    ],
    messageText,
  };
}

function summarizeControl(node) {
  return {
    tag: node.tag,
    testId: node.attrs["data-testid"],
    className: node.attrs.class ?? "",
    touchControl: (node.attrs.class ?? "").split(/\s+/u).includes("touch-control"),
    focusable: isFocusable(node),
  };
}

function assertTouchControl(node, label) {
  assert.equal(
    (node.attrs.class ?? "").split(/\s+/u).includes("touch-control"),
    true,
    `${label} missing touch-control class`,
  );
}

function exactlyOne(root, attr, value, label) {
  const matches = [...walk(root)].filter((node) => node.attrs[attr] === value);
  assert.equal(matches.length, 1, `${label} expected one ${attr}=${value}, found ${matches.length}`);
  return matches[0];
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

function textContent(node) {
  return [
    node.text,
    ...node.children.map((child) => textContent(child)),
  ].join("");
}

function normalizeText(value) {
  return String(value).trim().replace(/\s+/gu, " ");
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
  let lastIndex = 0;
  while ((match = tagPattern.exec(html)) !== null) {
    const between = html.slice(lastIndex, match.index);
    if (between.length > 0) {
      stack.at(-1).text += decodeHtml(between);
    }
    lastIndex = tagPattern.lastIndex;

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
  const tail = html.slice(lastIndex);
  if (tail.length > 0) {
    stack.at(-1).text += decodeHtml(tail);
  }
  return root;
}

function element(tag, attrs, parent) {
  return {
    tag,
    attrs,
    parent,
    text: "",
    children: [],
  };
}

function parseAttrs(source) {
  const attrs = {};
  const attrPattern = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/gu;
  let match;
  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function isVoidElement(tag) {
  return [
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
  ].includes(tag);
}

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#34;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function assertIncludes(haystack, needle, label) {
  assert.equal(
    haystack.includes(needle),
    true,
    `${label} missing ${needle}`,
  );
}

async function runRouteStateRenderContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_route_state_render_contract.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend route-state render contract failed with exit ${code}`);
  }
}

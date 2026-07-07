import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-static-dom",
);
const evidencePath = path.join(artifactDir, "static-dom.json");
const manifestPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "interaction-page-manifest.json",
);
const pagePath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "interaction-page.html",
);

await mkdir(artifactDir, { recursive: true });
await runInteractionPageContract();

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const pageHtml = await readFile(pagePath, "utf8");
const document = parseHtml(pageHtml);

assert.equal(manifest.status, "page-generated");
assert.equal(manifest.proof, "in-app-browser-file-interaction-page");
assertIncludes(pageHtml, "window.__fmarchIabProof", "fixture click recorder");
assertIncludes(pageHtml, "data-testid=\"iab-proof-page\"", "fixture proof root");

const evidence = {
  status: "passed",
  proof: "in-app-browser-static-dom-contract",
  boundary:
    "Parses the generated file-backed in-app browser fixture HTML without opening localhost or launching Chromium. This proves every manifest command/error scenario owns exactly one target inside its scenario root, all 11 moderator critical host confirmation scenarios carry DOM-visible object/outcome text and alertdialog focus metadata, modeled route evidence is present for the player role-PM scenario, modeled error-surface evidence is present for the player private-channel 403, hydrated-surface controls exist inside their scenario roots, touch-floor metadata is present where the rendered control models it, and player private fixture markup excludes host-only copy. It does not prove CSS layout pixels, browser click delivery, focus landing, Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, or localhost-backed app acceptance.",
  generatedFrom: {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    page: "target/frontend-in-app-browser-interactions/interaction-page.html",
  },
  pageBytes: Buffer.byteLength(pageHtml),
  scenarioCount: manifest.scenarios.length,
  hydratedScenarioCount: manifest.hydratedSurfaceScenarios.length,
  stabilityChecks: [],
  scenarios: [],
  hydratedSurfaceScenarios: [],
  forbidden: [],
};

for (const scenario of manifest.scenarios) {
  evidence.scenarios.push(assertCommandScenario(document, scenario));
}

for (const scenario of manifest.hydratedSurfaceScenarios) {
  evidence.hydratedSurfaceScenarios.push(assertHydratedSurfaceScenario(
    document,
    scenario,
  ));
}

for (const check of manifest.stabilityChecks ?? []) {
  evidence.stabilityChecks.push(assertStabilityCheck(document, check));
}

evidence.forbidden.push(assertForbiddenStrings(
  textContent(exactlyOne(
    document,
    "data-iab-scenario-id",
    "player-private-channel-submit-post-click",
    "player private channel fixture root",
  )),
  {
    label: "file-backed player private-channel fixture",
    strings: ["host prompt", "moderator", "resolve_host_prompt"],
  },
));

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function assertCommandScenario(document, scenario) {
  const root = exactlyOne(
    document,
    "data-iab-scenario-id",
    scenario.id,
    `${scenario.id} scenario root`,
  );
  assert.equal(root.attrs["data-iab-role"], scenario.role);

  const target = exactlyOneSelector(root, scenario.targetSelector, {
    label: `${scenario.id} target`,
  });
  if (scenario.targetTestId !== undefined) {
    assert.equal(target.attrs["data-testid"], scenario.targetTestId);
  }
  if (scenario.targetAction !== undefined) {
    assert.equal(target.attrs["data-action"], scenario.targetAction);
  }
  assert.equal(isFocusable(target), true, `${scenario.id} target is not focusable`);
  assertIncludes(
    textContent(root),
    scenario.expectedText,
    `${scenario.id} expected text`,
  );

  return {
    id: scenario.id,
    role: scenario.role,
    render: scenario.render,
    renderArgs: scenario.renderArgs,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    target: summarizeTarget(target),
    touchFloor: assertTouchFloor(target, scenario),
    confirmation: scenario.confirmation === undefined
      ? undefined
      : assertConfirmationEvidence(root, scenario),
    route: scenario.route === undefined
      ? undefined
      : assertRouteEvidence(root, scenario),
    errorSurface: scenario.errorSurface === undefined
      ? undefined
      : assertErrorSurfaceEvidence(root, scenario),
  };
}

function assertErrorSurfaceEvidence(root, scenario) {
  const surface = exactlyOne(
    root,
    "data-testid",
    scenario.errorSurface.surfaceTestId,
    `${scenario.id} error surface`,
  );
  assert.equal(surface.attrs["data-status"], String(scenario.errorSurface.status));
  const panel = exactlyOne(
    root,
    "data-testid",
    scenario.errorSurface.panelTestId,
    `${scenario.id} error panel`,
  );
  const action = exactlyOne(
    root,
    "data-testid",
    scenario.targetTestId,
    `${scenario.id} error action`,
  );
  assert.equal(action.attrs.href, scenario.errorSurface.actionHref);
  const activeNav = exactlyOne(
    root,
    "data-testid",
    scenario.errorSurface.activeNavTestId,
    `${scenario.id} active nav`,
  );
  assert.equal(activeNav.attrs["aria-current"], "page");
  assertIncludes(textContent(panel), scenario.errorSurface.path, `${scenario.id} path`);
  assertIncludes(
    textContent(root),
    scenario.errorSurface.sessionPrincipal,
    `${scenario.id} principal`,
  );
  assertIncludes(
    textContent(root),
    scenario.errorSurface.capabilitySummary,
    `${scenario.id} capabilities`,
  );
  return {
    path: scenario.errorSurface.path,
    status: scenario.errorSurface.status,
    surfaceTestId: scenario.errorSurface.surfaceTestId,
    panelTestId: scenario.errorSurface.panelTestId,
    actionHref: action.attrs.href,
    activeNavTestId: scenario.errorSurface.activeNavTestId,
    activeNavCurrent: activeNav.attrs["aria-current"],
    sessionPrincipal: scenario.errorSurface.sessionPrincipal,
    capabilitySummary: scenario.errorSurface.capabilitySummary,
  };
}

function assertConfirmationEvidence(root, scenario) {
  const hostAction = exactlyOne(
    root,
    "data-action-id",
    scenario.confirmation.actionId,
    `${scenario.id} host action root`,
  );
  assert.equal(hostAction.attrs["data-component"], "host-action");

  const confirmation = exactlyOne(
    root,
    "data-testid",
    "critical-host-action-confirmation",
    `${scenario.id} confirmation`,
  );
  assert.equal(confirmation.attrs.role, "alertdialog");
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
  assertIncludes(
    textContent(confirmation),
    scenario.confirmation.objectLabel,
    `${scenario.id} confirmation object label`,
  );
  assertIncludes(
    textContent(confirmation),
    scenario.confirmation.outcomeLabel,
    `${scenario.id} confirmation outcome label`,
  );
  return {
    actionId: scenario.confirmation.actionId,
    payloadKind: scenario.confirmation.payloadKind,
    objectLabel: scenario.confirmation.objectLabel,
    outcomeLabel: scenario.confirmation.outcomeLabel,
    role: confirmation.attrs.role,
    initialFocusTestId: confirmation.attrs["data-initial-focus-testid"],
    returnFocusTestId: confirmation.attrs["data-return-focus-testid"],
    escapeCancels: confirmation.attrs["data-escape-cancels"],
    tabContainment: confirmation.attrs["data-tab-containment"],
  };
}

function assertHydratedSurfaceScenario(document, scenario) {
  const root = exactlyOne(
    document,
    "data-iab-hydrated-scenario-id",
    scenario.id,
    `${scenario.id} hydrated scenario root`,
  );
  assert.equal(root.attrs["data-iab-role"], scenario.role);

  const controls = (scenario.controls ?? []).map((control) => {
    const target = exactlyOne(
      root,
      "data-testid",
      control.testId,
      `${scenario.id} hydrated control ${control.testId}`,
    );
    if (control.href !== undefined) {
      assert.equal(target.attrs.href, control.href);
    }
    if (control.expectedText !== undefined) {
      assertIncludes(
        textContent(target),
        control.expectedText,
        `${scenario.id} ${control.testId} text`,
      );
    }
    if (control.expectedDisabled === true) {
      assert.equal(
        Object.hasOwn(target.attrs, "disabled"),
        true,
        `${scenario.id} ${control.testId} disabled`,
      );
      assert.equal(target.attrs["aria-disabled"], "true");
    }
    if (control.expectedStatusState !== undefined) {
      assert.equal(
        target.attrs["data-thread-page-status"],
        control.expectedStatusState,
        `${scenario.id} ${control.testId} status state`,
      );
    }
    return {
      testId: control.testId,
      kind: control.kind,
      tag: target.tag,
      href: target.attrs.href ?? null,
      focusable: isFocusable(target),
      touchFloor: target.attrs["data-min-touch-target-px"] ?? null,
      disabled: Object.hasOwn(target.attrs, "disabled"),
      statusState: target.attrs["data-thread-page-status"] ?? null,
    };
  });

  if (scenario.id === "player-private-disclosure-vote-and-post") {
    const detail = exactlyOne(
      root,
      "data-testid",
      "iab-player-private-detail",
      "player private detail",
    );
    assert.equal(Object.hasOwn(detail.attrs, "hidden"), true);
    assertExcludesLower(
      textContent(root),
      "resolve_host_prompt",
      "player private hydrated fixture",
    );
    const pending = exactlyOne(
      root,
      "data-testid",
      "iab-player-thread-pager-pending",
      "player thread pending pager control",
    );
    assert.equal(Object.hasOwn(pending.attrs, "disabled"), true);
    assert.equal(pending.attrs["aria-disabled"], "true");
    assert.equal(pending.attrs["aria-busy"], "true");
    assert.equal(pending.attrs["data-thread-pager-state"], "pending");

    for (const [testId, state] of [
      ["iab-player-thread-page-ack-status", "ack"],
      ["iab-player-thread-page-reject-status", "reject"],
      ["iab-player-thread-page-status", "pending"],
    ]) {
      const status = exactlyOne(root, "data-testid", testId, testId);
      assert.equal(status.attrs.role, "status");
      assert.equal(status.attrs["aria-live"], "polite");
      assert.equal(status.attrs["data-state"], state);
      assert.equal(textContent(status).trim().length > 0, true);
    }
  }

  return {
    id: scenario.id,
    role: scenario.role,
    source: scenario.source,
    ...(scenario.id === "player-private-disclosure-vote-and-post"
      ? {
          threadPager: {
            pendingDisabled: controls.some(
              (control) =>
                control.testId === "iab-player-thread-pager-pending" &&
                control.disabled === true &&
                control.focusable === false,
            ),
            statusStates: controls
              .filter((control) => control.testId.includes("thread-pager-"))
              .map((control) => control.statusState)
              .filter((state) => state !== null),
            liveRegionTestIds: [
              "iab-player-thread-page-ack-status",
              "iab-player-thread-page-reject-status",
              "iab-player-thread-page-status",
            ],
          },
        }
      : {}),
    controls,
  };
}

function assertStabilityCheck(document, check) {
  const root = exactlyOneSelector(document, check.rootSelector, {
    label: `${check.id} root`,
  });
  const tiles = check.tiles.map((tile) => {
    const tileRoot = exactlyOneSelector(root, tile.tileSelector, {
      label: `${check.id} ${tile.id} tile`,
    });
    const trigger = exactlyOneSelector(tileRoot, tile.triggerSelector, {
      label: `${check.id} ${tile.id} trigger`,
    });
    const floor = exactlyOneSelector(tileRoot, tile.statusFloorSelector, {
      label: `${check.id} ${tile.id} status floor`,
    });
    assert.equal(
      Number(floor.attrs["data-status-floor-min-px"]),
      check.statusFloorMinBlockSizePx,
      `${check.id} ${tile.id} status floor metadata`,
    );
    assert.equal(
      documentOrderIndex(tileRoot, trigger) < documentOrderIndex(tileRoot, floor),
      true,
      `${check.id} ${tile.id} trigger should precede status floor`,
    );
    return {
      id: tile.id,
      tileSelector: tile.tileSelector,
      triggerSelector: tile.triggerSelector,
      statusFloorSelector: tile.statusFloorSelector,
      statusFloorMinBlockSizePx: Number(floor.attrs["data-status-floor-min-px"]),
      triggerPrecedesStatusFloor: true,
    };
  });
  return {
    id: check.id,
    role: check.role,
    surfaceId: check.surfaceId,
    mode: check.mode,
    statusFloorMinBlockSizePx: check.statusFloorMinBlockSizePx,
    tileCount: tiles.length,
    tiles,
  };
}

function assertRouteEvidence(root, scenario) {
  const activeChannel = exactlyOne(
    root,
    "data-testid",
    scenario.route.activeChannelTestId,
    `${scenario.id} active channel`,
  );
  assert.equal(activeChannel.attrs.href, scenario.route.activeChannelHref);
  assert.equal(activeChannel.attrs["aria-current"], "page");
  assert.equal(activeChannel.attrs["data-min-touch-target-px"], "44");

  const privateReview = exactlyOneSelector(root, `a[href="${scenario.route.privateReviewHref}"]`, {
    label: `${scenario.id} private review href`,
  });
  assert.equal(privateReview.attrs["data-min-touch-target-px"], "44");

  for (const forbidden of ["host prompt", "moderator", "resolve_host_prompt"]) {
    assertExcludesLower(textContent(root), forbidden, `${scenario.id} route body`);
  }

  return {
    path: scenario.route.path,
    activeChannelTestId: scenario.route.activeChannelTestId,
    activeChannelHref: activeChannel.attrs.href,
    activeChannelCurrent: activeChannel.attrs["aria-current"],
    privateReviewHref: privateReview.attrs.href,
  };
}

function assertTouchFloor(target, scenario) {
  const metadata = target.attrs["data-min-touch-target-px"];
  if (metadata !== undefined) {
    assert.equal(metadata, String(scenario.minTouchTargetPx));
    return {
      mode: "data-min-touch-target-px",
      value: Number(metadata),
    };
  }
  const className = target.attrs.class ?? "";
  assert.equal(
    className.includes("touch-control") || className.includes("fm-touch-button"),
    true,
    `${scenario.id} target lacks modeled touch metadata or shared touch class`,
  );
  return {
    mode: className.includes("touch-control") ? "touch-control-class" : "touch-button-class",
    value: scenario.minTouchTargetPx,
  };
}

function assertForbiddenStrings(html, { label, strings }) {
  for (const forbidden of strings) {
    assertExcludesLower(html, forbidden, label);
  }
  return {
    label,
    strings,
    present: false,
  };
}

function summarizeTarget(target) {
  return {
    tag: target.tag,
    testId: target.attrs["data-testid"] ?? null,
    action: target.attrs["data-action"] ?? null,
    href: target.attrs.href ?? null,
    type: target.attrs.type ?? null,
  };
}

function exactlyOneSelector(root, selector, { label }) {
  const parsed = parseSimpleSelector(selector);
  const matches = [...walk(root)].filter((node) => {
    if (parsed.tag !== null && node.tag !== parsed.tag) {
      return false;
    }
    return node.attrs[parsed.attr] === parsed.value;
  });
  assert.equal(matches.length, 1, `${label} expected one ${selector}, found ${matches.length}`);
  return matches[0];
}

function exactlyOne(root, attr, value, label) {
  const matches = [...walk(root)].filter((node) => node.attrs[attr] === value);
  assert.equal(matches.length, 1, `${label} expected one ${attr}=${value}, found ${matches.length}`);
  return matches[0];
}

function parseSimpleSelector(selector) {
  const match = selector.match(/^(?:(?<tag>[a-z][a-z0-9-]*)?)\[(?<attr>[a-zA-Z0-9:_-]+)="(?<value>[^"]*)"\]$/u);
  assert.notEqual(match, null, `unsupported selector ${selector}`);
  return {
    tag: match.groups.tag ?? null,
    attr: match.groups.attr,
    value: decodeHtml(match.groups.value),
  };
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

function* walk(node) {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

function documentOrderIndex(root, target) {
  return [...walk(root)].indexOf(target);
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

function assertExcludesLower(haystack, needle, label) {
  assert.equal(
    haystack.toLowerCase().includes(needle.toLowerCase()),
    false,
    `${label} leaked ${needle}`,
  );
}

async function runInteractionPageContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_in_app_browser_interaction_page.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend in-app interaction page failed with exit ${code}`);
  }
}

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { captureScreenshotEvidence } from "./frontend_screenshot_pixels.mjs";
import { roleNavTestId } from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";
import {
  boardScenario,
  forbiddenRoutes,
  hostSetupScenario,
  navFocusCoverage,
  routeStateScenarios,
  roles,
  setupViewports,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "frontend-role-smoke");
const evidencePath = path.join(artifactDir, "role-smoke.json");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const MEDIA_FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABYsCBbpn0ZQAAAAASUVORK5CYII=",
  "base64",
);
const PLAYER_MEDIA_ALLOWED_VARIANTS = Object.freeze([
  "tablet",
  "small",
  "thumb",
  "thumbnail",
]);

const previousFixtureEnv = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
await preflightLocalhostBindOrExit({
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "frontend-role-smoke",
});
process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
process.chdir(frontendRoot);

let viteServer;
let browser;

try {
  await mkdir(artifactDir, { recursive: true });
  const { createServer: createViteServer } = await import(
    frontendRequire.resolve("vite")
  );
  viteServer = await createViteServer({
    root: frontendRoot,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
    logLevel: "error",
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit role smoke server did not expose a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch();
  const evidence = {
    status: "passed",
    baseUrl,
    viewports,
    navFocusCoverage: {
      boundary:
        "Browser smoke compares real Chromium focus traversal against this shared scenario nav/focus matrix.",
      surfaces: navFocusCoverage.surfaces,
    },
    board: [],
    roles: [],
    setup: [],
    forbidden: [],
    playerPrivateChannel: [],
    routeStates: [],
  };

  for (const viewport of viewports) {
    const boardContext = await newContextForViewport(viewport, boardScenario.token);
    const boardPage = await boardContext.newPage();
    const boardResponse = await boardPage.goto(`${baseUrl}${boardScenario.path}`, {
      waitUntil: "networkidle",
    });
    if (!boardResponse?.ok()) {
      throw new Error(
        `${boardScenario.id} ${viewport.name} returned ${boardResponse?.status()} for ${boardScenario.path}`,
      );
    }
    await boardPage.getByTestId(boardScenario.surfaceTestId).waitFor({
      state: "visible",
    });
    const boardText = await boardPage.textContent("body");
    if (!boardText?.includes(boardScenario.requiredText)) {
      throw new Error(
        `${boardScenario.id} ${viewport.name} did not render ${boardScenario.requiredText}`,
      );
    }
    const boardSurface = {
      label: `${boardScenario.id} surface`,
      box: await assertVisibleBox(
        boardPage.getByTestId(boardScenario.surfaceTestId),
        `${boardScenario.id} surface`,
      ),
    };
    const boardNavTargets = await assertRoleNav(boardPage, boardScenario.nav);
    const boardActionTargets = [];
    for (const action of boardScenario.actions) {
      const locator = boardPage.getByTestId(action.testId);
      boardActionTargets.push({
        label: `${boardScenario.id} ${action.testId}`,
        box: await assertNavigationAffordance(locator, {
          label: `${boardScenario.id} ${action.testId}`,
          navigation: action.navigation,
          hrefPath: action.hrefPath,
          baseUrl,
        }),
      });
    }
    await assertNoObviousOverlap(
      [boardSurface, ...boardNavTargets, ...boardActionTargets],
      {
        role: boardScenario.id,
        viewport: viewport.name,
      },
    );
    const boardFocusTraversal = await assertFocusTraversal(boardPage, {
      label: `${boardScenario.id} ${viewport.name}`,
      ...boardScenario.focus,
    });
    const boardScreenshot = path.join(
      artifactDir,
      `${viewport.name}-${boardScenario.id}.png`,
    );
    const boardScreenshotPixels = await captureScreenshotEvidence(boardPage, {
      path: boardScreenshot,
      label: `${boardScenario.id} ${viewport.name}`,
      viewport,
    });
    evidence.board.push({
      scenario: boardScenario.id,
      viewport,
      path: boardScenario.path,
      navigation: boardScenario.nav,
      actions: boardScenario.actions.map((action) => ({
        testId: action.testId,
        navigation: action.navigation,
      })),
      focusTraversal: boardFocusTraversal,
      overlapCheckedTargets:
        1 + boardNavTargets.length + boardActionTargets.length,
      screenshot: path.relative(repoRoot, boardScreenshot),
      screenshotPixels: boardScreenshotPixels,
    });
    await boardContext.close();

    for (const role of roles) {
      const context = await newContextForViewport(viewport, role.token);
      const page = await context.newPage();
      const playerMediaRequests =
        role.id === "player" ? await installPlayerMediaNetworkHarness(page) : null;
      if (role.id === "player") {
        await installLiveProjectionHarness(page);
      }
      const commandRequests = [];
      const hostSlotState = {
        status: "alive",
        alive: true,
      };
      let hostPromptPending = true;
      await page.route("**/commands", async (route) => {
        const commandEnvelope = route.request().postDataJSON();
        const command = commandEnvelope?.body?.body?.command;
        commandRequests.push(command);
        if (command?.ResolveHostPrompt !== undefined) {
          hostPromptPending = false;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              v: 1,
              id: commandEnvelope.id,
              body: {
                kind: "Ack",
                body: {
                  stream_seqs: [91],
                },
              },
            }),
          });
          return;
        }
        if (command?.SetSlotStatus !== undefined) {
          hostSlotState.status = command.SetSlotStatus.status;
          hostSlotState.alive = command.SetSlotStatus.status === "alive";
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              v: 1,
              id: commandEnvelope.id,
              body: {
                kind: "Ack",
                body: {
                  stream_seqs: [73],
                },
              },
            }),
          });
          return;
        }
        if (command?.SubmitPost !== undefined) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              v: 1,
              id: commandEnvelope.id,
              body: {
                kind: "Ack",
                body: {
                  stream_seqs: [72],
                },
              },
            }),
          });
          return;
        }

        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            v: 1,
            id: 1,
            body: {
              kind: "Reject",
              body: {
                error: "StreamConflict",
                retryable: true,
                message: "reload and retry",
              },
            },
          }),
        });
      });
      await page.route("**/games/*/thread?*", async (route) => {
        if (route.request().url().includes("before_seq=")) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            next_before_seq: 440,
            posts: [
              {
                source_seq: 445,
                stream_seq: 92,
                author_slot: "slot-7",
                author_user: "Mira",
                body: "Browser smoke refreshed player post.",
                occurred_at: 1781938800,
                media: [
                  {
                    id: "browser-refresh-445",
                    kind: "image",
                    alt: "Browser refreshed post receipt",
                    variants: {
                      tablet: {
                        url: "/media/midsummer/thread/browser-refresh-445-tablet.jpg",
                        width: 960,
                        height: 720,
                      },
                      small: {
                        url: "/media/midsummer/thread/browser-refresh-445-small.jpg",
                        width: 480,
                        height: 360,
                      },
                      original: {
                        url: "/media/midsummer/thread/browser-refresh-445-original.jpg",
                        width: 4000,
                        height: 3000,
                      },
                    },
                  },
                ],
              },
              {
                source_seq: 444,
                stream_seq: 91,
                author_slot: "host",
                author_user: "Host",
                body: "Official votecount for D01\n- slot_2: 1",
                occurred_at: 1781935200,
              },
            ],
          }),
        });
      });
      await page.route(/\/games\/[^/]+\/votecount(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              target: "slot-2 / Ilya",
              count: 3,
              needed: 5,
            },
          ]),
        });
      });
      await page.route(/\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      });
      await page.route(/\/games\/[^/]+\/player-command-state(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            game: "midsummer",
            actor_slot: "slot-7",
            actor_alive: true,
            actor_status: "alive",
            phase: {
              phase_id: "D01",
              phase_kind: "Day",
              phase_number: 1,
              locked: false,
            },
            actions: [],
            vote_targets: [],
          }),
        });
      });
      await page.route(/\/games\/[^/]+\/host-console-state(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            phase: {
              phase_id: "D01",
              locked: false,
              deadline: 1782000000,
            },
            slots: [
              {
                slot_id: "slot-7",
                occupant_user_id: "player-mira",
                status: hostSlotState.status,
                alive: hostSlotState.alive,
              },
            ],
            thread_posts: [
              {
                author_slot: "slot-7",
              },
            ],
          }),
        });
      });
      await page.route(/\/games\/[^/]+\/host-prompts(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(hostPromptPending
            ? [
                {
                  id: "D01:skip_next_day:slot_1",
                  label: "skip_next_day",
                  status: "pending",
                  decisionKind: "acknowledge",
                },
              ]
            : []),
        });
      });
      await page.route("**/games/*/thread?*before_seq=*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            next_before_seq: null,
            posts: [
              {
                source_seq: 440,
                stream_seq: 88,
                author_slot: "slot-3",
                author_user: "Tamsin",
                body: "Older context for the live thread.",
                occurred_at: 1781924400,
              },
            ],
          }),
        });
      });

      const response = await page.goto(`${baseUrl}${role.path}`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok()) {
        throw new Error(
          `${role.id} ${viewport.name} returned ${response?.status()} for ${role.path}`,
        );
      }

      const surface = page.getByTestId(role.surfaceTestId);
      await surface.waitFor({ state: "visible" });
      const bodyText = await page.textContent("body");
      if (!bodyText?.includes(role.requiredText)) {
        throw new Error(`${role.id} ${viewport.name} did not render ${role.requiredText}`);
      }

      await assertVisibleBox(surface, `${role.id} surface`);
      await assertVisibleBox(
        page.getByTestId(role.capabilityTestId),
        `${role.id} capability`,
      );
      const liveStatusRegion =
        role.statusTestId === undefined
          ? null
          : await assertStatusLiveRegion(page.getByTestId(role.statusTestId), {
              label: `${role.id} live status`,
            });
      const statusRegions = [];
      for (const statusRegion of role.statusRegions ?? []) {
        statusRegions.push({
          testId: statusRegion.testId,
          ...(await assertStatusLiveRegion(page.getByTestId(statusRegion.testId), {
            label: `${role.id} ${statusRegion.testId}`,
            expectedState: statusRegion.state,
          })),
        });
      }
      for (const testId of role.visibleTestIds ?? []) {
        await assertVisibleBox(
          page.getByTestId(testId),
          `${role.id} ${testId}`,
        );
      }
      const overlapVisibleTargets = [];
      for (const testId of role.overlapTestIds ?? []) {
        overlapVisibleTargets.push({
          label: `${role.id} ${testId}`,
          box: await assertVisibleBox(
            page.getByTestId(testId),
            `${role.id} ${testId}`,
          ),
        });
      }
      const touchTargets = [];
      for (const selector of role.touchSelectors) {
        touchTargets.push({
          label: `${role.id} ${selector}`,
          box: await assertHitTarget(
            page.locator(selector).first(),
            `${role.id} ${selector}`,
          ),
        });
      }
      const thumbZones = await assertThumbZones(page, role, { viewport });
      const linkAffordances = [];
      for (const link of role.linkAffordances ?? []) {
        linkAffordances.push({
          testId: link.testId,
          hrefPath: link.hrefPath,
          searchParams: link.searchParams ?? null,
          box: await assertNavigationAffordance(page.getByTestId(link.testId), {
            label: `${role.id} ${link.testId}`,
            navigation: "link",
            hrefPath: link.hrefPath,
            searchParams: link.searchParams,
            baseUrl,
          }),
        });
      }
      const navTargets = await assertRoleNav(page, role.nav);
      await assertNoObviousOverlap(
        [
          ...navTargets,
          ...overlapVisibleTargets,
          ...touchTargets,
          ...thumbZones.targets,
          ...linkAffordances,
        ],
        {
          role: role.id,
          viewport: viewport.name,
        },
      );
      const focusTraversal = await assertFocusTraversal(page, {
        label: `${role.id} ${viewport.name}`,
        ...role.focus,
      });

      let commandResult = null;
      if (role.id === "admin") {
        commandResult = await driveAdminReject(page);
      }
      if (role.id === "player") {
        commandResult = await drivePlayerReject(page, {
          viewport,
          baseUrl,
          commandRequests,
          mediaRequests: playerMediaRequests,
        });
      }
      if (role.id === "moderator") {
        commandResult = await driveModeratorReject(page, { commandRequests });
      }

      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-${role.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${role.id} ${viewport.name}`,
        viewport,
      });
      const capability = await page.getByTestId(role.capabilityTestId).innerText();
      const linkClickProofs = [];
      if (role.id === "admin") {
        linkClickProofs.push(
          await driveAdminAuditDetailClick(page, { viewport, baseUrl }),
        );
      }
      if (role.id === "moderator" && evidence.phaseContrast === undefined) {
        evidence.phaseContrast = await provePhaseGroundContrast(page);
      }

      evidence.roles.push({
        role: role.id,
        viewport,
        path: role.path,
        capability,
        liveStatusRegion,
        statusRegions,
        focusTraversal,
        commandResult,
        linkAffordances: linkAffordances.map((link) => ({
          testId: link.testId,
          hrefPath: link.hrefPath,
          searchParams: link.searchParams,
        })),
        linkClickProofs,
        overlapCheckedTargets:
          navTargets.length +
          overlapVisibleTargets.length +
          touchTargets.length +
          thumbZones.targets.length +
          linkAffordances.length,
        overlapVisibleTargets: overlapVisibleTargets.map((target) => target.label),
        thumbZones: thumbZones.zones,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await context.close();
    }

    const playerRole = roles.find((role) => role.id === "player");
    if (playerRole === undefined) {
      throw new Error("player role smoke scenario missing");
    }
    const privateChannelContext = await newContextForViewport(
      viewport,
      playerRole.token,
    );
    const privateChannelPage = await privateChannelContext.newPage();
    const privateChannelMediaRequests =
      await installPlayerMediaNetworkHarness(privateChannelPage);
    const privateChannelCommandRequests = [];
    await installPrivateChannelBrowserRoutes(privateChannelPage, {
      commandRequests: privateChannelCommandRequests,
    });
    const privateChannelPath = "/g/midsummer/c/role-pm";
    const privateChannelResponse = await privateChannelPage.goto(
      `${baseUrl}${privateChannelPath}`,
      {
        waitUntil: "networkidle",
      },
    );
    if (!privateChannelResponse?.ok()) {
      throw new Error(
        `player-private-channel ${viewport.name} returned ${privateChannelResponse?.status()} for ${privateChannelPath}`,
      );
    }
    const privateChannelSurface = privateChannelPage.getByTestId("player-surface");
    await privateChannelSurface.waitFor({ state: "visible" });
    const privateChannelMedia = await assertPlayerMediaNetwork(
      privateChannelPage,
      {
        mediaRequests: privateChannelMediaRequests,
      },
    );
    const privateChannelTargets = [
      {
        label: "player-private-channel surface",
        box: await assertVisibleBox(
          privateChannelSurface,
          "player-private-channel surface",
        ),
      },
      {
        label: "player-private-channel active rail",
        box: await assertNavigationAffordance(
          privateChannelPage.getByTestId("player-channel-role-pm"),
          {
            label: "player-private-channel active rail",
            navigation: "link",
            hrefPath: privateChannelPath,
            baseUrl,
          },
        ),
      },
      {
        label: "player-private-channel review link",
        box: await assertNavigationAffordance(
          privateChannelPage.getByTestId("player-private-link-notification-1"),
          {
            label: "player-private-channel private review link",
            navigation: "link",
            hrefPath: privateChannelPath,
            searchParams: Object.freeze({ private: "notification-1" }),
            baseUrl,
          },
        ),
      },
    ];
    await assertNoObviousOverlap(privateChannelTargets, {
      role: "player-private-channel",
      viewport: viewport.name,
    });
    const privateChannelFocusTraversal = await assertFocusTraversal(
      privateChannelPage,
      {
        label: `player-private-channel ${viewport.name}`,
        ...playerRole.focus,
      },
    );
    const privateChannelCommand = await drivePlayerPrivateChannelPost(
      privateChannelPage,
      {
        commandRequests: privateChannelCommandRequests,
      },
    );
    const privateChannelScreenshot = path.join(
      artifactDir,
      `${viewport.name}-player-private-channel.png`,
    );
    const privateChannelScreenshotPixels = await captureScreenshotEvidence(
      privateChannelPage,
      {
        path: privateChannelScreenshot,
        label: `player-private-channel ${viewport.name}`,
        viewport,
      },
    );
    evidence.playerPrivateChannel.push({
      role: "player-private-channel",
      viewport,
      path: privateChannelPath,
      activeChannelTestId: "player-channel-role-pm",
      privateReviewHref: `${privateChannelPath}?private=notification-1`,
      media: privateChannelMedia,
      focusTraversal: privateChannelFocusTraversal,
      commandResult: privateChannelCommand,
      overlapCheckedTargets: privateChannelTargets.length,
      screenshot: path.relative(repoRoot, privateChannelScreenshot),
      screenshotPixels: privateChannelScreenshotPixels,
    });
    await privateChannelContext.close();

    for (const forbidden of forbiddenRoutes) {
      const context = await newContextForViewport(viewport, forbidden.token);
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}${forbidden.path}`, {
        waitUntil: "networkidle",
      });
      if (String(response?.status()) !== forbidden.status) {
        throw new Error(
          `${forbidden.id} ${viewport.name} returned ${response?.status()}, expected ${forbidden.status}`,
        );
      }
      const errorEvidence = await assertForbiddenRouteError(page, {
        ...forbidden,
        viewport: viewport.name,
      });
      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-forbidden-${forbidden.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${forbidden.id} ${viewport.name}`,
        viewport,
      });
      evidence.forbidden.push({
        role: "forbidden",
        scenario: forbidden.id,
        viewport,
        path: forbidden.path,
        ...errorEvidence,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await context.close();
    }

    for (const scenario of routeStateScenarios) {
      const context = await newContextForViewport(viewport, scenario.token);
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}${scenario.path}`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok()) {
        throw new Error(
          `${scenario.id} ${viewport.name} returned ${response?.status()} for ${scenario.path}`,
        );
      }
      const routeState = await assertRouteStateScenario(page, {
        scenario,
        viewport,
        baseUrl,
      });
      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-route-state-${scenario.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${scenario.id} ${viewport.name}`,
        viewport,
      });
      evidence.routeStates.push({
        ...routeState,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await context.close();
    }
  }

  for (const viewport of setupViewports) {
    const context = await newContextForViewport(viewport, hostSetupScenario.token);
    const page = await context.newPage();
    const response = await page.goto(`${baseUrl}${hostSetupScenario.path}`, {
      waitUntil: "networkidle",
    });
    if (!response?.ok()) {
      throw new Error(
        `${hostSetupScenario.id} ${viewport.name} returned ${response?.status()} for ${hostSetupScenario.path}`,
      );
    }
    const setupGeometry = await assertHostSetupWorkbenchGeometry(page, {
      scenario: hostSetupScenario,
      viewport,
    });
    const screenshot = path.join(
      artifactDir,
      `${viewport.name}-${hostSetupScenario.id}.png`,
    );
    const screenshotPixels = await captureScreenshotEvidence(page, {
      path: screenshot,
      label: `${hostSetupScenario.id} ${viewport.name}`,
      viewport,
    });
    evidence.setup.push({
      ...setupGeometry,
      screenshot: path.relative(repoRoot, screenshot),
      screenshotPixels,
    });
    await context.close();
  }

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "frontend-role-smoke",
    stage: "sveltekit-listen",
  });
  if (!handled) {
    throw error;
  }
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  if (viteServer !== undefined) {
    await viteServer.close();
  }
  if (previousFixtureEnv === undefined) {
    delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  } else {
    process.env.FMARCH_FRONTEND_FIXTURE_SESSION = previousFixtureEnv;
  }
}

async function newContextForViewport(viewport, token) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  if (token !== null) {
    await context.addCookies([
      {
        name: "fmarch_fixture_session",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  return context;
}

async function provePhaseGroundContrast(page) {
  const palettes = await page.evaluate(() => {
    const shell = document.querySelector('[data-component="fm-app-shell"]');
    if (shell === null) {
      throw new Error("phase contrast check requires the fm-app-shell root");
    }
    const readPalette = () => {
      const styles = getComputedStyle(shell);
      const token = (name) => styles.getPropertyValue(name).trim();
      return {
        ink: token("--fm-ink"),
        inkMuted: token("--fm-ink-muted"),
        ground: token("--fm-ground"),
        raised: token("--fm-raised"),
        accent: token("--fm-accent"),
        ok: token("--fm-ok"),
        pending: token("--fm-pending"),
        danger: token("--fm-danger"),
        dangerInk: token("--fm-danger-ink"),
        info: token("--fm-info"),
      };
    };
    const original = shell.getAttribute("data-phase");
    shell.setAttribute("data-phase", "day");
    const day = readPalette();
    shell.setAttribute("data-phase", "night");
    const night = readPalette();
    shell.setAttribute("data-phase", "twilight");
    const twilight = readPalette();
    if (original === null) {
      shell.removeAttribute("data-phase");
    } else {
      shell.setAttribute("data-phase", original);
    }
    return { day, night, twilight };
  });

  const checks = [];
  for (const [phase, palette] of Object.entries(palettes)) {
    const pairs = [
      ["ink-on-ground", palette.ink, palette.ground, 4.5],
      ["ink-on-raised", palette.ink, palette.raised, 4.5],
      ["ink-muted-on-ground", palette.inkMuted, palette.ground, 4.5],
      ["ink-muted-on-raised", palette.inkMuted, palette.raised, 4.5],
      ["accent-on-ground", palette.accent, palette.ground, 3],
      ["ok-on-ground", palette.ok, palette.ground, 3],
      ["ok-on-raised", palette.ok, palette.raised, 3],
      ["pending-on-ground", palette.pending, palette.ground, 3],
      ["pending-on-raised", palette.pending, palette.raised, 3],
      ["danger-on-ground", palette.danger, palette.ground, 3],
      ["danger-on-raised", palette.danger, palette.raised, 3],
      ["info-on-ground", palette.info, palette.ground, 3],
      ["info-on-raised", palette.info, palette.raised, 3],
      ["danger-ink-on-ground", palette.dangerInk, palette.ground, 4.5],
      ["danger-ink-on-raised", palette.dangerInk, palette.raised, 4.5],
    ];
    for (const [label, foreground, background, minimum] of pairs) {
      const ratio = wcagContrastRatio(foreground, background);
      if (ratio < minimum) {
        throw new Error(
          `${phase} palette ${label} contrast ${ratio.toFixed(2)} is below ${minimum} (${foreground} on ${background})`,
        );
      }
      checks.push({
        phase,
        pair: label,
        foreground,
        background,
        ratio: Number(ratio.toFixed(2)),
        minimum,
      });
    }
  }
  return checks;
}

function wcagContrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(cssColor) {
  const hex = cssColor.match(/^#([0-9a-f]{6})$/i)?.[1];
  let channels;
  if (hex !== undefined) {
    channels = [0, 2, 4].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
  } else {
    const rgb = cssColor.match(/rgba?\(([^)]+)\)/)?.[1];
    if (rgb === undefined) {
      throw new Error(`phase contrast check cannot parse color: ${cssColor}`);
    }
    channels = rgb
      .split(",")
      .slice(0, 3)
      .map((value) => Number(value.trim()) / 255);
  }
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function assertHostSetupWorkbenchGeometry(page, { scenario, viewport }) {
  const surface = page.getByTestId(scenario.surfaceTestId);
  await surface.waitFor({ state: "visible" });
  const bodyText = await page.textContent("body");
  if (!bodyText?.includes(scenario.requiredText)) {
    throw new Error(
      `${scenario.id} ${viewport.name} did not render ${scenario.requiredText}`,
    );
  }

  const surfaceBox = await assertVisibleBox(
    surface,
    `${scenario.id} surface`,
  );
  const capabilityBox = await assertVisibleBox(
    page.getByTestId(scenario.capabilityTestId),
    `${scenario.id} capability`,
  );
  const rosterBox = await assertVisibleBox(
    page.getByTestId("host-setup-roster"),
    `${scenario.id} roster`,
  );
  const workbenchBox = await assertVisibleBox(
    page.getByTestId("host-setup-roles"),
    `${scenario.id} slot workbench`,
  );
  const addSlotBox = await assertHitTarget(
    page.locator(".host-setup__inline-form button").first(),
    `${scenario.id} add slot`,
  );
  const startReviewBox = await assertHitTarget(
    page.getByTestId("host-setup-start-review"),
    `${scenario.id} start review`,
  );
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
    };
  });
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} horizontal overflow: ${overflow.scrollWidth}px over ${overflow.clientWidth}px`,
    );
  }

  const expectedLayout = viewport.width <= 820 ? "stacked" : "co-located-columns";
  const slotCards = [];
  const overlapTargets = [
    { label: `${scenario.id} surface`, box: surfaceBox },
    { label: `${scenario.id} roster`, box: rosterBox },
    { label: `${scenario.id} workbench`, box: workbenchBox },
    { label: `${scenario.id} add slot`, box: addSlotBox },
    { label: `${scenario.id} start review`, box: startReviewBox },
  ];
  for (const slotId of scenario.slotIds) {
    const card = page.getByTestId(`host-setup-slot-${slotId}`);
    const roleCell = page.getByTestId(`host-setup-role-${slotId}`);
    const summary = card.locator(".host-setup__slot-summary");
    const assignmentForm = card.locator(".host-setup__slot-form").first();
    const roleForm = card.locator(".host-setup__role-cell .host-setup__slot-form");
    const cardBox = await assertVisibleBox(card, `${scenario.id} ${slotId} card`);
    const summaryBox = await assertVisibleBox(
      summary,
      `${scenario.id} ${slotId} summary`,
    );
    const assignmentBox = await assertVisibleBox(
      assignmentForm,
      `${scenario.id} ${slotId} assignment`,
    );
    const roleCellBox = await assertVisibleBox(
      roleCell,
      `${scenario.id} ${slotId} role cell`,
    );
    const roleFormBox = await assertVisibleBox(
      roleForm,
      `${scenario.id} ${slotId} role form`,
    );
    await assertHitTarget(
      assignmentForm.locator("button").first(),
      `${scenario.id} ${slotId} assign occupant`,
    );
    await assertHitTarget(
      roleForm.locator("button").first(),
      `${scenario.id} ${slotId} assign role`,
    );
    if (!containsBox(cardBox, roleCellBox)) {
      throw new Error(`${scenario.id} ${viewport.name} ${slotId} role cell escaped slot card`);
    }
    if (!containsBox(cardBox, assignmentBox)) {
      throw new Error(`${scenario.id} ${viewport.name} ${slotId} assignment escaped slot card`);
    }

    const actualLayout =
      roleCellBox.y > summaryBox.y + summaryBox.height - 1
        ? "stacked"
        : "co-located-columns";
    if (actualLayout !== expectedLayout) {
      throw new Error(
        `${scenario.id} ${viewport.name} ${slotId} layout ${actualLayout}, expected ${expectedLayout}`,
      );
    }
    if (expectedLayout === "co-located-columns" && roleCellBox.x <= summaryBox.x) {
      throw new Error(
        `${scenario.id} ${viewport.name} ${slotId} role cell is not to the right of the slot summary`,
      );
    }

    overlapTargets.push(
      { label: `${scenario.id} ${slotId} summary`, box: summaryBox },
      { label: `${scenario.id} ${slotId} assignment`, box: assignmentBox },
      { label: `${scenario.id} ${slotId} role`, box: roleCellBox },
    );
    slotCards.push({
      slotId,
      state: await card.getAttribute("data-state"),
      layout: actualLayout,
      roleCellContainedInCard: true,
      assignmentContainedInCard: true,
      cardBox,
      summaryBox,
      assignmentBox,
      roleCellBox,
      roleFormBox,
    });
  }
  await assertNoObviousOverlap(overlapTargets, {
    role: scenario.id,
    viewport: viewport.name,
  });

  return {
    role: scenario.role,
    viewport,
    path: scenario.path,
    surfaceTestId: scenario.surfaceTestId,
    capabilityTestId: scenario.capabilityTestId,
    layout: expectedLayout,
    noHorizontalOverflow: true,
    overflow,
    surfaceBox,
    capabilityBox,
    rosterBox,
    workbenchBox,
    slotCards,
    overlapCheckedTargets: overlapTargets.length,
  };
}

async function driveAdminReject(page) {
  const createSetup = page.getByTestId("admin-setup-create-game");
  await createSetup.locator("button").click();
  const createStatus = page.getByTestId("admin-command-status-create-game");
  await createStatus.waitFor({ state: "visible" });
  if ((await createStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("admin create-game did not require confirmation");
  }
  const createConfirm = page.getByTestId("admin-command-confirm-create-game");
  await createConfirm.click();
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-command-status-create-game"]',
    );
    return node?.getAttribute("data-state") === "reject";
  });
  const createRegion = await assertStatusLiveRegion(createStatus, {
    label: "admin create-game reject status",
    expectedState: "reject",
    expectedAriaLive: "assertive",
  });
  const sessionGrantSetup = page.getByTestId("admin-setup-session-grants");
  await sessionGrantSetup.locator("button").click();
  const sessionGrantStatus = page.getByTestId(
    "admin-command-status-session-grants",
  );
  await sessionGrantStatus.waitFor({ state: "visible" });
  if ((await sessionGrantStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("session grant did not require confirmation");
  }
  const sessionGrantRegion = await assertStatusLiveRegion(sessionGrantStatus, {
    label: "admin session-grants confirm status",
    expectedState: "confirm",
    expectedAriaLive: "polite",
  });
  const sessionGrantMessage = await sessionGrantStatus.innerText();
  const sessionGrantForm = await assertFormContract(page, {
    label: "admin session grant form",
    formTestId: "admin-session-grant-form",
    action: "?/grantSession",
    fieldTestIds: [
      "admin-session-grant-token",
      "admin-session-grant-principal",
      "admin-session-grant-expires-at",
      "admin-session-grant-global-mod",
    ],
  });
  const sessionGrantFocus = await assertAdminConfirmationFocus(page, {
    label: "admin session grant",
    dialogTestId: "admin-session-grant-form",
    confirmTestId: "admin-command-confirm-session-grants",
    cancelTestId: "admin-command-cancel-session-grants",
    returnFocusTestId: "admin-command-trigger-session-grants",
    escapeCancels: true,
    tabSequenceTestIds: [
      "admin-command-cancel-session-grants",
      "admin-session-grant-token",
      "admin-session-grant-principal",
      "admin-session-grant-expires-at",
      "admin-session-grant-global-mod",
      "admin-command-confirm-session-grants",
    ],
    shiftTabFromFirstTestId: "admin-session-grant-token",
    shiftTabReturnTestId: "admin-command-cancel-session-grants",
  });
  await sessionGrantSetup.locator("button").click();
  await sessionGrantStatus.waitFor({ state: "visible" });
  await assertHitTarget(
    page.getByTestId("admin-command-confirm-session-grants"),
    "admin session grant confirm",
  );
  await page.getByTestId("admin-command-cancel-session-grants").click();
  await assertFocusedTestId(
    page,
    "admin-command-trigger-session-grants",
    "admin session grant cancel focus return",
  );
  const cohostSetup = page.getByTestId("admin-setup-cohost");
  await cohostSetup.locator("button").click();
  const cohostStatus = page.getByTestId("admin-command-status-cohost");
  await cohostStatus.waitFor({ state: "visible" });
  if ((await cohostStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("cohost delegation did not require confirmation");
  }
  const cohostConfirmRegion = await assertStatusLiveRegion(cohostStatus, {
    label: "admin cohost confirm status",
    expectedState: "confirm",
    expectedAriaLive: "polite",
  });
  const cohostFocus = await assertAdminConfirmationFocus(page, {
    label: "admin cohost",
    confirmTestId: "admin-command-confirm-cohost",
    cancelTestId: "admin-command-cancel-cohost",
    returnFocusTestId: "admin-command-trigger-cohost",
    escapeCancels: true,
    tabSequenceTestIds: [
      "admin-command-cancel-cohost",
      "admin-command-confirm-cohost",
      "admin-command-cancel-cohost",
    ],
  });
  await cohostSetup.locator("button").click();
  await cohostStatus.waitFor({ state: "visible" });
  await assertHitTarget(
    page.getByTestId("admin-command-confirm-cohost"),
    "admin cohost confirm",
  );
  await page.getByTestId("admin-command-confirm-cohost").click();
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-command-status-cohost"]',
    );
    return node?.getAttribute("data-state") === "reject";
  });
  const cohostRejectRegion = await assertStatusLiveRegion(cohostStatus, {
    label: "admin cohost reject status",
    expectedState: "reject",
    expectedAriaLive: "assertive",
  });
  const cohostActivity = await assertAdminCommandActivity(page, {
    actionId: "cohost",
    expectedState: "reject",
  });
  const result = {
    create: {
      state: await createStatus.getAttribute("data-state"),
      message: await createStatus.innerText(),
      statusRegion: createRegion,
    },
    sessionGrant: {
      state: sessionGrantRegion.state,
      message: sessionGrantMessage,
      statusRegion: sessionGrantRegion,
      focus: sessionGrantFocus,
      form: sessionGrantForm,
    },
    cohost: {
      state: await cohostStatus.getAttribute("data-state"),
      message: await cohostStatus.innerText(),
      confirmStatusRegion: cohostConfirmRegion,
      rejectStatusRegion: cohostRejectRegion,
      focus: cohostFocus,
    },
  };
  const recovery = page.getByTestId("admin-recovery-recovery-gate");
  await recovery.locator("button").click();
  const recoveryStatus = page.getByTestId("admin-recovery-status-recovery-gate");
  await recoveryStatus.waitFor({ state: "visible" });
  if ((await recoveryStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("recovery gate did not require confirmation");
  }
  const recoveryConfirmRegion = await assertStatusLiveRegion(recoveryStatus, {
    label: "admin recovery confirm status",
    expectedState: "confirm",
    expectedAriaLive: "polite",
  });
  const recoveryForm = await assertFormContract(page, {
    label: "admin recovery gate form",
    formTestId: "admin-recovery-form-recovery-gate",
    action: "?/checkRecoveryGate",
    fieldNames: ["game", "principalUserId"],
  });
  const recoveryFocus = await assertAdminConfirmationFocus(page, {
    label: "admin recovery gate",
    dialogTestId: "admin-recovery-form-recovery-gate",
    confirmTestId: "admin-recovery-confirm-recovery-gate",
    cancelTestId: "admin-recovery-cancel-recovery-gate",
    returnFocusTestId: "admin-recovery-trigger-recovery-gate",
    escapeCancels: true,
    tabSequenceTestIds: [
      "admin-recovery-cancel-recovery-gate",
      "admin-recovery-confirm-recovery-gate",
      "admin-recovery-cancel-recovery-gate",
    ],
  });
  await recovery.locator("button").click();
  await recoveryStatus.waitFor({ state: "visible" });
  await assertHitTarget(
    page.getByTestId("admin-recovery-confirm-recovery-gate"),
    "admin recovery gate confirm",
  );
  await page.getByTestId("admin-recovery-confirm-recovery-gate").click();
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-recovery-status-recovery-gate"]',
    );
    return node?.getAttribute("data-state") === "ack";
  });
  const recoveryAckRegion = await assertStatusLiveRegion(recoveryStatus, {
    label: "admin recovery ack status",
    expectedState: "ack",
    expectedAriaLive: "polite",
  });
  const recoveryActivity = await assertAdminCommandActivity(page, {
    actionId: "recovery-gate",
    expectedState: "ack",
  });
  result.recovery = {
    state: await recoveryStatus.getAttribute("data-state"),
    message: await recoveryStatus.innerText(),
    confirmStatusRegion: recoveryConfirmRegion,
    ackStatusRegion: recoveryAckRegion,
    focus: recoveryFocus,
    form: recoveryForm,
  };
  result.activity = {
    rejected: cohostActivity,
    acknowledged: recoveryActivity,
  };
  return result;
}

async function driveAdminAuditDetailClick(page, { viewport, baseUrl }) {
  await page.getByTestId("admin-audit-link-proof-runs").click();
  await page.waitForURL((url) => {
    return (
      url.pathname === "/admin/audit/proof-runs" &&
      url.searchParams.get("game") === "midsummer"
    );
  });
  const url = new URL(page.url());
  const surface = page.getByTestId("admin-audit-detail-surface");
  await surface.waitFor({ state: "visible" });
  await assertVisibleBox(surface, "admin audit detail surface");
  const auditId = await surface.getAttribute("data-audit-id");
  if (auditId !== "proof-runs") {
    throw new Error(`admin audit detail rendered audit ${auditId}`);
  }
  const capabilityText = await page
    .getByTestId("admin-audit-detail-capability")
    .innerText();
  if (!capabilityText.includes("GlobalAdmin")) {
    throw new Error(`admin audit detail capability was ${capabilityText}`);
  }
  const bodyText = await page.textContent("body");
  if (!bodyText?.includes("Read-only operator proof")) {
    throw new Error("admin audit detail did not render operator proof boundary");
  }
  const statusRegion = await assertStatusLiveRegion(
    page.getByTestId("admin-audit-detail-status"),
    {
      label: "admin audit detail status",
      expectedState: "ack",
      expectedAriaLive: "polite",
    },
  );
  const evidenceBox = await assertNavigationAffordance(
    page.getByTestId("admin-audit-detail-evidence"),
    {
      label: "admin audit detail machine evidence",
      navigation: "link",
      hrefPath: "/games/midsummer/operator/proof-runs",
      searchParams: { principal_user_id: "admin_a" },
      baseUrl,
    },
  );
  const evidenceHref = await page
    .getByTestId("admin-audit-detail-evidence")
    .getAttribute("href");
  const backBox = await assertNavigationAffordance(
    page.getByTestId("admin-audit-detail-back"),
    {
      label: "admin audit detail admin overview",
      navigation: "link",
      hrefPath: "/admin",
      searchParams: { game: "midsummer" },
      baseUrl,
    },
  );
  const backHref = await page
    .getByTestId("admin-audit-detail-back")
    .getAttribute("href");
  const navTargets = await assertRoleNav(page);
  await assertNoObviousOverlap(
    [
      ...navTargets,
      { label: "admin audit detail evidence", box: evidenceBox },
      { label: "admin audit detail admin overview", box: backBox },
    ],
    {
      role: "admin-audit-detail",
      viewport: viewport.name,
    },
  );
  const screenshot = path.join(
    artifactDir,
    `${viewport.name}-admin-audit-detail-proof-runs.png`,
  );
  const screenshotPixels = await captureScreenshotEvidence(page, {
    path: screenshot,
    label: `admin audit detail ${viewport.name}`,
    viewport,
  });

  return {
    testId: "admin-audit-link-proof-runs",
    path: url.pathname,
    searchParams: { game: url.searchParams.get("game") },
    surfaceTestId: "admin-audit-detail-surface",
    auditId,
    capability: capabilityText,
    statusRegion,
    evidenceTestId: "admin-audit-detail-evidence",
    evidenceHref,
    backTestId: "admin-audit-detail-back",
    backHref,
    overlapCheckedTargets: navTargets.length + 2,
    screenshot: path.relative(repoRoot, screenshot),
    screenshotPixels,
    viewport,
  };
}

async function driveModeratorReject(page, { commandRequests = [] } = {}) {
  const actionRoot = page.getByTestId("critical-host-action-extend_deadline");
  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  const focus = await assertHostConfirmationFocus(actionRoot, page, {
    label: "moderator extend deadline",
    escapeCancels: true,
    tabSequenceTestIds: [
      "critical-host-action-cancel",
      "critical-host-action-confirm",
      "critical-host-action-cancel",
    ],
  });
  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await assertHitTarget(
    actionRoot.getByTestId("critical-host-action-confirm"),
    "moderator confirm",
  );
  await actionRoot.getByTestId("critical-host-action-confirm").click();
  const status = page.getByTestId("host-command-status-extend_deadline");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="host-command-status-extend_deadline"]',
    );
    return node?.getAttribute("data-state") === "reject";
  });
  const statusRegion = await assertStatusLiveRegion(status, {
    label: "moderator extend-deadline reject status",
    expectedState: "reject",
    expectedAriaLive: "assertive",
  });
  const rejectedActivity = await assertHostCommandActivity(page, {
    actionId: "extend_deadline",
    expectedState: "reject",
  });
  const hostPrompt = await driveModeratorHostPromptAck(page);
  const acknowledgedActivity = await assertHostCommandActivity(page, {
    actionId: hostPrompt.actionId,
    expectedState: "ack",
  });
  const slotLifecycle = await driveModeratorSlotLifecycleAck(page, {
    commandRequests,
  });
  const slotLifecycleActivity = await assertHostCommandActivity(page, {
    actionId: slotLifecycle.actionId,
    expectedState: "ack",
  });
  return {
    state: await status.getAttribute("data-state"),
    message: await status.innerText(),
    statusRegion,
    activity: {
      rejected: rejectedActivity,
      acknowledged: acknowledgedActivity,
      slotLifecycle: slotLifecycleActivity,
    },
    focus,
    hostPrompt,
    slotLifecycle,
  };
}

async function driveModeratorHostPromptAck(page) {
  const actionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  await assertVisibleBox(actionRoot, "moderator host prompt action");

  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  const focus = await assertHostConfirmationFocus(actionRoot, page, {
    label: "moderator host prompt",
    escapeCancels: true,
    tabSequenceTestIds: [
      "critical-host-action-cancel",
      "critical-host-action-confirm",
      "critical-host-action-cancel",
    ],
  });

  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await actionRoot.getByTestId("critical-host-action-cancel").click();
  await actionRoot
    .getByTestId("critical-host-action-confirmation")
    .waitFor({ state: "detached" });
  const cancelFocus = await assertFocusedTestId(
    page,
    "critical-host-action-trigger",
    "moderator host prompt cancel focus return",
  );

  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await assertHitTarget(
    actionRoot.getByTestId("critical-host-action-confirm"),
    "moderator host prompt confirm",
  );
  await actionRoot.getByTestId("critical-host-action-confirm").click();
  await page.waitForFunction((expectedActionId) => {
    return window.__fmarchHostCommandOutcomes?.some(
      (outcome) => outcome.actionId === expectedActionId && outcome.state === "ack",
    );
  }, actionId);
  await page.waitForFunction(() => {
    return (
      Array.isArray(window.__fmarchHostPromptsProjection) &&
      window.__fmarchHostPromptsProjection.length === 0
    );
  });
  await actionRoot.waitFor({ state: "detached" });

  const promptControlText = await page
    .getByTestId("moderator-control-host-prompts")
    .innerText();
  if (!promptControlText.includes("No pending host prompts.")) {
    throw new Error(
      `moderator host prompt control did not render empty label: ${promptControlText}`,
    );
  }

  const outcome = await page.evaluate((expectedActionId) => {
    return window.__fmarchHostCommandOutcomes?.find(
      (candidate) => candidate.actionId === expectedActionId,
    );
  }, actionId);
  const dispatched = await page.evaluate((expectedActionId) => {
    return window.__fmarchHostActionEvents?.find(
      (candidate) => candidate.actionId === expectedActionId,
    );
  }, actionId);
  const promptProjectionRows = await page.evaluate(
    () => window.__fmarchHostPromptsProjection?.length ?? null,
  );

  return {
    actionId,
    state: outcome?.state,
    message: outcome?.message,
    streamSeqs: outcome?.streamSeqs,
    requestCommand: outcome?.requestEnvelope?.body?.body?.command,
    dispatchedPayload: dispatched?.payload,
    focus,
    cancelFocus,
    promptProjectionRows,
    actionDetached: true,
    emptyLabelRendered: true,
  };
}

async function driveModeratorSlotLifecycleAck(page, { commandRequests = [] } = {}) {
  const actionId = "modkill_slot";
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  await assertVisibleBox(actionRoot, "moderator slot lifecycle action");

  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  const focus = await assertHostConfirmationFocus(actionRoot, page, {
    label: "moderator modkill slot",
    escapeCancels: true,
    tabSequenceTestIds: [
      "critical-host-action-cancel",
      "critical-host-action-confirm",
      "critical-host-action-cancel",
    ],
  });

  await actionRoot.getByTestId("critical-host-action-trigger").click();
  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await assertHitTarget(
    actionRoot.getByTestId("critical-host-action-confirm"),
    "moderator modkill slot confirm",
  );
  await actionRoot.getByTestId("critical-host-action-confirm").click();

  await page.waitForFunction((expectedActionId) => {
    return window.__fmarchHostCommandOutcomes?.some(
      (outcome) => outcome.actionId === expectedActionId && outcome.state === "ack",
    );
  }, actionId);
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="host-console-slot-lifecycle"]',
    );
    return node?.textContent?.includes("Modkilled");
  });
  const lifecycleLabel = await page
    .getByTestId("host-console-slot-lifecycle")
    .innerText();
  const historyLabel = await page.getByTestId("host-console-history").innerText();
  const outcome = await page.evaluate((expectedActionId) => {
    return window.__fmarchHostCommandOutcomes?.find(
      (candidate) => candidate.actionId === expectedActionId,
    );
  }, actionId);
  const dispatched = await page.evaluate((expectedActionId) => {
    return window.__fmarchHostActionEvents?.find(
      (candidate) => candidate.actionId === expectedActionId,
    );
  }, actionId);
  const requestCommand = commandRequests.find(
    (command) => command?.SetSlotStatus !== undefined,
  );

  return {
    actionId,
    state: outcome?.state,
    message: outcome?.message,
    statusRegion: {
      state: outcome?.state,
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
      source: "host-command-outcome",
    },
    streamSeqs: outcome?.streamSeqs,
    requestCommand,
    dispatchedPayload: dispatched?.payload,
    projection: {
      lifecycleLabel,
      historyLabel,
    },
    focus,
  };
}

async function assertHostCommandActivity(page, { actionId, expectedState }) {
  await page.getByTestId("host-command-activity").waitFor({ state: "visible" });
  const status = page.getByTestId(`host-command-activity-status-${actionId}`);
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ testId, state }) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      return node?.getAttribute("data-state") === state;
    },
    {
      testId: `host-command-activity-status-${actionId}`,
      state: expectedState,
    },
  );
  const statusRegion = await assertStatusLiveRegion(status, {
    label: `host command activity ${actionId}`,
    expectedState,
    expectedAriaLive: expectedState === "reject" ? "assertive" : "polite",
  });
  return {
    activityTestId: "host-command-activity",
    activityItemTestId: `host-command-activity-${actionId}`,
    statusTestId: `host-command-activity-status-${actionId}`,
    state: await status.getAttribute("data-state"),
    message: await status.innerText(),
    statusRegion,
  };
}

async function assertAdminCommandActivity(page, { actionId, expectedState }) {
  await page.getByTestId("admin-command-activity").waitFor({ state: "visible" });
  const status = page.getByTestId(`admin-command-activity-status-${actionId}`);
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ testId, state }) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      return node?.getAttribute("data-state") === state;
    },
    {
      testId: `admin-command-activity-status-${actionId}`,
      state: expectedState,
    },
  );
  const statusRegion = await assertStatusLiveRegion(status, {
    label: `admin command activity ${actionId}`,
    expectedState,
    expectedAriaLive: expectedState === "reject" ? "assertive" : "polite",
  });
  return {
    activityTestId: "admin-command-activity",
    activityItemTestId: `admin-command-activity-${actionId}`,
    statusTestId: `admin-command-activity-status-${actionId}`,
    state: await status.getAttribute("data-state"),
    message: await status.innerText(),
    statusRegion,
  };
}

async function assertPlayerCommandReceipt(page, { actionId, expectedState }) {
  await page.getByTestId("player-command-receipt").waitFor({ state: "visible" });
  await page
    .getByTestId(`player-command-receipt-${actionId}`)
    .waitFor({ state: "visible" });
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ state }) => {
      const node = document.querySelector('[data-testid="player-command-status"]');
      return node?.getAttribute("data-state") === state;
    },
    { state: expectedState },
  );
  const exportedReceipts = await page.evaluate(
    () => window.__fmarchPlayerCommandReceipts ?? null,
  );
  const statusRegion = await assertStatusLiveRegion(status, {
    label: `player command receipt ${actionId}`,
    expectedState,
    expectedAriaLive: expectedState === "reject" ? "assertive" : "polite",
  });
  return {
    receiptTestId: "player-command-receipt",
    receiptItemTestId: `player-command-receipt-${actionId}`,
    statusTestId: "player-command-status",
    state: await status.getAttribute("data-state"),
    message: await status.innerText(),
    exportedReceipts,
    statusRegion,
  };
}

async function installPrivateChannelBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitPost !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [172],
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? 1,
        body: {
          kind: "Reject",
          body: {
            error: "WrongPrivateChannelCommand",
            retryable: false,
            message: "private-channel smoke only accepts SubmitPost",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/channels/*/thread?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        next_before_seq: 440,
        posts: [
          {
            source_seq: 446,
            stream_seq: 172,
            author_slot: "slot-7",
            author_user: "Mira",
            body: "Browser smoke refreshed private channel post.",
            occurred_at: 1781939100,
          },
        ],
      }),
    });
  });
  await page.route(/\/games\/[^/]+\/votecount(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          target: "slot-2 / Ilya",
          count: 3,
          needed: 5,
        },
      ]),
    });
  });
  await page.route(/\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(/\/games\/[^/]+\/player-command-state(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        game: "midsummer",
        actor_slot: "slot-7",
        actor_alive: true,
        actor_status: "alive",
        phase: {
          phase_id: "D01",
          phase_kind: "Day",
          phase_number: 1,
          locked: false,
        },
        actions: [],
        vote_targets: [],
      }),
    });
  });
}

async function assertAdminConfirmationFocus(
  page,
  {
    label,
    dialogTestId = null,
    confirmTestId,
    cancelTestId,
    returnFocusTestId,
    escapeCancels = false,
    tabContainment = "local-confirmation-controls",
    tabSequenceTestIds = [],
    shiftTabFromFirstTestId = null,
    shiftTabReturnTestId = null,
  },
) {
  const dialog = await assertConfirmationRoot(page, {
    label,
    dialogTestId,
    confirmTestId,
    expectedInitialFocusTestId: confirmTestId,
    expectedReturnFocusTestId: returnFocusTestId,
    expectedEscapeCancels: escapeCancels,
    expectedTabContainment: tabContainment,
  });
  await assertHitTarget(page.getByTestId(confirmTestId), `${label} confirm`);
  await assertHitTarget(page.getByTestId(cancelTestId), `${label} cancel`);
  const initialFocus = await assertFocusedTestId(
    page,
    confirmTestId,
    `${label} initial focus`,
  );

  const tabSequence = [];
  for (const expectedTestId of tabSequenceTestIds) {
    await page.keyboard.press("Tab");
    tabSequence.push(
      await assertFocusedTestId(page, expectedTestId, `${label} tab to ${expectedTestId}`),
    );
  }

  let shiftTabReturnFocus = null;
  if (shiftTabFromFirstTestId !== null && shiftTabReturnTestId !== null) {
    await page.getByTestId(shiftTabFromFirstTestId).focus();
    await assertFocusedTestId(
      page,
      shiftTabFromFirstTestId,
      `${label} shift-tab source focus`,
    );
    await page.keyboard.press("Shift+Tab");
    shiftTabReturnFocus = await assertFocusedTestId(
      page,
      shiftTabReturnTestId,
      `${label} shift-tab loops to ${shiftTabReturnTestId}`,
    );
  }

  let escapeReturnFocus = null;
  if (escapeCancels) {
    await page.keyboard.press("Escape");
    await page.getByTestId(confirmTestId).waitFor({ state: "detached" });
    escapeReturnFocus = await assertFocusedTestId(
      page,
      returnFocusTestId,
      `${label} escape focus return`,
    );
  }

  return {
    contract: dialog.contract,
    initialFocus,
    tabSequence,
    shiftTabReturnFocus,
    escapeReturnFocus,
  };
}

async function assertFormContract(
  page,
  { label, formTestId, action, fieldTestIds = [], fieldNames = [] },
) {
  const form = page.getByTestId(formTestId);
  await form.waitFor({ state: "visible" });
  const actualAction = await form.getAttribute("action");
  if (actualAction !== action) {
    throw new Error(`${label} action ${actualAction}, expected ${action}`);
  }
  for (const testId of fieldTestIds) {
    const count = await form.locator(`[data-testid="${testId}"]`).count();
    if (count !== 1) {
      throw new Error(`${label} expected one field ${testId}, found ${count}`);
    }
  }
  for (const name of fieldNames) {
    const count = await form.locator(`[name="${name}"]`).count();
    if (count !== 1) {
      throw new Error(`${label} expected one field name ${name}, found ${count}`);
    }
  }
  return {
    formTestId,
    action,
    fieldTestIds,
    fieldNames,
  };
}

async function assertHostConfirmationFocus(actionRoot, page, {
  label,
  escapeCancels = false,
  tabContainment = "confirm-cancel",
  tabSequenceTestIds = [],
}) {
  const dialog = await assertConfirmationRoot(actionRoot, {
    label,
    dialogTestId: "critical-host-action-confirmation",
    confirmTestId: "critical-host-action-confirm",
    expectedInitialFocusTestId: "critical-host-action-confirm",
    expectedReturnFocusTestId: "critical-host-action-trigger",
    expectedEscapeCancels: escapeCancels,
    expectedTabContainment: tabContainment,
  });
  await assertHitTarget(
    actionRoot.getByTestId("critical-host-action-confirm"),
    `${label} confirm`,
  );
  await assertHitTarget(
    actionRoot.getByTestId("critical-host-action-cancel"),
    `${label} cancel`,
  );
  const initialFocus = await assertFocusedTestId(
    page,
    "critical-host-action-confirm",
    `${label} initial focus`,
  );

  const tabSequence = [];
  for (const expectedTestId of tabSequenceTestIds) {
    await page.keyboard.press("Tab");
    tabSequence.push(
      await assertFocusedTestId(
        page,
        expectedTestId,
        `${label} tab to ${expectedTestId}`,
      ),
    );
  }

  let escapeReturnFocus = null;
  if (escapeCancels) {
    await page.keyboard.press("Escape");
    await actionRoot
      .getByTestId("critical-host-action-confirmation")
      .waitFor({ state: "detached" });
    escapeReturnFocus = await assertFocusedTestId(
      page,
      "critical-host-action-trigger",
      `${label} escape focus return`,
    );
  }

  return {
    contract: dialog.contract,
    initialFocus,
    tabSequence,
    escapeReturnFocus,
  };
}

async function assertConfirmationRoot(
  locatorRoot,
  {
    label,
    dialogTestId = null,
    confirmTestId,
    expectedInitialFocusTestId,
    expectedReturnFocusTestId,
    expectedEscapeCancels,
    expectedTabContainment,
  },
) {
  const dialog =
    dialogTestId === null
      ? locatorRoot
          .getByTestId(confirmTestId)
          .locator("xpath=ancestor::*[@role='alertdialog'][1]")
      : locatorRoot.getByTestId(dialogTestId);
  await assertConfirmationDialog(dialog, {
    label,
    expectedRole: "alertdialog",
    expectedAriaModal: "true",
  });
  const contract = {
    initialFocusTestId: await dialog.getAttribute("data-initial-focus-testid"),
    returnFocusTestId: await dialog.getAttribute("data-return-focus-testid"),
    escapeCancels: await dialog.getAttribute("data-escape-cancels"),
    tabContainment: await dialog.getAttribute("data-tab-containment"),
  };
  const expectedContract = {
    initialFocusTestId: expectedInitialFocusTestId,
    returnFocusTestId: expectedReturnFocusTestId,
    escapeCancels: String(expectedEscapeCancels),
    tabContainment: expectedTabContainment,
  };
  if (JSON.stringify(contract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `${label} confirmation contract ${JSON.stringify(
        contract,
      )}, expected ${JSON.stringify(expectedContract)}`,
    );
  }

  return {
    locator: dialog,
    contract,
  };
}

async function drivePlayerPrivateChannelPost(page, { commandRequests }) {
  const activeChannel = page.getByTestId("player-channel-role-pm");
  await activeChannel.waitFor({ state: "visible" });
  if ((await activeChannel.getAttribute("aria-current")) !== "page") {
    throw new Error("player private channel route did not mark role-pm active");
  }

  const composer = page.getByTestId("player-composer");
  await composer.locator("textarea").fill("Browser smoke role-pm post");
  await composer.locator('[data-action="submit_post"]').click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="player-command-status"]');
    return node?.getAttribute("data-state") === "ack";
  });
  const statusRegion = await assertStatusLiveRegion(status, {
    label: "player private-channel post command ack status",
    expectedState: "ack",
    expectedAriaLive: "polite",
  });
  const receipt = await assertPlayerCommandReceipt(page, {
    actionId: "submit_post",
    expectedState: "ack",
  });
  await page.getByTestId("thread-post-446").waitFor({ state: "visible" });

  const requestCommand = commandRequests.find(
    (command) => command?.SubmitPost !== undefined,
  )?.SubmitPost;
  if (requestCommand === undefined) {
    throw new Error("player private-channel smoke did not emit SubmitPost");
  }
  const expectedCommand = {
    game: "midsummer",
    channel_id: "role-pm",
    actor_slot: "slot-7",
    body: "Browser smoke role-pm post",
  };
  if (JSON.stringify(requestCommand) !== JSON.stringify(expectedCommand)) {
    throw new Error(
      `player private-channel SubmitPost ${JSON.stringify(
        requestCommand,
      )}, expected ${JSON.stringify(expectedCommand)}`,
    );
  }

  return {
    state: await status.getAttribute("data-state"),
    message: await status.innerText(),
    statusRegion,
    receipt,
    requestCommand,
    refreshedPostTestId: "thread-post-446",
    refreshedPost: await page.getByTestId("thread-post-446").innerText(),
  };
}

async function drivePlayerReject(page, { viewport, baseUrl, commandRequests, mediaRequests }) {
  const media = await assertPlayerMediaNetwork(page, { mediaRequests });
  await emitPlayerOfficialThreadPost(page);
  const officialPost = page.getByTestId("player-live-official-post");
  await officialPost.waitFor({ state: "visible" });
  await assertVisibleBox(officialPost, "player live official post");
  await page.getByTestId("thread-post-444").waitFor({ state: "visible" });
  const privateDisclosure = await drivePlayerPrivateDisclosure(page, {
    viewport,
    baseUrl,
  });

  await page.getByTestId("player-thread-load-older").click();
  const pageStatus = page.getByTestId("player-thread-page-status");
  await pageStatus.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="player-thread-page-status"]');
    return node?.getAttribute("data-state") === "ack";
  });
  const pageStatusRegion = await assertStatusLiveRegion(pageStatus, {
    label: "player thread page ack status",
    expectedState: "ack",
    expectedAriaLive: "polite",
  });
  await page.getByTestId("thread-post-440").waitFor({ state: "visible" });
  const composer = page.getByTestId("player-composer");
  await composer.locator("button").first().click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="player-command-status"]');
    return node?.getAttribute("data-state") === "reject";
  });
  const commandStatusRegion = await assertStatusLiveRegion(status, {
    label: "player command reject status",
    expectedState: "reject",
    expectedAriaLive: "assertive",
  });
  const commandReceipt = await assertPlayerCommandReceipt(page, {
    actionId: "submit_vote",
    expectedState: "reject",
  });
  await composer.locator("textarea").fill("Browser smoke player post");
  await composer.locator('[data-action="submit_post"]').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="player-command-status"]');
    return node?.getAttribute("data-state") === "ack";
  });
  const postCommandStatusRegion = await assertStatusLiveRegion(status, {
    label: "player post command ack status",
    expectedState: "ack",
    expectedAriaLive: "polite",
  });
  const postCommandReceipt = await assertPlayerCommandReceipt(page, {
    actionId: "submit_post",
    expectedState: "ack",
  });
  await page.getByTestId("thread-post-445").waitFor({ state: "visible" });
  const postRequest = commandRequests.find(
    (command) => command?.SubmitPost !== undefined,
  )?.SubmitPost;
  return {
    media,
    liveThread: {
      officialPost: await officialPost.innerText(),
      renderedPost: await page.getByTestId("thread-post-444").innerText(),
      refreshedPost: await page.getByTestId("thread-post-445").innerText(),
    },
    privateDisclosure,
    page: {
      state: await pageStatus.getAttribute("data-state"),
      message: await pageStatus.innerText(),
      statusRegion: pageStatusRegion,
    },
    command: {
      state: await status.getAttribute("data-state"),
      message: await status.innerText(),
      statusRegion: commandStatusRegion,
    },
    commandReceipt,
    postCommand: {
      state: await status.getAttribute("data-state"),
      message: await status.innerText(),
      statusRegion: postCommandStatusRegion,
      requestCommand: postRequest,
      refreshedPostTestId: "thread-post-445",
    },
    postCommandReceipt,
  };
}

async function installPlayerMediaNetworkHarness(page) {
  const requests = [];
  await page.route("**/media/midsummer/thread/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const variant = playerMediaVariantFromPath(requestUrl.pathname);
    requests.push({
      url: requestUrl.pathname,
      variant,
      resourceType: route.request().resourceType(),
    });
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: MEDIA_FIXTURE_PNG,
    });
  });
  return requests;
}

async function assertPlayerMediaNetwork(page, { mediaRequests }) {
  const boundary = page.getByTestId("thread-post-media-boundary-442");
  await boundary.waitFor({ state: "visible" });
  const media = page.getByTestId("thread-post-media-receipt-442");
  await assertVisibleBox(media, "player thread tablet media figure");
  const image = media.locator("img");
  const renderedVariant = await media.getAttribute("data-media-variant");
  if (!PLAYER_MEDIA_ALLOWED_VARIANTS.includes(renderedVariant)) {
    throw new Error(`player media rendered forbidden variant ${renderedVariant}`);
  }
  const initialImageAttrs = await image.evaluate((node) => ({
    src: node.getAttribute("src"),
    srcset: node.getAttribute("srcset"),
    currentSrc: node.currentSrc,
  }));
  assertNoForbiddenMediaUrl(initialImageAttrs.src, "player media src");
  assertNoForbiddenMediaUrl(initialImageAttrs.srcset, "player media srcset");
  assertNoForbiddenMediaUrl(initialImageAttrs.currentSrc, "player media currentSrc");

  await page.waitForFunction(() => {
    const img = document.querySelector('[data-testid="thread-post-media-receipt-442"] img');
    return img?.complete === true && img.naturalWidth > 0;
  });
  const imageAttrs = await image.evaluate((node) => ({
    src: node.getAttribute("src"),
    srcset: node.getAttribute("srcset"),
    sizes: node.getAttribute("sizes"),
    currentSrc: node.currentSrc,
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight,
    alt: node.getAttribute("alt"),
  }));
  assertNoForbiddenMediaUrl(imageAttrs.src, "player media src");
  assertNoForbiddenMediaUrl(imageAttrs.srcset, "player media srcset");
  assertNoForbiddenMediaUrl(imageAttrs.currentSrc, "player media currentSrc");

  if (!Array.isArray(mediaRequests) || mediaRequests.length === 0) {
    throw new Error("player media did not request any browser image URL");
  }
  const forbiddenRequests = mediaRequests.filter((request) =>
    isForbiddenMediaUrl(request.url),
  );
  if (forbiddenRequests.length > 0) {
    throw new Error(
      `player media requested forbidden URLs ${JSON.stringify(forbiddenRequests)}`,
    );
  }
  const unexpectedVariants = mediaRequests.filter(
    (request) => !PLAYER_MEDIA_ALLOWED_VARIANTS.includes(request.variant),
  );
  if (unexpectedVariants.length > 0) {
    throw new Error(
      `player media requested unexpected variants ${JSON.stringify(unexpectedVariants)}`,
    );
  }

  return {
    boundary:
      "Browser smoke proves the player thread image element renders a tablet-safe variant and the browser requested only tablet/small/thumb image URLs from the mocked media route. Original, full, and desktop media URLs stay out of rendered attributes and request evidence.",
    boundaryTestId: "thread-post-media-boundary-442",
    mediaTestId: "thread-post-media-receipt-442",
    renderedVariant,
    image: imageAttrs,
    requested: mediaRequests.map((request) => ({ ...request })),
    requestedOriginal: false,
    allowedVariants: PLAYER_MEDIA_ALLOWED_VARIANTS,
  };
}

function playerMediaVariantFromPath(pathname) {
  const match = pathname.match(/-(tablet|small|thumb|thumbnail|original|full|desktop)\./);
  return match?.[1] ?? "unknown";
}

function assertNoForbiddenMediaUrl(value, label) {
  if (isForbiddenMediaUrl(value)) {
    throw new Error(`${label} used forbidden media URL ${value}`);
  }
}

function isForbiddenMediaUrl(value) {
  const text = String(value ?? "").toLowerCase();
  return (
    text.includes("-original.") ||
    text.includes("-full.") ||
    text.includes("-desktop.") ||
    text.includes("/original/") ||
    text.includes("/full/") ||
    text.includes("/desktop/")
  );
}

async function drivePlayerPrivateDisclosure(page, { viewport, baseUrl }) {
  const review = page.getByTestId("player-private-review-notification-1");
  await assertHitTarget(review, "player private notification disclosure");
  await assertNavigationAffordance(
    page.getByTestId("player-private-link-notification-1"),
    {
      label: "player private notification review link",
      navigation: "link",
      hrefPath: "/g/midsummer",
      searchParams: { private: "notification-1" },
      baseUrl: page.url(),
    },
  );
  const reviewHref = await page
    .getByTestId("player-private-link-notification-1")
    .getAttribute("href");
  const baseRouteUrl = page.url();
  const detailId = await review.getAttribute("aria-controls");
  if (detailId !== "player-private-detail-notification-1") {
    throw new Error(
      `player private disclosure controls ${detailId}, expected player-private-detail-notification-1`,
    );
  }
  if ((await review.getAttribute("aria-expanded")) !== "false") {
    throw new Error("player private disclosure did not start collapsed");
  }
  if ((await page.getByTestId(detailId).count()) !== 0) {
    throw new Error("player private detail rendered before disclosure was opened");
  }
  const collapsedScreenshot = path.join(
    artifactDir,
    `${viewport.name}-player-private-disclosure-collapsed.png`,
  );
  const collapsedScreenshotPixels = await captureScreenshotEvidence(page, {
    path: collapsedScreenshot,
    label: `player private disclosure collapsed ${viewport.name}`,
    viewport,
  });

  await page.getByTestId("player-private-link-notification-1").click();
  await page.waitForURL((url) => {
    return (
      url.pathname === "/g/midsummer" &&
      url.searchParams.get("private") === "notification-1"
    );
  });
  await page.getByTestId(detailId).waitFor({ state: "visible" });
  const routeReview = await assertUrlAddressedPrivateReview(page, {
    viewport,
    detailId,
    reviewHref,
  });

  await page.goto(baseRouteUrl, { waitUntil: "networkidle" });
  await page.getByTestId("player-private-review-notification-1").waitFor({
    state: "visible",
  });
  if ((await page.getByTestId("player-private-review-notification-1").getAttribute("aria-expanded")) !== "false") {
    throw new Error("player private disclosure did not return to collapsed base route");
  }

  const baseReview = page.getByTestId("player-private-review-notification-1");
  await baseReview.click();
  await page.getByTestId(detailId).waitFor({ state: "visible" });
  if ((await baseReview.getAttribute("aria-expanded")) !== "true") {
    throw new Error("player private disclosure did not report expanded after click");
  }
  const focusedTestId = await page.evaluate(() =>
    document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid"),
  );
  if (focusedTestId !== "player-private-review-notification-1") {
    throw new Error(`player private disclosure focus moved to ${focusedTestId}`);
  }
  const detailText = await page.getByTestId(detailId).innerText();
  if (!detailText.includes("Phase N02")) {
    throw new Error(`player private disclosure detail was ${detailText}`);
  }
  if (/host|moderator|prompt/i.test(detailText)) {
    throw new Error(`player private disclosure leaked host-only language: ${detailText}`);
  }
  const expandedScreenshot = path.join(
    artifactDir,
    `${viewport.name}-player-private-disclosure-expanded.png`,
  );
  const expandedScreenshotPixels = await captureScreenshotEvidence(page, {
    path: expandedScreenshot,
    label: `player private disclosure expanded ${viewport.name}`,
    viewport,
  });

  return {
    reviewTestId: "player-private-review-notification-1",
    reviewLinkTestId: "player-private-link-notification-1",
    reviewHref,
    detailTestId: detailId,
    routeReview,
    collapsed: {
      ariaExpanded: "false",
      detailRendered: false,
      screenshot: path.relative(repoRoot, collapsedScreenshot),
      screenshotPixels: collapsedScreenshotPixels,
      viewport,
    },
    expanded: {
      ariaExpanded: await review.getAttribute("aria-expanded"),
      detailRendered: true,
      screenshot: path.relative(repoRoot, expandedScreenshot),
      screenshotPixels: expandedScreenshotPixels,
      viewport,
    },
    detail: detailText,
    focusStayedOnButton: true,
    hostOnlyCopyExcluded: true,
  };
}

async function assertUrlAddressedPrivateReview(page, { viewport, detailId, reviewHref }) {
  const review = page.getByTestId("player-private-review-notification-1");
  const routeHref = new URL(page.url());
  if ((await review.getAttribute("aria-expanded")) !== "true") {
    throw new Error("player private review URL did not expand the matching disclosure");
  }
  const detailText = await page.getByTestId(detailId).innerText();
  if (!detailText.includes("Phase N02")) {
    throw new Error(`player private review URL detail was ${detailText}`);
  }
  if (/host|moderator|prompt/i.test(detailText)) {
    throw new Error(`player private review URL leaked host-only language: ${detailText}`);
  }
  const screenshot = path.join(
    artifactDir,
    `${viewport.name}-player-private-review-url-notification-1.png`,
  );
  const screenshotPixels = await captureScreenshotEvidence(page, {
    path: screenshot,
    label: `player private review URL ${viewport.name}`,
    viewport,
  });

  return {
    path: routeHref.pathname,
    searchParams: { private: routeHref.searchParams.get("private") },
    reviewHref,
    detailTestId: detailId,
    ariaExpanded: "true",
    detailRendered: true,
    detail: detailText,
    hostOnlyCopyExcluded: true,
    screenshot: path.relative(repoRoot, screenshot),
    screenshotPixels,
    viewport,
  };
}

async function installLiveProjectionHarness(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets = [];
    class FmarchSmokeWebSocket {
      constructor(url) {
        this.url = String(url);
        this.readyState = 0;
        this.listeners = new Map();
        sockets.push(this);
        setTimeout(() => {
          this.readyState = 1;
          this.dispatch("open", {});
          this.dispatch("message", {
            data: JSON.stringify({
              v: 1,
              id: 0,
              body: {
                kind: "Hello",
                body: { protocol_v: 1, server: "smoke", caps: [] },
              },
            }),
          });
        }, 0);
      }

      addEventListener(kind, listener) {
        const listeners = this.listeners.get(kind) ?? [];
        listeners.push(listener);
        this.listeners.set(kind, listeners);
      }

      removeEventListener(kind, listener) {
        const listeners = this.listeners.get(kind) ?? [];
        this.listeners.set(
          kind,
          listeners.filter((candidate) => candidate !== listener),
        );
      }

      send() {}

      close() {
        this.readyState = 3;
        this.dispatch("close", {});
      }

      dispatch(kind, event) {
        for (const listener of this.listeners.get(kind) ?? []) {
          listener(event);
        }
      }
    }

    window.WebSocket = function WebSocket(url, protocols) {
      if (String(url).includes("/ws?game=")) {
        return new FmarchSmokeWebSocket(url);
      }
      return new NativeWebSocket(url, protocols);
    };
    window.WebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    window.WebSocket.OPEN = NativeWebSocket.OPEN;
    window.WebSocket.CLOSING = NativeWebSocket.CLOSING;
    window.WebSocket.CLOSED = NativeWebSocket.CLOSED;

    window.__fmarchSmokeLiveSockets = sockets;
    window.__fmarchEmitLiveProjection = (delta) => {
      const socket = sockets.at(-1);
      if (socket === undefined) {
        throw new Error("no fmarch live projection socket is connected");
      }
      socket.dispatch("message", {
        data: JSON.stringify({
          v: 1,
          id: 44,
          body: { kind: "Delta", body: delta },
        }),
      });
    };
  });
}

async function emitPlayerOfficialThreadPost(page) {
  await page.waitForFunction(() => typeof window.__fmarchEmitLiveProjection === "function");
  await page.evaluate(() => {
    window.__fmarchEmitLiveProjection({
      kind: "ThreadPostsChanged",
      body: {
        game: "midsummer",
        posts: [
          {
            game: "midsummer",
            source_seq: 444,
            stream_seq: 90,
            channel_id: "main",
            author_user: "host",
            author_slot: null,
            phase_id: "D01",
            body: "Official votecount for D01\n- slot_2: 1",
            occurred_at: 1781928000,
          },
        ],
      },
    });
  });
}

async function assertRoleNav(page, expectedNavigation = null) {
  const targets = [];
  for (const id of ["board", "player", "moderator", "admin"]) {
    const locator = page.getByTestId(roleNavTestId(id));
    const expected = expectedNavigation?.[id];
    targets.push({
      label: `role nav ${id}`,
      box:
        expected === undefined
          ? await assertHitTarget(locator, `role nav ${id}`)
          : await assertNavigationAffordance(locator, {
              label: `role nav ${id}`,
              navigation: expected,
            }),
    });
  }
  return targets;
}

async function assertNavigationAffordance(
  locator,
  { label, navigation, hrefPath = null, searchParams = null, baseUrl = null },
) {
  const box = await assertHitTarget(locator, label);
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  const href = await locator.evaluate((node) => node.getAttribute("href"));
  const disabled = await locator.evaluate((node) => node.hasAttribute("disabled"));
  const ariaDisabled = await locator.evaluate((node) =>
    node.getAttribute("aria-disabled"),
  );

  if (navigation === "link") {
    if (tagName !== "a") {
      throw new Error(`${label} rendered ${tagName}, expected anchor link`);
    }
    if (href === null) {
      throw new Error(`${label} rendered without href`);
    }
    if (hrefPath !== null && baseUrl !== null) {
      const resolved = new URL(href, baseUrl);
      if (resolved.pathname !== hrefPath) {
        throw new Error(`${label} linked to ${resolved.pathname}, expected ${hrefPath}`);
      }
      for (const [key, value] of Object.entries(searchParams ?? {})) {
        const actual = resolved.searchParams.get(key);
        if (actual !== value) {
          throw new Error(
            `${label} query ${key}=${actual ?? "null"}, expected ${value}`,
          );
        }
      }
    }
    return box;
  }

  if (navigation === "blocked") {
    if (tagName !== "button") {
      throw new Error(`${label} rendered ${tagName}, expected disabled button`);
    }
    if (href !== null) {
      throw new Error(`${label} rendered blocked control with href ${href}`);
    }
    if (!disabled) {
      throw new Error(`${label} rendered blocked control without disabled attribute`);
    }
    if (ariaDisabled !== "true") {
      throw new Error(`${label} rendered blocked control without aria-disabled=true`);
    }
    const style = await locator.evaluate((node) => {
      const computed = window.getComputedStyle(node);
      return {
        cursor: computed.cursor,
        opacity: Number(computed.opacity),
      };
    });
    if (style.cursor !== "not-allowed") {
      throw new Error(`${label} rendered cursor=${style.cursor}, expected not-allowed`);
    }
    if (!(style.opacity < 1)) {
      throw new Error(`${label} rendered opacity=${style.opacity}, expected below 1`);
    }
    return box;
  }

  throw new Error(`${label} has unsupported navigation expectation ${navigation}`);
}

async function assertStatusLiveRegion(
  locator,
  { label, expectedState = null, expectedAriaLive = null } = {},
) {
  await assertVisibleBox(locator, label);
  const state = await locator.getAttribute("data-state");
  const role = await locator.getAttribute("role");
  const ariaLive = await locator.getAttribute("aria-live");
  const ariaAtomic = await locator.getAttribute("aria-atomic");

  if (role !== "status") {
    throw new Error(`${label} rendered role=${role}, expected status`);
  }
  if (ariaAtomic !== "true") {
    throw new Error(`${label} rendered aria-atomic=${ariaAtomic}, expected true`);
  }
  if (expectedState !== null && state !== expectedState) {
    throw new Error(`${label} rendered state=${state}, expected ${expectedState}`);
  }

  const expectedLive =
    expectedAriaLive ??
    (state === "reject" || state === "error" ? "assertive" : "polite");
  if (ariaLive !== expectedLive) {
    throw new Error(`${label} rendered aria-live=${ariaLive}, expected ${expectedLive}`);
  }

  return {
    state,
    role,
    ariaLive,
    ariaAtomic,
  };
}

async function assertConfirmationDialog(
  locator,
  { label, expectedRole, expectedAriaModal },
) {
  await assertVisibleBox(locator, `${label} confirmation`);
  const role = await locator.getAttribute("role");
  const ariaModal = await locator.getAttribute("aria-modal");
  const ariaDescribedBy = await locator.getAttribute("aria-describedby");

  if (role !== expectedRole) {
    throw new Error(`${label} rendered role=${role}, expected ${expectedRole}`);
  }
  if (ariaModal !== expectedAriaModal) {
    throw new Error(
      `${label} rendered aria-modal=${ariaModal}, expected ${expectedAriaModal}`,
    );
  }
  if (ariaDescribedBy === null || ariaDescribedBy.length === 0) {
    throw new Error(`${label} confirmation did not expose aria-describedby`);
  }

  return {
    role,
    ariaModal,
    ariaDescribedBy,
  };
}

async function assertFocusedTestId(page, expectedTestId, label) {
  const focus = await readFocusedElement(page);
  if (focus?.testId !== expectedTestId) {
    throw new Error(
      `${label} focused ${focus?.testId ?? focus?.label ?? "nothing"}, expected ${expectedTestId}`,
    );
  }
  return {
    testId: focus.testId,
    tagName: focus.tagName,
  };
}

async function assertFocusTraversal(
  page,
  { label, expectedOrder, forbiddenTestIds = [], maxTabs = 24 },
) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  const sequence = [];
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await readFocusedElement(page);
    if (focus === null) {
      continue;
    }
    if (!focus.visibleOutline) {
      throw new Error(
        `${label} focus stop ${focus.label} did not expose a visible focus outline`,
      );
    }
    sequence.push(focus);
    if (containsOrderedFocus(sequence, expectedOrder)) {
      break;
    }
  }

  const focusedTestIds = sequence.map((item) => item.testId).filter(Boolean);
  for (const forbidden of forbiddenTestIds) {
    if (focusedTestIds.includes(forbidden)) {
      throw new Error(`${label} focused disabled or denied control ${forbidden}`);
    }
  }
  if (!containsOrderedFocus(sequence, expectedOrder)) {
    throw new Error(
      `${label} focus order missed ${expectedOrder.join(" -> ")}; saw ${sequence
        .map((item) => item.label)
        .join(" -> ")}`,
    );
  }

  return {
    expectedOrder,
    forbiddenTestIds,
    focusedTestIds,
    sequence: sequence.map((item) => item.label),
  };
}

async function readFocusedElement(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement) || node === document.body) {
      return null;
    }
    const owner = node.closest("[data-testid]");
    const testId = owner?.getAttribute("data-testid") ?? null;
    const actionId = node.closest("[data-action-id]")?.getAttribute("data-action-id") ?? null;
    const dataAction = node.getAttribute("data-action");
    const label =
      testId ??
      dataAction ??
      actionId ??
      node.getAttribute("aria-label") ??
      node.textContent?.trim() ??
      node.tagName.toLowerCase();
    const style = window.getComputedStyle(node);
    const outlineWidth = Number.parseFloat(style.outlineWidth);
    const visibleOutline =
      style.outlineStyle !== "none" && Number.isFinite(outlineWidth) && outlineWidth > 0;
    return {
      label,
      testId,
      tagName: node.tagName.toLowerCase(),
      visibleOutline,
      outlineStyle: style.outlineStyle,
      outlineWidth,
    };
  });
}

function containsOrderedFocus(sequence, expectedOrder) {
  let cursor = 0;
  for (const item of sequence) {
    if (item.testId === expectedOrder[cursor] || item.label === expectedOrder[cursor]) {
      cursor += 1;
      if (cursor === expectedOrder.length) {
        return true;
      }
    }
  }
  return expectedOrder.length === 0;
}

async function assertForbiddenRouteError(page, scenario) {
  const surface = page.getByTestId("route-error-surface");
  await surface.waitFor({ state: "visible" });
  const status = await surface.getAttribute("data-status");
  if (status !== scenario.status) {
    throw new Error(`${scenario.id} rendered error status ${status}`);
  }
  const bodyText = await page.textContent("body");
  if (!bodyText?.includes(scenario.message)) {
    throw new Error(`${scenario.id} did not render forbidden message`);
  }
  const navTargets = await assertRoleNav(page);
  const action = page.getByRole("link", { name: "Back to board" });
  const actionTarget = {
    label: `${scenario.id} back to board`,
    box: await assertHitTarget(action, `${scenario.id} back to board`),
  };
  await assertNoObviousOverlap([...navTargets, actionTarget], {
    role: scenario.id,
    viewport: scenario.viewport,
  });
  return {
    status,
    message: scenario.message,
    overlapCheckedTargets: navTargets.length + 1,
  };
}

async function assertRouteStateScenario(page, { scenario, viewport, baseUrl }) {
  const surface = page.getByTestId(scenario.surfaceTestId);
  await surface.waitFor({ state: "visible" });
  await assertVisibleBox(surface, `${scenario.id} surface`);

  const root = page.getByTestId(scenario.rootTestId);
  const rootBox = await assertVisibleBox(root, `${scenario.id} route state`);
  if (rootBox.height < 220) {
    throw new Error(
      `${scenario.id} route state rendered ${rootBox.height}px high, expected at least 220px`,
    );
  }
  const dataSurface = await root.getAttribute("data-surface");
  const dataState = await root.getAttribute("data-state");
  if (dataSurface !== scenario.surface) {
    throw new Error(
      `${scenario.id} rendered data-surface=${dataSurface}, expected ${scenario.surface}`,
    );
  }
  if (dataState !== scenario.state) {
    throw new Error(
      `${scenario.id} rendered data-state=${dataState}, expected ${scenario.state}`,
    );
  }

  const statusRegion = await assertStatusLiveRegion(
    page.getByTestId(scenario.statusTestId),
    {
      label: `${scenario.id} route-state status`,
      expectedState: scenario.statusState,
      expectedAriaLive: scenario.ariaLive,
    },
  );
  const actionBox = await assertNavigationAffordance(
    page.getByTestId(scenario.actionTestId),
    {
      label: `${scenario.id} route-state action`,
      navigation: "link",
      hrefPath: "/",
      baseUrl,
    },
  );
  const navTargets = await assertRoleNav(page, scenario.nav);
  await assertNoObviousOverlap(
    [
      ...navTargets,
      {
        label: `${scenario.id} route-state action`,
        box: actionBox,
      },
    ],
    {
      role: scenario.id,
      viewport: viewport.name,
    },
  );

  const focusTraversal = await assertFocusTraversal(page, {
    label: `${scenario.id} ${viewport.name}`,
    ...scenario.focus,
  });

  return {
    scenario: scenario.id,
    role: scenario.role,
    viewport,
    path: scenario.path,
    rootTestId: scenario.rootTestId,
    statusRegion,
    focusTraversal,
    routeStateMinBlockPx: 220,
    overlapCheckedTargets: navTargets.length + 1,
  };
}

async function assertVisibleBox(locator, label) {
  const box = await locator.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} did not render a visible box`);
  }
  return box;
}

async function assertHitTarget(locator, label) {
  const box = await assertVisibleBox(locator, label);
  if (box.width < 44 || box.height < 44) {
    throw new Error(
      `${label} rendered ${box.width}x${box.height}, expected at least 44x44`,
    );
  }
  return box;
}

async function assertThumbZones(page, role, { viewport }) {
  const zones = [];
  const targets = [];
  for (const zone of role.thumbZones ?? []) {
    const zoneLocator = page.getByTestId(zone.testId);
    const zoneBox = await assertVisibleBox(
      zoneLocator,
      `${role.id} ${zone.testId}`,
    );
    const actualZone = await zoneLocator.getAttribute("data-thumb-zone");
    if (actualZone !== zone.zone) {
      throw new Error(
        `${role.id} ${viewport.name} ${zone.testId} thumb zone ${actualZone}, expected ${zone.zone}`,
      );
    }
    const targetSummaries = [];
    for (const selector of zone.targetSelectors) {
      const target = zoneLocator.locator(selector);
      const count = await target.count();
      if (count !== 1) {
        throw new Error(
          `${role.id} ${viewport.name} ${zone.testId} selector ${selector} resolved ${count} targets`,
        );
      }
      const box = await assertHitTarget(
        target,
        `${role.id} ${zone.testId} ${selector}`,
      );
      targets.push({
        label: `${role.id} ${zone.testId} ${selector}`,
        box,
      });
      targetSummaries.push({
        selector,
        box,
      });
    }
    zones.push({
      testId: zone.testId,
      thumbZone: zone.zone,
      targetCount: targetSummaries.length,
      zoneBox,
      targets: targetSummaries,
    });
  }
  return { zones, targets };
}

async function assertNoObviousOverlap(targets, context) {
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex];
      const right = targets[rightIndex];
      const area = overlapArea(left.box, right.box);
      if (area > 1 && !containsBox(left.box, right.box) && !containsBox(right.box, left.box)) {
        throw new Error(
          `${context.role} ${context.viewport} touch targets overlap: ${left.label} and ${right.label}`,
        );
      }
    }
  }
}

function overlapArea(left, right) {
  const x = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const y = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return x * y;
}

function containsBox(outer, inner) {
  const tolerance = 1;
  return (
    inner.x + tolerance >= outer.x &&
    inner.y + tolerance >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

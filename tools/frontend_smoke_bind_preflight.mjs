import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

export const STATIC_ROLE_FALLBACK_ENV = "FMARCH_ALLOW_STATIC_ROLE_FALLBACK";

export async function preflightLocalhostBindOrExit({
  host = "127.0.0.1",
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName,
  stage = "localhost-bind-preflight",
}) {
  try {
    await verifyLocalhostBind(host);
  } catch (error) {
    if (!isLocalhostBindDenied(error)) {
      throw error;
    }
    await handleLocalhostBindFailure({
      error,
      repoRoot,
      artifactDir,
      evidencePath,
      smokeName,
      stage,
    });
    process.exit(0);
  }
}

export async function handleLocalhostBindFailure({
  error,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName,
  stage,
}) {
  if (!isLocalhostBindDenied(error)) {
    return false;
  }

  const allowStaticFallback = process.env[STATIC_ROLE_FALLBACK_ENV] === "1";
  const fallback = {
    command:
      "npm run test:frontend-static-role-contract && npm run test:frontend-role-dom-smoke && npm run test:frontend-role-render-smoke",
    env: STATIC_ROLE_FALLBACK_ENV,
    allowed: allowStaticFallback,
    artifact: "target/frontend-static-role-contract/role-contract.json",
    domArtifact: "target/frontend-role-dom-smoke/dom-smoke.json",
    renderArtifact: "target/frontend-role-render-smoke/render-smoke.json",
  };

  await writeBindArtifact({
    artifactDir,
    evidencePath,
    smokeName,
    stage,
    status: allowStaticFallback ? "static-fallback-running" : "blocked",
    error,
    fallback,
  });

  if (!allowStaticFallback) {
    error.message = `${smokeName} could not bind localhost for browser proof. Wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}. Set ${STATIC_ROLE_FALLBACK_ENV}=1 to run the static role contract fallback.\n${error.message}`;
    throw error;
  }

  const staticRoleContract = await runStaticFallback(repoRoot, fallback.artifact);
  const domSmoke = await runDomFallback(repoRoot, fallback.domArtifact);
  const renderSmoke = await runRenderFallback(repoRoot, fallback.renderArtifact);
  await writeBindArtifact({
    artifactDir,
    evidencePath,
    smokeName,
    stage,
    status:
      renderSmoke.status === "passed"
        ? "static-render-fallback-passed"
        : "static-dom-fallback-passed",
    error,
    fallback,
    staticRoleContract,
    domSmoke,
    renderSmoke,
  });
  console.log(
    `${smokeName} skipped localhost bind and used ${fallback.command}; wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}`,
  );
  return true;
}

export function isLocalhostBindDenied(error) {
  return (
    error?.code === "EPERM" &&
    error?.syscall === "listen" &&
    (error?.address === "127.0.0.1" ||
      error?.address === "localhost" ||
      error?.address === undefined)
  );
}

async function verifyLocalhostBind(host) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      server.close(resolve);
    });
  });
}

async function writeBindArtifact({
  artifactDir,
  evidencePath,
  smokeName,
  stage,
  status,
  error,
  fallback,
  staticRoleContract = null,
  domSmoke = null,
  renderSmoke = null,
}) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        status,
        smoke: smokeName,
        stage,
        at: new Date().toISOString(),
        boundary:
          renderSmoke === null
            ? "Browser smoke did not exercise Chromium or pixels because localhost bind was denied before the app could run."
            : renderSmoke.status === "passed"
              ? "Dev-server browser smoke did not run because localhost bind was denied. Static route contracts, no-browser SSR DOM evidence, and no-bind Chromium SSR render evidence were recorded instead; hydrated navigation, command dispatch, WebSocket behavior, and real dev-server focus traversal remain unproven."
              : "Dev-server browser smoke did not run because localhost bind was denied. Static route contracts and no-browser SSR DOM evidence were recorded, but no-bind Chromium SSR render proof was blocked before launch.",
        error: {
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
          address: error.address,
          port: error.port,
          message: error.message,
        },
        fallback,
        ...(staticRoleContract === null ? {} : { staticRoleContract }),
        ...(domSmoke === null ? {} : { domSmoke }),
        ...(renderSmoke === null ? {} : { renderSmoke }),
      },
      null,
      2,
    )}\n`,
  );
}

async function runStaticFallback(repoRoot, artifact) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_static_role_contract.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`static role contract fallback failed with exit ${code}`);
  }
  const staticEvidence = JSON.parse(
    await readFile(path.join(repoRoot, artifact), "utf8"),
  );
  return {
    status: staticEvidence.status,
    proof: staticEvidence.proof,
    boundary: staticEvidence.boundary,
    appShellContract: staticEvidence.appShellContract,
    linkAffordanceCoverage: staticEvidence.linkAffordanceCoverage,
    navFocusCoverage: staticEvidence.navFocusCoverage,
    routeStateCoverage: staticEvidence.routeStateCoverage,
    routeStateFixtureCoverage: staticEvidence.routeStateFixtureCoverage,
    firstViewportSmokeCoverage: staticEvidence.firstViewportSmokeCoverage,
    firstViewportLayoutContract: staticEvidence.firstViewportLayoutContract,
    confirmationCoverage: staticEvidence.confirmationCoverage,
  };
}

async function runDomFallback(repoRoot, artifact) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_role_dom_smoke.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend role DOM fallback failed with exit ${code}`);
  }
  const domEvidence = JSON.parse(
    await readFile(path.join(repoRoot, artifact), "utf8"),
  );
  return {
    status: domEvidence.status,
    proof: domEvidence.proof,
    boundary: domEvidence.boundary,
    surfaceCount: domEvidence.surfaces.length,
    routeStateCount: domEvidence.routeStates.length,
    surfaces: domEvidence.surfaces.map((surface) => ({
      id: surface.id,
      role: surface.role,
      path: surface.path,
      surfaceTestId: surface.surfaceTestId,
      touchTargets: surface.touchTargets,
      htmlBytes: surface.htmlBytes,
    })),
    errorSurface: domEvidence.errorSurface,
    feedbackTraces: domEvidence.feedbackTraces,
    routeStates: domEvidence.routeStates.map((scenario) => ({
      id: scenario.id,
      role: scenario.role,
      state: scenario.state,
      rootTestId: scenario.rootTestId,
      statusTestId: scenario.statusTestId,
      actionTestId: scenario.actionTestId,
      statusState: scenario.statusState,
      ariaLive: scenario.ariaLive,
      htmlBytes: scenario.htmlBytes,
    })),
  };
}

async function runRenderFallback(repoRoot, artifact) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_role_render_smoke.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend role render fallback failed with exit ${code}`);
  }
  const renderEvidence = JSON.parse(
    await readFile(path.join(repoRoot, artifact), "utf8"),
  );
  return {
    status: renderEvidence.status,
    proof: renderEvidence.proof,
    boundary: renderEvidence.boundary,
    ...(renderEvidence.status !== "passed"
      ? {
          routeStateRenderArtifact: renderEvidence.routeStateRenderArtifact,
          error: renderEvidence.error,
        }
      : {}),
    ...(renderEvidence.status === "passed"
      ? {
          viewports: renderEvidence.viewports,
          surfaceCount: renderEvidence.surfaces.length,
          feedbackRailCount: renderEvidence.feedbackRails.length,
          routeStateCount: renderEvidence.routeStates.length,
          surfaceScreenshots: renderEvidence.surfaces.map((surface) => ({
            id: surface.id,
            viewport: surface.viewport,
            screenshot: surface.screenshot,
            screenshotPixels: surface.screenshotPixels,
          })),
          feedbackRailScreenshots: renderEvidence.feedbackRails.map((rail) => ({
            id: rail.id,
            viewport: rail.viewport,
            screenshot: rail.screenshot,
            screenshotPixels: rail.screenshotPixels,
          })),
          routeStateScreenshots: renderEvidence.routeStates.map((scenario) => ({
            id: scenario.id,
            viewport: scenario.viewport,
            screenshot: scenario.screenshot,
            screenshotPixels: scenario.screenshotPixels,
          })),
        }
      : {}),
  };
}

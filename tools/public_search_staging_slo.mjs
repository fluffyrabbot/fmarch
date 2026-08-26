import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLIC_SEARCH_STAGING_SLO_RECEIPT_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSloPath = path.join(
  repoRoot,
  "docs",
  "ops",
  "public-search-staging-slo.json",
);
const defaultOutputPath = path.join(
  repoRoot,
  "target",
  "public-search-staging-slo",
  "receipt.json",
);
const requiredSearchFields = Object.freeze([
  "filter",
  "page",
  "limit",
  "result_count",
  "has_next_page",
  "selectivity_signal_basis_points",
  "elapsed_ms",
]);

export function buildPublicSearchStagingSloReceipt({
  slo,
  deployment,
  applicationLogRows,
  httpLogRows,
  expectedCommit,
  now = new Date(),
}) {
  validateSlo(slo);
  const evaluatedAt = validDate(now, "evaluation clock");
  const deploymentCreatedAt = validDate(
    deployment?.createdAt,
    "deployment creation time",
  );
  const latencyWindowStart = new Date(
    evaluatedAt.getTime() - slo.latency.window_minutes * 60_000,
  );
  const availabilityWindowStart = new Date(
    evaluatedAt.getTime() - slo.availability.window_days * 86_400_000,
  );
  const deploymentStatus = check(
    "deployment-success",
    deployment?.status === "SUCCESS" ? "passed" : "failed",
    `expected SUCCESS, observed ${deployment?.status ?? "missing"}`,
  );
  const deploymentCommit = check(
    "deployment-commit-attribution",
    deployment?.meta?.commitHash === expectedCommit ? "passed" : "failed",
    deployment?.meta?.commitHash === expectedCommit
      ? "Railway deployment is attributed to the expected commit"
      : "Railway deployment commit does not match the expected commit",
  );
  const deploymentEnvironment = check(
    "deployment-environment-attribution",
    slo.environment === "staging" ? "passed" : "failed",
    `receipt target is ${slo.environment}`,
  );

  const parsedSearch = applicationLogRows.map((row, index) =>
    parsePublicSearchLog(row, slo, index),
  );
  const latencyRows = parsedSearch.filter(
    (row) => row.timestamp >= latencyWindowStart && row.timestamp <= evaluatedAt,
  );
  const privacyViolations = parsedSearch.flatMap((row) => row.privacyViolations);
  const malformedRows = parsedSearch.filter((row) => row.parseErrors.length > 0);
  const latencyValues = latencyRows
    .filter((row) => row.parseErrors.length === 0)
    .map((row) => row.elapsedMs);
  const latencyP95Ms = percentile(latencyValues, slo.latency.percentile);
  const latencyCoverageRatio = coverageRatio({
    deploymentCreatedAt,
    windowStart: latencyWindowStart,
    windowEnd: evaluatedAt,
  });
  const latencyCoverage = check(
    "latency-window-coverage",
    latencyCoverageRatio === 1 ? "passed" : "insufficient",
    `deployment covers ${(latencyCoverageRatio * 100).toFixed(3)}% of the configured latency window`,
  );
  const latencySamples = check(
    "latency-minimum-samples",
    latencyValues.length >= slo.latency.minimum_samples ? "passed" : "insufficient",
    `${latencyValues.length}/${slo.latency.minimum_samples} required samples`,
  );
  const latencyObjective = check(
    "latency-objective",
    latencyValues.length < slo.latency.minimum_samples
      ? "insufficient"
      : latencyP95Ms <= slo.latency.objective_ms
        ? "passed"
        : "failed",
    latencyP95Ms === null
      ? "no latency percentile is available"
      : `p${slo.latency.percentile} ${latencyP95Ms} ms; objective ${slo.latency.objective_ms} ms`,
  );
  const telemetryShape = check(
    "telemetry-shape",
    malformedRows.length > 0
      ? "failed"
      : parsedSearch.length === 0
        ? "insufficient"
        : "passed",
    malformedRows.length > 0
      ? `${malformedRows.length} application log rows were malformed`
      : parsedSearch.length === 0
        ? "no application search events were available"
        : `${parsedSearch.length} bounded application search events parsed`,
  );
  const telemetryPrivacy = check(
    "telemetry-privacy",
    privacyViolations.length > 0
      ? "failed"
      : parsedSearch.length === 0
        ? "insufficient"
        : "passed",
    privacyViolations.length > 0
      ? `${privacyViolations.length} forbidden telemetry fields were observed`
      : parsedSearch.length === 0
        ? "no runtime events were available for privacy verification"
        : "forbidden telemetry fields were absent",
  );

  const availabilityRows = httpLogRows
    .map((row, index) => parseHttpLog(row, index))
    .filter(
      (row) =>
        row.path === slo.route &&
        row.deploymentId === deployment.id &&
        row.timestamp >= availabilityWindowStart &&
        row.timestamp <= evaluatedAt,
    );
  const goodAvailabilityRows = availabilityRows.filter(
    (row) => row.status <= slo.availability.good_status_upper_bound,
  );
  const availabilityRatio =
    availabilityRows.length === 0
      ? null
      : Number((goodAvailabilityRows.length / availabilityRows.length).toFixed(6));
  const availabilityCoverageRatio = coverageRatio({
    deploymentCreatedAt,
    windowStart: availabilityWindowStart,
    windowEnd: evaluatedAt,
  });
  const availabilityCoverage = check(
    "availability-window-coverage",
    availabilityCoverageRatio === 1 ? "passed" : "insufficient",
    `deployment covers ${(availabilityCoverageRatio * 100).toFixed(3)}% of the configured availability window`,
  );
  const availabilitySamples = check(
    "availability-samples",
    availabilityRows.length > 0 ? "passed" : "insufficient",
    `${availabilityRows.length} attributed route samples`,
  );
  const availabilityObjective = check(
    "availability-objective",
    availabilityRows.length === 0 || availabilityCoverageRatio < 1
      ? "insufficient"
      : availabilityRatio >= slo.availability.objective_ratio
        ? "passed"
        : "failed",
    availabilityRatio === null
      ? "no availability ratio is available"
      : `availability ${availabilityRatio}; objective ${slo.availability.objective_ratio}`,
  );

  const checks = [
    deploymentStatus,
    deploymentCommit,
    deploymentEnvironment,
    latencyCoverage,
    latencySamples,
    latencyObjective,
    telemetryShape,
    telemetryPrivacy,
    availabilityCoverage,
    availabilitySamples,
    availabilityObjective,
  ];
  const status = checks.some((item) => item.status === "failed")
    ? "failed"
    : checks.some((item) => item.status === "insufficient")
      ? "insufficient"
      : "passed";
  const receipt = {
    version: PUBLIC_SEARCH_STAGING_SLO_RECEIPT_VERSION,
    proof: "fmarch-public-search-staging-slo",
    status,
    generatedAt: evaluatedAt.toISOString(),
    proofBoundary:
      "Read-only evaluation of one exact Railway staging API deployment. The receipt retains deployment attribution and aggregate counts only; raw application and HTTP logs, request identifiers, addresses, user agents, and query material are never persisted. A fresh deployment or sparse traffic is insufficient, not passing.",
    target: {
      environment: slo.environment,
      route: slo.route,
      projectId: slo.railway_target.project_id,
      environmentId: slo.railway_target.environment_id,
      serviceId: slo.railway_target.service_id,
    },
    deployment: {
      id: deployment?.id ?? null,
      status: deployment?.status ?? null,
      createdAt: deploymentCreatedAt.toISOString(),
      commitHash: deployment?.meta?.commitHash ?? null,
      expectedCommit,
      exactCommitAttributed: deployment?.meta?.commitHash === expectedCommit,
    },
    latency: {
      event: slo.latency.event,
      windowStart: latencyWindowStart.toISOString(),
      windowEnd: evaluatedAt.toISOString(),
      deploymentCoverageRatio: latencyCoverageRatio,
      sampleCount: latencyValues.length,
      minimumSamples: slo.latency.minimum_samples,
      percentile: slo.latency.percentile,
      observedMs: latencyP95Ms,
      objectiveMs: slo.latency.objective_ms,
      byFilter: countBy(latencyRows, (row) => row.filter),
      byPage: countBy(latencyRows, (row) => row.page),
      bySelectivityBand: countBy(latencyRows, selectivityBand),
    },
    availability: {
      event: slo.availability.event,
      windowStart: availabilityWindowStart.toISOString(),
      windowEnd: evaluatedAt.toISOString(),
      deploymentCoverageRatio: availabilityCoverageRatio,
      sampleCount: availabilityRows.length,
      goodCount: goodAvailabilityRows.length,
      badCount: availabilityRows.length - goodAvailabilityRows.length,
      observedRatio: availabilityRatio,
      objectiveRatio: slo.availability.objective_ratio,
      statusCounts: countBy(availabilityRows, (row) => String(row.status)),
      declaredExcludedPeriodKinds: slo.availability.excluded_periods,
      appliedExcludedPeriods: [],
    },
    privacy: {
      status: telemetryPrivacy.status,
      forbiddenFields: slo.privacy.forbidden_fields,
      violationCount: privacyViolations.length,
      malformedEventCount: malformedRows.length,
      rawLogsPersisted: false,
    },
    evidence: {
      applicationRowsObserved: applicationLogRows.length,
      httpRowsObserved: httpLogRows.length,
      applicationRowsAttributed: parsedSearch.length,
      httpRowsAttributed: availabilityRows.length,
    },
    checks,
  };
  return assertPublicSearchStagingSloReceipt(receipt);
}

export function assertPublicSearchStagingSloReceipt(receipt) {
  if (
    receipt?.version !== PUBLIC_SEARCH_STAGING_SLO_RECEIPT_VERSION ||
    receipt.proof !== "fmarch-public-search-staging-slo" ||
    !["passed", "failed", "insufficient"].includes(receipt.status)
  ) {
    throw new Error("public-search staging SLO receipt shape drifted");
  }
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== 11) {
    throw new Error("public-search staging SLO check inventory drifted");
  }
  const derivedStatus = receipt.checks.some((item) => item.status === "failed")
    ? "failed"
    : receipt.checks.some((item) => item.status === "insufficient")
      ? "insufficient"
      : "passed";
  if (receipt.status !== derivedStatus) {
    throw new Error("public-search staging SLO status is not derived from checks");
  }
  if (
    receipt.privacy?.rawLogsPersisted !== false ||
    JSON.stringify(receipt).includes("srcIp") ||
    JSON.stringify(receipt).includes("requestId") ||
    JSON.stringify(receipt).includes("clientUa")
  ) {
    throw new Error("public-search staging SLO receipt retained raw request evidence");
  }
  return receipt;
}

export function parseRailwayNdjson(output, label) {
  const trimmed = String(output).trim();
  if (trimmed === "") return [];
  return trimmed.split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${label} row ${index + 1} was not JSON`);
    }
  });
}

function parsePublicSearchLog(row, slo, index) {
  const message = String(row?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const parseErrors = [];
  const filter = quotedField(message, "filter");
  const page = quotedField(message, "page");
  const limit = numericField(message, "limit");
  const resultCount = numericField(message, "result_count");
  const hasNextPage = booleanField(message, "has_next_page");
  const selectivitySignal = numericField(
    message,
    "selectivity_signal_basis_points",
  );
  const elapsedMs = numericField(message, slo.latency.field);
  const event = quotedField(message, "event");
  const values = {
    filter,
    page,
    limit,
    result_count: resultCount,
    has_next_page: hasNextPage,
    selectivity_signal_basis_points: selectivitySignal,
    elapsed_ms: elapsedMs,
  };
  for (const field of requiredSearchFields) {
    if (values[field] === null) parseErrors.push(`missing ${field}`);
  }
  if (event !== slo.latency.event) parseErrors.push("event name mismatch");
  if (filter !== null && !["all", "discussions", "profiles", "games"].includes(filter)) {
    parseErrors.push("filter is unbounded");
  }
  if (page !== null && !["first", "continuation"].includes(page)) {
    parseErrors.push("page is unbounded");
  }
  if (limit !== null && (limit < 1 || limit > 50)) parseErrors.push("limit is unbounded");
  if (resultCount !== null && (resultCount < 0 || resultCount > 50)) {
    parseErrors.push("result count is unbounded");
  }
  if (selectivitySignal !== null && (selectivitySignal < 0 || selectivitySignal > 10_000)) {
    parseErrors.push("selectivity signal is unbounded");
  }
  const privacyViolations = slo.privacy.forbidden_fields.filter((field) =>
    new RegExp(`(?:^|\\s)${escapeRegExp(field)}\\s*=`).test(message),
  );
  return {
    index,
    timestamp: validDate(row?.timestamp, `application log row ${index + 1} timestamp`),
    filter,
    page,
    limit,
    resultCount,
    hasNextPage,
    selectivitySignal,
    elapsedMs,
    parseErrors,
    privacyViolations,
  };
}

function parseHttpLog(row, index) {
  const status = Number(row?.httpStatus);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(`HTTP log row ${index + 1} has an invalid status`);
  }
  return {
    timestamp: validDate(row?.timestamp, `HTTP log row ${index + 1} timestamp`),
    path: String(row?.path ?? ""),
    deploymentId: String(row?.deploymentId ?? ""),
    status,
  };
}

function validateSlo(slo) {
  if (
    slo?.version !== 1 ||
    slo.environment !== "staging" ||
    slo.route !== "/search" ||
    !slo.railway_target?.project_id ||
    !slo.railway_target?.environment_id ||
    !slo.railway_target?.service_id
  ) {
    throw new Error("public-search staging SLO target drifted");
  }
  if (
    slo.latency?.event !== "public_search_completed" ||
    slo.latency?.field !== "elapsed_ms" ||
    !Number.isInteger(slo.latency?.minimum_samples) ||
    slo.latency.minimum_samples < 1
  ) {
    throw new Error("public-search staging latency SLO drifted");
  }
  if (
    slo.availability?.event !== "http_request_completed" ||
    !Array.isArray(slo.availability?.excluded_periods) ||
    !Array.isArray(slo.privacy?.forbidden_fields)
  ) {
    throw new Error("public-search staging availability/privacy SLO drifted");
  }
}

function coverageRatio({ deploymentCreatedAt, windowStart, windowEnd }) {
  const start = Math.max(deploymentCreatedAt.getTime(), windowStart.getTime());
  const duration = windowEnd.getTime() - windowStart.getTime();
  return Number(
    Math.max(0, Math.min(1, (windowEnd.getTime() - start) / duration)).toFixed(6),
  );
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    if (key === null || key === undefined) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function selectivityBand(row) {
  if (row.selectivitySignal === 0) return "empty";
  if (row.selectivitySignal < 10_000) return "partial-page";
  return row.hasNextPage ? "full-page-with-more" : "full-page-terminal";
}

function quotedField(message, name) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(name)}="([^"]*)"`).exec(message)?.[1] ?? null;
}

function numericField(message, name) {
  const value = new RegExp(`(?:^|\\s)${escapeRegExp(name)}=(-?\\d+(?:\\.\\d+)?)`).exec(
    message,
  )?.[1];
  return value === undefined ? null : Number(value);
}

function booleanField(message, name) {
  const value = new RegExp(`(?:^|\\s)${escapeRegExp(name)}=(true|false)`).exec(message)?.[1];
  return value === undefined ? null : value === "true";
}

function validDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`);
  return date;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function check(id, status, detail) {
  return { id, status, detail };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const sloPath = path.resolve(args.slo ?? defaultSloPath);
  const outputPath = path.resolve(
    args.output ?? env.FMARCH_PUBLIC_SEARCH_SLO_OUTPUT ?? defaultOutputPath,
  );
  const slo = JSON.parse(await readFile(sloPath, "utf8"));
  validateSlo(slo);
  const expectedCommit =
    args.expectedCommit ?? commandText("git", ["rev-parse", "HEAD"], env);
  const target = slo.railway_target;
  const deploymentOutput = railwayText(
    [
      "deployment",
      "list",
      "--project",
      target.project_id,
      "--environment",
      target.environment_id,
      "--service",
      target.service_id,
      "--limit",
      "1",
      "--json",
    ],
    env,
  );
  const deployment = JSON.parse(deploymentOutput)[0];
  if (!deployment) throw new Error("Railway returned no staging API deployment");
  const applicationLogRows = parseRailwayNdjson(
    railwayText(
      [
        "logs",
        deployment.id,
        "--project",
        target.project_id,
        "--environment",
        target.environment_id,
        "--service",
        target.service_id,
        "--since",
        `${slo.latency.window_minutes}m`,
        "--filter",
        slo.latency.event,
        "--json",
      ],
      env,
    ),
    "Railway application log",
  );
  const httpLogRows = parseRailwayNdjson(
    railwayText(
      [
        "logs",
        "--http",
        "--project",
        target.project_id,
        "--environment",
        target.environment_id,
        "--service",
        target.service_id,
        "--since",
        `${slo.availability.window_days}d`,
        "--path",
        slo.route,
        "--filter",
        `@deploymentId:${deployment.id}`,
        "--json",
      ],
      env,
    ),
    "Railway HTTP log",
  );
  const receipt = buildPublicSearchStagingSloReceipt({
    slo,
    deployment,
    applicationLogRows,
    httpLogRows,
    expectedCommit,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        deployment: receipt.deployment,
        latency: receipt.latency,
        availability: receipt.availability,
        receipt: path.relative(repoRoot, outputPath),
      },
      null,
      2,
    ),
  );
  if (receipt.status === "failed") return 1;
  if (receipt.status === "insufficient" && !args.allowInsufficient) return 2;
  return 0;
}

function railwayText(args, env) {
  return commandText(env.FMARCH_RAILWAY_BIN ?? "railway", args, env);
}

function commandText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout).trim().slice(-2_000);
    throw new Error(`${path.basename(command)} ${args[0]} failed: ${diagnostic}`);
  }
  return result.stdout.trim();
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") args.help = true;
    else if (value === "--allow-insufficient") args.allowInsufficient = true;
    else if (value === "--slo") args.slo = requireValue(argv, ++index, value);
    else if (value === "--output") args.output = requireValue(argv, ++index, value);
    else if (value === "--expected-commit") {
      args.expectedCommit = requireValue(argv, ++index, value);
    } else throw new Error(`unknown public-search SLO argument: ${value}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printUsage() {
  console.log(`Usage: node tools/public_search_staging_slo.mjs [options]

Options:
  --slo PATH             SLO contract (default: docs/ops/public-search-staging-slo.json)
  --output PATH          Receipt path (default: target/public-search-staging-slo/receipt.json)
  --expected-commit SHA  Exact Railway deployment commit (default: HEAD)
  --allow-insufficient   Exit zero while retaining an insufficient receipt
  --help                 Show this help
`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`public-search staging SLO evaluation failed: ${error.message}`);
      process.exitCode = 1;
    });
}

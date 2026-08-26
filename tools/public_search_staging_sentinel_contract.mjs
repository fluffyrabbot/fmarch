export const PUBLIC_SEARCH_STAGING_SENTINEL_RECEIPT_VERSION = 1;

const requiredSearchFields = Object.freeze([
  "filter",
  "page",
  "limit",
  "result_count",
  "has_next_page",
  "selectivity_signal_basis_points",
  "elapsed_ms",
  "traffic_class",
]);

export function buildPublicSearchStagingSentinelReceipt({
  contract,
  deployment,
  applicationLogRows,
  expectedCommit,
  now = new Date(),
}) {
  validatePublicSearchStagingSentinel(contract);
  const evaluatedAt = validDate(now, "evaluation clock");
  const deploymentCreatedAt = validDate(
    deployment?.createdAt,
    "deployment creation time",
  );
  const configuredWindowStart = new Date(
    evaluatedAt.getTime() - contract.latency.window_minutes * 60_000,
  );
  const windowStart = new Date(
    Math.max(configuredWindowStart.getTime(), deploymentCreatedAt.getTime()),
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
    contract.environment === "staging" ? "passed" : "failed",
    `receipt target is ${contract.environment}`,
  );

  const parsedSearch = applicationLogRows.map((row, index) =>
    parsePublicSearchLog(row, contract, index),
  );
  const latencyRows = parsedSearch.filter(
    (row) => row.timestamp >= windowStart && row.timestamp <= evaluatedAt,
  );
  const privacyViolations = parsedSearch.flatMap((row) => row.privacyViolations);
  const malformedRows = parsedSearch.filter((row) => row.parseErrors.length > 0);
  const latencyValues = latencyRows
    .filter((row) => row.parseErrors.length === 0)
    .map((row) => row.elapsedMs);
  const latencyP95Ms = percentile(latencyValues, contract.latency.percentile);
  const nonEmptyLatencySamples = latencyRows.filter(
    (row) => row.parseErrors.length === 0 && row.selectivitySignal > 0,
  ).length;

  const latencySamples = check(
    "latency-minimum-samples",
    latencyValues.length >= contract.latency.minimum_samples ? "passed" : "insufficient",
    `${latencyValues.length}/${contract.latency.minimum_samples} required exact-deployment samples`,
  );
  const latencySelectivityCoverage = check(
    "latency-selectivity-coverage",
    nonEmptyLatencySamples >= contract.latency.minimum_non_empty_samples
      ? "passed"
      : "insufficient",
    `${nonEmptyLatencySamples}/${contract.latency.minimum_non_empty_samples} required non-empty result samples`,
  );
  const latencyObjective = check(
    "latency-objective",
    latencyValues.length < contract.latency.minimum_samples
      ? "insufficient"
      : latencyP95Ms <= contract.latency.objective_ms
        ? "passed"
        : "failed",
    latencyP95Ms === null
      ? "no latency percentile is available"
      : `p${contract.latency.percentile} ${latencyP95Ms} ms; objective ${contract.latency.objective_ms} ms`,
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

  const checks = [
    deploymentStatus,
    deploymentCommit,
    deploymentEnvironment,
    latencySamples,
    latencySelectivityCoverage,
    latencyObjective,
    telemetryShape,
    telemetryPrivacy,
  ];
  const receipt = {
    version: PUBLIC_SEARCH_STAGING_SENTINEL_RECEIPT_VERSION,
    proof: "fmarch-public-search-staging-sentinel",
    status: derivedStatus(checks),
    generatedAt: evaluatedAt.toISOString(),
    proofBoundary:
      "One read-only post-deploy evaluation of exact-commit Railway staging application logs after the bounded canary. It proves deployment attribution, a non-empty source-corpus search, latency, telemetry shape, and telemetry privacy. It is not a rolling availability SLO. The receipt retains bounded aggregates only; raw logs, request identifiers, addresses, user agents, and query material are never persisted.",
    target: {
      environment: contract.environment,
      route: contract.route,
      projectId: contract.railway_target.project_id,
      environmentId: contract.railway_target.environment_id,
      serviceId: contract.railway_target.service_id,
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
      scope: "exact-deployment-post-canary",
      event: contract.latency.event,
      windowStart: windowStart.toISOString(),
      windowEnd: evaluatedAt.toISOString(),
      sampleCount: latencyValues.length,
      minimumSamples: contract.latency.minimum_samples,
      nonEmptySampleCount: nonEmptyLatencySamples,
      minimumNonEmptySamples: contract.latency.minimum_non_empty_samples,
      percentile: contract.latency.percentile,
      observedMs: latencyP95Ms,
      objectiveMs: contract.latency.objective_ms,
      byTrafficClass: countBy(latencyRows, (row) => row.trafficClass),
      byFilter: countBy(latencyRows, (row) => row.filter),
      byPage: countBy(latencyRows, (row) => row.page),
      bySelectivityBand: countBy(latencyRows, selectivityBand),
    },
    privacy: {
      status: telemetryPrivacy.status,
      forbiddenFields: contract.privacy.forbidden_fields,
      violationCount: privacyViolations.length,
      malformedEventCount: malformedRows.length,
      rawLogsPersisted: false,
      canaryTrafficIsAuthenticatedIdentity: false,
    },
    evidence: {
      applicationRowsObserved: applicationLogRows.length,
      applicationRowsAttributed: parsedSearch.length,
    },
    checks,
  };
  return assertPublicSearchStagingSentinelReceipt(receipt);
}

export function assertPublicSearchStagingSentinelReceipt(receipt) {
  if (
    receipt?.version !== PUBLIC_SEARCH_STAGING_SENTINEL_RECEIPT_VERSION ||
    receipt.proof !== "fmarch-public-search-staging-sentinel" ||
    !["passed", "failed", "insufficient"].includes(receipt.status)
  ) {
    throw new Error("public-search staging sentinel receipt shape drifted");
  }
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== 8) {
    throw new Error("public-search staging sentinel check inventory drifted");
  }
  if (receipt.status !== derivedStatus(receipt.checks)) {
    throw new Error("public-search staging sentinel status is not derived from checks");
  }
  const serialized = JSON.stringify(receipt);
  if (
    receipt.privacy?.rawLogsPersisted !== false ||
    serialized.includes("srcIp") ||
    serialized.includes("requestId") ||
    serialized.includes("clientUa")
  ) {
    throw new Error("public-search staging sentinel retained raw request evidence");
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

export function validatePublicSearchStagingSentinel(contract) {
  if (
    contract?.version !== 1 ||
    contract.kind !== "post_deploy_sentinel" ||
    contract.environment !== "staging" ||
    contract.route !== "/search" ||
    "availability" in contract ||
    !contract.railway_target?.project_id ||
    !contract.railway_target?.environment_id ||
    !contract.railway_target?.service_id
  ) {
    throw new Error("public-search staging sentinel target drifted");
  }
  if (
    contract.latency?.event !== "public_search_completed" ||
    contract.latency?.field !== "elapsed_ms" ||
    !Number.isInteger(contract.latency?.minimum_samples) ||
    contract.latency.minimum_samples < 1 ||
    !Number.isInteger(contract.latency?.minimum_non_empty_samples) ||
    contract.latency.minimum_non_empty_samples < 1 ||
    !Array.isArray(contract.latency?.traffic_classes) ||
    !Array.isArray(contract.privacy?.forbidden_fields)
  ) {
    throw new Error("public-search staging sentinel latency/privacy contract drifted");
  }
  if (
    contract.canary?.source_corpus?.version !== 1 ||
    contract.canary.source_corpus.owner_command !==
      "fmarch-staging-search-corpus reconcile" ||
    typeof contract.canary.source_corpus.case_id !== "string" ||
    typeof contract.canary.source_corpus.game_id !== "string" ||
    contract.canary.source_corpus.pack !== "mafiascum" ||
    contract.canary.source_corpus.lifecycle !== "active" ||
    contract.canary.source_corpus.expected_result_href !==
      `/games/${contract.canary.source_corpus.game_id}` ||
    !Number.isInteger(contract.canary.source_corpus.minimum_matching_responses) ||
    contract.canary.source_corpus.minimum_matching_responses < 1 ||
    !contract.canary.cases?.some(
      (canaryCase) => canaryCase.id === contract.canary.source_corpus.case_id,
    )
  ) {
    throw new Error("public-search staging source corpus contract drifted");
  }
}

function parsePublicSearchLog(row, contract, index) {
  const message = String(row?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const parseErrors = [];
  const filter = quotedField(message, "filter");
  const page = quotedField(message, "page");
  const trafficClass = quotedField(message, "traffic_class");
  const limit = numericField(message, "limit");
  const resultCount = numericField(message, "result_count");
  const hasNextPage = booleanField(message, "has_next_page");
  const selectivitySignal = numericField(
    message,
    "selectivity_signal_basis_points",
  );
  const elapsedMs = numericField(message, contract.latency.field);
  const event = quotedField(message, "event");
  const values = {
    filter,
    page,
    limit,
    result_count: resultCount,
    has_next_page: hasNextPage,
    selectivity_signal_basis_points: selectivitySignal,
    elapsed_ms: elapsedMs,
    traffic_class: trafficClass,
  };
  for (const field of requiredSearchFields) {
    if (values[field] === null) parseErrors.push(`missing ${field}`);
  }
  if (event !== contract.latency.event) parseErrors.push("event name mismatch");
  if (filter !== null && !["all", "discussions", "profiles", "games"].includes(filter)) {
    parseErrors.push("filter is unbounded");
  }
  if (page !== null && !["first", "continuation"].includes(page)) {
    parseErrors.push("page is unbounded");
  }
  if (
    trafficClass !== null &&
    !contract.latency.traffic_classes.includes(trafficClass)
  ) {
    parseErrors.push("traffic class is unbounded");
  }
  if (limit !== null && (limit < 1 || limit > 50)) parseErrors.push("limit is unbounded");
  if (resultCount !== null && (resultCount < 0 || resultCount > 50)) {
    parseErrors.push("result count is unbounded");
  }
  if (selectivitySignal !== null && (selectivitySignal < 0 || selectivitySignal > 10_000)) {
    parseErrors.push("selectivity signal is unbounded");
  }
  const privacyViolations = contract.privacy.forbidden_fields.filter((field) =>
    new RegExp(`(?:^|\\s)${escapeRegExp(field)}\\s*=`).test(message),
  );
  return {
    timestamp: validDate(row?.timestamp, `application log row ${index + 1} timestamp`),
    filter,
    page,
    trafficClass,
    limit,
    resultCount,
    hasNextPage,
    selectivitySignal,
    elapsedMs,
    parseErrors,
    privacyViolations,
  };
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

function derivedStatus(checks) {
  return checks.some((item) => item.status === "failed")
    ? "failed"
    : checks.some((item) => item.status === "insufficient")
      ? "insufficient"
      : "passed";
}

export const PUBLIC_SEARCH_STAGING_SLO_RECEIPT_VERSION = 2;

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

export function buildPublicSearchStagingSloReceipt({
  slo,
  deployment,
  deploymentHistory,
  applicationLogRows,
  httpLogRows,
  expectedCommit,
  now = new Date(),
}) {
  validatePublicSearchStagingSlo(slo);
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
  const parsedHistory = deploymentHistory.map(parseDeployment);
  const deploymentById = new Map(parsedHistory.map((item) => [item.id, item]));
  const earliestDeploymentAt = parsedHistory.reduce(
    (earliest, item) =>
      earliest === null || item.createdAt < earliest ? item.createdAt : earliest,
    null,
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
  const nonEmptyLatencySamples = latencyRows.filter(
    (row) => row.parseErrors.length === 0 && row.selectivitySignal > 0,
  ).length;
  const latencyCoverageRatio = coverageRatio({
    boundaryCreatedAt: deploymentCreatedAt,
    windowStart: latencyWindowStart,
    windowEnd: evaluatedAt,
  });
  const latencyCoverage = check(
    "latency-window-coverage",
    latencyCoverageRatio === 1 ? "passed" : "insufficient",
    `exact deployment covers ${(latencyCoverageRatio * 100).toFixed(3)}% of the configured latency window`,
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
  const latencySelectivityCoverage = check(
    "latency-selectivity-coverage",
    nonEmptyLatencySamples >= slo.latency.minimum_non_empty_samples
      ? "passed"
      : "insufficient",
    `${nonEmptyLatencySamples}/${slo.latency.minimum_non_empty_samples} required non-empty result samples`,
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
        row.timestamp >= availabilityWindowStart &&
        row.timestamp <= evaluatedAt,
    );
  const unknownDeploymentRows = availabilityRows.filter(
    (row) => !deploymentById.has(row.deploymentId),
  );
  const goodAvailabilityRows = availabilityRows.filter(
    (row) => row.status <= slo.availability.good_status_upper_bound,
  );
  const availabilityRatio =
    availabilityRows.length === 0
      ? null
      : Number((goodAvailabilityRows.length / availabilityRows.length).toFixed(6));
  const availabilityCoverageRatio = earliestDeploymentAt
    ? coverageRatio({
        boundaryCreatedAt: earliestDeploymentAt,
        windowStart: availabilityWindowStart,
        windowEnd: evaluatedAt,
      })
    : 0;
  const availabilityCoverage = check(
    "availability-service-window-coverage",
    availabilityCoverageRatio === 1 ? "passed" : "insufficient",
    `service deployment history covers ${(availabilityCoverageRatio * 100).toFixed(3)}% of the configured availability window`,
  );
  const observedAvailabilityBuckets = observedWindowBuckets({
    rows: availabilityRows,
    windowStart: availabilityWindowStart,
    windowEnd: evaluatedAt,
    bucketCount: slo.availability.minimum_observed_window_buckets,
  });
  const availabilitySampleCoverage = check(
    "availability-sample-window-coverage",
    observedAvailabilityBuckets.length ===
      slo.availability.minimum_observed_window_buckets
      ? "passed"
      : "insufficient",
    `${observedAvailabilityBuckets.length}/${slo.availability.minimum_observed_window_buckets} availability window buckets contain samples`,
  );
  const availabilityAttribution = check(
    "availability-deployment-attribution",
    unknownDeploymentRows.length === 0 ? "passed" : "failed",
    unknownDeploymentRows.length === 0
      ? `${availabilityRows.length} route samples map to the bounded service deployment history`
      : `${unknownDeploymentRows.length} route samples do not map to the service deployment history`,
  );
  const availabilitySamples = check(
    "availability-minimum-samples",
    availabilityRows.length >= slo.availability.minimum_samples
      ? "passed"
      : "insufficient",
    `${availabilityRows.length}/${slo.availability.minimum_samples} required route samples`,
  );
  const availabilityObjective = check(
    "availability-objective",
    availabilityRows.length < slo.availability.minimum_samples ||
      availabilityCoverageRatio < 1 ||
      observedAvailabilityBuckets.length <
        slo.availability.minimum_observed_window_buckets
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
    latencySelectivityCoverage,
    latencyObjective,
    telemetryShape,
    telemetryPrivacy,
    availabilityCoverage,
    availabilitySampleCoverage,
    availabilityAttribution,
    availabilitySamples,
    availabilityObjective,
  ];
  const status = derivedStatus(checks);
  const receipt = {
    version: PUBLIC_SEARCH_STAGING_SLO_RECEIPT_VERSION,
    proof: "fmarch-public-search-staging-slo",
    status,
    generatedAt: evaluatedAt.toISOString(),
    proofBoundary:
      "Read-only evaluation of exact-commit Railway staging application logs for latency and service-level Railway HTTP logs across rolling deployments for availability. The receipt retains deployment attribution and bounded aggregates only; raw logs, request identifiers, addresses, user agents, and query material are never persisted. Synthetic staging-canary traffic is declared separately from external traffic and is not an authenticated identity.",
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
      scope: "exact-deployment",
      event: slo.latency.event,
      windowStart: latencyWindowStart.toISOString(),
      windowEnd: evaluatedAt.toISOString(),
      deploymentCoverageRatio: latencyCoverageRatio,
      sampleCount: latencyValues.length,
      minimumSamples: slo.latency.minimum_samples,
      nonEmptySampleCount: nonEmptyLatencySamples,
      minimumNonEmptySamples: slo.latency.minimum_non_empty_samples,
      percentile: slo.latency.percentile,
      observedMs: latencyP95Ms,
      objectiveMs: slo.latency.objective_ms,
      byTrafficClass: countBy(latencyRows, (row) => row.trafficClass),
      byFilter: countBy(latencyRows, (row) => row.filter),
      byPage: countBy(latencyRows, (row) => row.page),
      bySelectivityBand: countBy(latencyRows, selectivityBand),
    },
    availability: {
      scope: "service-across-deployments",
      event: slo.availability.event,
      windowStart: availabilityWindowStart.toISOString(),
      windowEnd: evaluatedAt.toISOString(),
      serviceHistoryCoverageRatio: availabilityCoverageRatio,
      observedWindowBuckets: observedAvailabilityBuckets,
      requiredObservedWindowBuckets:
        slo.availability.minimum_observed_window_buckets,
      deploymentHistoryCount: parsedHistory.length,
      earliestDeploymentAt: earliestDeploymentAt?.toISOString() ?? null,
      sampleCount: availabilityRows.length,
      minimumSamples: slo.availability.minimum_samples,
      goodCount: goodAvailabilityRows.length,
      badCount: availabilityRows.length - goodAvailabilityRows.length,
      observedRatio: availabilityRatio,
      objectiveRatio: slo.availability.objective_ratio,
      statusCounts: countBy(availabilityRows, (row) => String(row.status)),
      deploymentCohorts: deploymentCohorts(availabilityRows, deploymentById, slo),
      unknownDeploymentSampleCount: unknownDeploymentRows.length,
      declaredExcludedPeriodKinds: slo.availability.excluded_periods,
      appliedExcludedPeriods: [],
    },
    privacy: {
      status: telemetryPrivacy.status,
      forbiddenFields: slo.privacy.forbidden_fields,
      violationCount: privacyViolations.length,
      malformedEventCount: malformedRows.length,
      rawLogsPersisted: false,
      canaryTrafficIsAuthenticatedIdentity: false,
    },
    evidence: {
      applicationRowsObserved: applicationLogRows.length,
      httpRowsObserved: httpLogRows.length,
      applicationRowsAttributed: parsedSearch.length,
      httpRowsAttributed: availabilityRows.length - unknownDeploymentRows.length,
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
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== 14) {
    throw new Error("public-search staging SLO check inventory drifted");
  }
  if (receipt.status !== derivedStatus(receipt.checks)) {
    throw new Error("public-search staging SLO status is not derived from checks");
  }
  const serialized = JSON.stringify(receipt);
  if (
    receipt.privacy?.rawLogsPersisted !== false ||
    serialized.includes("srcIp") ||
    serialized.includes("requestId") ||
    serialized.includes("clientUa")
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

export function validatePublicSearchStagingSlo(slo) {
  if (
    slo?.version !== 2 ||
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
    slo.latency.minimum_samples < 1 ||
    !Number.isInteger(slo.latency?.minimum_non_empty_samples) ||
    slo.latency.minimum_non_empty_samples < 1 ||
    !Array.isArray(slo.latency?.traffic_classes)
  ) {
    throw new Error("public-search staging latency SLO drifted");
  }
  if (
    slo.availability?.event !== "http_request_completed" ||
    !Number.isInteger(slo.availability?.minimum_samples) ||
    slo.availability.minimum_samples < 1 ||
    !Number.isInteger(slo.availability?.minimum_observed_window_buckets) ||
    slo.availability.minimum_observed_window_buckets < 1 ||
    !Number.isInteger(slo.availability?.deployment_history_limit) ||
    slo.availability.deployment_history_limit < 1 ||
    !Array.isArray(slo.availability?.excluded_periods) ||
    !Array.isArray(slo.privacy?.forbidden_fields)
  ) {
    throw new Error("public-search staging availability/privacy SLO drifted");
  }
}

function parsePublicSearchLog(row, slo, index) {
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
    traffic_class: trafficClass,
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
  if (trafficClass !== null && !slo.latency.traffic_classes.includes(trafficClass)) {
    parseErrors.push("traffic class is unbounded");
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

function parseDeployment(deployment, index) {
  if (!deployment?.id) throw new Error(`deployment history row ${index + 1} has no id`);
  return {
    id: deployment.id,
    status: deployment.status ?? null,
    createdAt: validDate(
      deployment.createdAt,
      `deployment history row ${index + 1} creation time`,
    ),
    commitHash: deployment.meta?.commitHash ?? null,
  };
}

function deploymentCohorts(rows, deploymentById, slo) {
  const cohorts = new Map();
  for (const row of rows) {
    const deployment = deploymentById.get(row.deploymentId);
    const current = cohorts.get(row.deploymentId) ?? {
      deploymentId: row.deploymentId,
      commitHash: deployment?.commitHash ?? null,
      deploymentStatus: deployment?.status ?? null,
      sampleCount: 0,
      goodCount: 0,
      badCount: 0,
    };
    current.sampleCount += 1;
    if (row.status <= slo.availability.good_status_upper_bound) current.goodCount += 1;
    else current.badCount += 1;
    cohorts.set(row.deploymentId, current);
  }
  return [...cohorts.values()].sort((left, right) =>
    left.deploymentId.localeCompare(right.deploymentId),
  );
}

function coverageRatio({ boundaryCreatedAt, windowStart, windowEnd }) {
  const start = Math.max(boundaryCreatedAt.getTime(), windowStart.getTime());
  const duration = windowEnd.getTime() - windowStart.getTime();
  return Number(
    Math.max(0, Math.min(1, (windowEnd.getTime() - start) / duration)).toFixed(6),
  );
}

function observedWindowBuckets({ rows, windowStart, windowEnd, bucketCount }) {
  const bucketDuration = (windowEnd.getTime() - windowStart.getTime()) / bucketCount;
  const observed = new Set();
  for (const row of rows) {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor((row.timestamp.getTime() - windowStart.getTime()) / bucketDuration),
    );
    if (bucket >= 0) observed.add(bucket);
  }
  return [...observed].sort((left, right) => left - right);
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

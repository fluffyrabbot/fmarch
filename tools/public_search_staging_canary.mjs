import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validatePublicSearchStagingSlo } from "./public_search_staging_evidence_contract.mjs";

export const PUBLIC_SEARCH_STAGING_CANARY_RECEIPT_VERSION = 2;

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
  "public-search-staging-canary",
  "receipt.json",
);

export async function runPublicSearchStagingCanary({
  slo,
  fetchImpl = fetch,
  now = new Date(),
}) {
  validateCanary(slo);
  const plan = canaryPlan(slo);
  const observations = await mapWithConcurrency(
    plan,
    slo.canary.maximum_concurrency,
    (request) => executeRequest({ slo, request, fetchImpl }),
  );
  const failures = observations.filter((item) => item.status !== 200 || !item.validShape);
  const nonEmptyResponses = observations.filter((item) => item.resultCount > 0).length;
  const corpusMatches = observations.filter((item) => item.corpusMatched).length;
  const status =
    failures.length > 0
      ? "failed"
      : nonEmptyResponses < slo.canary.minimum_non_empty_responses ||
          corpusMatches < slo.canary.source_corpus.minimum_matching_responses
        ? "insufficient"
        : "passed";
  const receipt = {
    version: PUBLIC_SEARCH_STAGING_CANARY_RECEIPT_VERSION,
    proof: "fmarch-public-search-staging-canary",
    status,
    generatedAt: validDate(now, "canary clock").toISOString(),
    proofBoundary:
      "Public, unauthenticated staging GET workload using versioned synthetic terms and one source-controlled corpus expectation. The traffic-class header is an observational label, not an authenticated identity. The receipt retains case ids, filters, response status counts, result-count bands, aggregate corpus-match counts, and client latency aggregates only; query terms, expected hrefs, response bodies, result content, cursors, and request identifiers are never persisted.",
    target: {
      environment: slo.environment,
      route: slo.route,
      domain: slo.railway_target.domain,
      serviceId: slo.railway_target.service_id,
    },
    traffic: {
      class: slo.canary.traffic_class,
      headerName: slo.canary.header_name,
      authenticatedIdentity: false,
      requestCount: observations.length,
      configuredRequestCount: slo.canary.requests_per_run,
      maximumConcurrency: slo.canary.maximum_concurrency,
    },
    aggregate: {
      successfulCount: observations.length - failures.length,
      failedCount: failures.length,
      nonEmptyResponseCount: nonEmptyResponses,
      minimumNonEmptyResponses: slo.canary.minimum_non_empty_responses,
      sourceCorpus: {
        version: slo.canary.source_corpus.version,
        caseId: slo.canary.source_corpus.case_id,
        matchCount: corpusMatches,
        minimumMatchingResponses: slo.canary.source_corpus.minimum_matching_responses,
      },
      statusCounts: countBy(observations, (item) => String(item.status)),
      p95ClientMs: percentile(
        observations.map((item) => item.elapsedMs),
        95,
      ),
      byCase: caseAggregates(observations),
      byFilter: countBy(observations, (item) => item.filter),
      byResultCountBand: countBy(observations, (item) => resultCountBand(item.resultCount)),
    },
    privacy: {
      syntheticQueriesPersisted: false,
      responseBodiesPersisted: false,
      resultContentPersisted: false,
      cursorsPersisted: false,
      rawRequestMetadataPersisted: false,
    },
  };
  return assertPublicSearchStagingCanaryReceipt(receipt, slo);
}

export function assertPublicSearchStagingCanaryReceipt(receipt, slo) {
  if (
    receipt?.version !== PUBLIC_SEARCH_STAGING_CANARY_RECEIPT_VERSION ||
    receipt.proof !== "fmarch-public-search-staging-canary" ||
    !["passed", "failed", "insufficient"].includes(receipt.status) ||
    receipt.traffic?.requestCount !== slo.canary.requests_per_run
  ) {
    throw new Error("public-search staging canary receipt shape drifted");
  }
  if (
    receipt.privacy?.syntheticQueriesPersisted !== false ||
    receipt.privacy?.responseBodiesPersisted !== false ||
    receipt.privacy?.resultContentPersisted !== false ||
    receipt.traffic?.authenticatedIdentity !== false
  ) {
    throw new Error("public-search staging canary privacy boundary drifted");
  }
  const serialized = JSON.stringify(receipt);
  for (const canaryCase of slo.canary.cases) {
    if (serialized.includes(JSON.stringify(canaryCase.synthetic_query))) {
      throw new Error("public-search staging canary retained a synthetic query");
    }
  }
  if (serialized.includes(JSON.stringify(slo.canary.source_corpus.expected_result_href))) {
    throw new Error("public-search staging canary retained the expected corpus href");
  }
  return receipt;
}

function validateCanary(slo) {
  validatePublicSearchStagingSlo(slo);
  if (
    slo.canary?.traffic_class !== "staging_canary" ||
    slo.canary?.header_name !== "x-fmarch-search-observation" ||
    slo.canary?.header_value !== "staging-canary-v1" ||
    !Number.isInteger(slo.canary?.requests_per_run) ||
    slo.canary.requests_per_run < 1 ||
    !Number.isInteger(slo.canary?.minimum_non_empty_responses) ||
    slo.canary.minimum_non_empty_responses < 1 ||
    !Number.isInteger(slo.canary?.maximum_concurrency) ||
    slo.canary.maximum_concurrency < 1 ||
    !Number.isInteger(slo.canary?.request_timeout_ms) ||
    slo.canary.request_timeout_ms < 1 ||
    !Array.isArray(slo.canary?.cases) ||
    slo.canary.cases.length === 0
  ) {
    throw new Error("public-search staging canary contract drifted");
  }
  if (
    slo.canary.source_corpus?.version !== 1 ||
    typeof slo.canary.source_corpus?.case_id !== "string" ||
    typeof slo.canary.source_corpus?.expected_result_href !== "string" ||
    !Number.isInteger(slo.canary.source_corpus?.minimum_matching_responses) ||
    slo.canary.source_corpus.minimum_matching_responses < 1
  ) {
    throw new Error("public-search staging canary source corpus drifted");
  }
  const ids = new Set();
  let requestCount = 0;
  for (const canaryCase of slo.canary.cases) {
    if (
      !canaryCase.id ||
      ids.has(canaryCase.id) ||
      !["all", "discussions", "profiles", "games"].includes(canaryCase.filter) ||
      typeof canaryCase.synthetic_query !== "string" ||
      canaryCase.synthetic_query.length < 2 ||
      !Number.isInteger(canaryCase.repetitions) ||
      canaryCase.repetitions < 1
    ) {
      throw new Error("public-search staging canary case drifted");
    }
    ids.add(canaryCase.id);
    requestCount += canaryCase.repetitions;
  }
  if (requestCount !== slo.canary.requests_per_run) {
    throw new Error("public-search staging canary request inventory drifted");
  }
  if (!ids.has(slo.canary.source_corpus.case_id)) {
    throw new Error("public-search staging canary source corpus case is missing");
  }
}

function canaryPlan(slo) {
  return slo.canary.cases.flatMap((canaryCase) =>
    Array.from({ length: canaryCase.repetitions }, (_, repetition) => ({
      id: canaryCase.id,
      filter: canaryCase.filter,
      syntheticQuery: canaryCase.synthetic_query,
      expectedHref:
        canaryCase.id === slo.canary.source_corpus.case_id
          ? slo.canary.source_corpus.expected_result_href
          : null,
      repetition,
    })),
  );
}

async function executeRequest({ slo, request, fetchImpl }) {
  const url = new URL(slo.route, `https://${slo.railway_target.domain}`);
  url.searchParams.set("q", request.syntheticQuery);
  url.searchParams.set("filter", request.filter);
  url.searchParams.set("limit", "20");
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        [slo.canary.header_name]: slo.canary.header_value,
        "user-agent": "fmarch-public-search-staging-canary/1",
      },
      signal: AbortSignal.timeout(slo.canary.request_timeout_ms),
    });
  } catch {
    return failedObservation(request, 0, performance.now() - started);
  }
  const elapsedMs = performance.now() - started;
  let body;
  try {
    body = await response.json();
  } catch {
    return failedObservation(request, response.status, elapsedMs);
  }
  const validShape =
    response.status === 200 &&
    body?.query === request.syntheticQuery &&
    body?.filter === request.filter &&
    Array.isArray(body?.results) &&
    (body?.next_cursor === null || typeof body?.next_cursor === "string");
  const corpusMatched =
    validShape &&
    request.expectedHref !== null &&
    body.results.some((result) => result?.href === request.expectedHref);
  return {
    id: request.id,
    filter: request.filter,
    repetition: request.repetition,
    status: response.status,
    validShape,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    resultCount: Array.isArray(body?.results) ? body.results.length : null,
    corpusMatched,
  };
}

function failedObservation(request, status, elapsedMs) {
  return {
    id: request.id,
    filter: request.filter,
    repetition: request.repetition,
    status,
    validShape: false,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    resultCount: null,
    corpusMatched: false,
  };
}

function caseAggregates(observations) {
  const cases = new Map();
  for (const observation of observations) {
    const current = cases.get(observation.id) ?? {
      id: observation.id,
      filter: observation.filter,
      requestCount: 0,
      successfulCount: 0,
      statusCounts: {},
      corpusMatchCount: 0,
      clientLatencyValues: [],
    };
    current.requestCount += 1;
    if (observation.status === 200 && observation.validShape) current.successfulCount += 1;
    current.statusCounts[observation.status] =
      (current.statusCounts[observation.status] ?? 0) + 1;
    current.clientLatencyValues.push(observation.elapsedMs);
    if (observation.corpusMatched) current.corpusMatchCount += 1;
    cases.set(observation.id, current);
  }
  return [...cases.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ clientLatencyValues, ...item }) => ({
      ...item,
      p95ClientMs: percentile(clientLatencyValues, 95),
    }));
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
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

function resultCountBand(resultCount) {
  if (resultCount === null) return "invalid-response";
  if (resultCount === 0) return "empty";
  if (resultCount < 20) return "partial-page";
  return "full-page";
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

function validDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`);
  return date;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const sloPath = path.resolve(args.slo ?? defaultSloPath);
  const outputPath = path.resolve(args.output ?? defaultOutputPath);
  const slo = JSON.parse(await readFile(sloPath, "utf8"));
  const receipt = await runPublicSearchStagingCanary({ slo });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        traffic: receipt.traffic,
        aggregate: receipt.aggregate,
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

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") args.help = true;
    else if (value === "--allow-insufficient") args.allowInsufficient = true;
    else if (value === "--slo") args.slo = requireValue(argv, ++index, value);
    else if (value === "--output") args.output = requireValue(argv, ++index, value);
    else throw new Error(`unknown public-search canary argument: ${value}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printUsage() {
  console.log(`Usage: node tools/public_search_staging_canary.mjs [options]

Options:
  --slo PATH     SLO and canary contract (default: docs/ops/public-search-staging-slo.json)
  --output PATH  Receipt path (default: target/public-search-staging-canary/receipt.json)
  --allow-insufficient  Exit zero when all requests succeed but all result pages are empty
  --help         Show this help
`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`public-search staging canary failed: ${error.message}`);
      process.exitCode = 1;
    });
}

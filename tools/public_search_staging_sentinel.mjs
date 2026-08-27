import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPublicSearchStagingSentinelReceipt,
  parseRailwayNdjson,
  validatePublicSearchStagingSentinel,
} from "./public_search_staging_sentinel_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultContractPath = path.join(
  repoRoot,
  "docs",
  "ops",
  "public-search-staging-sentinel.json",
);
const defaultOutputPath = path.join(
  repoRoot,
  "target",
  "public-search-staging-sentinel",
  "receipt.json",
);

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const contractPath = path.resolve(args.contract ?? defaultContractPath);
  const outputPath = path.resolve(
    args.output ?? env.FMARCH_PUBLIC_SEARCH_SENTINEL_OUTPUT ?? defaultOutputPath,
  );
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  validatePublicSearchStagingSentinel(contract);
  const expectedCommit =
    args.expectedCommit ?? commandText("git", ["rev-parse", "HEAD"], env);
  const target = contract.railway_target;
  const deployments = JSON.parse(
    railwayText(
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
    ),
  );
  const deployment = deployments[0];
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
        `${contract.latency.window_minutes}m`,
        "--filter",
        contract.latency.event,
        "--json",
      ],
      env,
    ),
    "Railway application log",
  );
  const receipt = buildPublicSearchStagingSentinelReceipt({
    contract,
    deployment,
    applicationLogRows,
    expectedCommit,
    expectedImageDigest: args.expectedImageDigest,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        deployment: receipt.deployment,
        latency: receipt.latency,
        receipt: path.relative(repoRoot, outputPath),
      },
      null,
      2,
    ),
  );
  if (receipt.status === "failed") return 1;
  if (receipt.status === "insufficient") return 2;
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
    else if (value === "--contract") args.contract = requireValue(argv, ++index, value);
    else if (value === "--output") args.output = requireValue(argv, ++index, value);
    else if (value === "--expected-commit") {
      args.expectedCommit = requireValue(argv, ++index, value);
    } else if (value === "--expected-image-digest") {
      args.expectedImageDigest = requireValue(argv, ++index, value);
    } else throw new Error(`unknown public-search sentinel argument: ${value}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printUsage() {
  console.log(`Usage: node tools/public_search_staging_sentinel.mjs [options]

Options:
  --contract PATH        Sentinel contract (default: docs/ops/public-search-staging-sentinel.json)
  --output PATH          Receipt path (default: target/public-search-staging-sentinel/receipt.json)
  --expected-commit SHA  Exact Railway deployment commit (default: HEAD)
  --expected-image-digest DIGEST  Coordinator-pinned OCI digest
  --help                 Show this help
`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`public-search staging sentinel failed: ${error.message}`);
      process.exitCode = 1;
    });
}

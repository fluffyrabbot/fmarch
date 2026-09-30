// Execution inputs are narrow dependency edges shared by selection and reuse.
// Broad cache context (runner policy, runtime groups) affects evidence identity
// without turning every changed context file into a direct execution trigger.
import { dirname, relative, resolve } from 'node:path';
import { matchesGlob } from 'node:path';

const SELECTOR_KINDS = new Set(['file', 'prefix', 'glob']);
const LIBRARY_KINDS = new Set(['lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function onlyKeys(value, keys, label) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label} has unknown field ${key}`);
  }
}

function selectors(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a selector array`);
  const seen = new Set();
  for (const selector of value) {
    record(selector, `${label} selector`);
    onlyKeys(selector, ['kind', 'path'], `${label} selector`);
    if (!SELECTOR_KINDS.has(selector.kind)) throw new Error(`${label} selector has unknown kind ${selector.kind}`);
    const path = selector.path;
    if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') ||
        path.includes('\\') || path.includes('\0') || path.includes('//') ||
        path.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error(`${label} selector path must be a normalized repository-relative path`);
    }
    if (selector.kind === 'file' && path.endsWith('/')) throw new Error(`${label} file selector may not end in '/'`);
    if (selector.kind === 'glob' && !/[*?\[\]{}]/.test(path)) throw new Error(`${label} glob selector must contain intentional glob syntax`);
    const identity = JSON.stringify([selector.kind, path]);
    if (seen.has(identity)) throw new Error(`${label} has duplicate selector ${path}`);
    seen.add(identity);
  }
}

function uniqueSelectors(inputs) {
  const unique = new Map(inputs.map(({ kind, path }) => [JSON.stringify([kind, path]), { kind, path }]));
  return [...unique.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));
}

export function executionInputMatches(file, selector) {
  if (selector.kind === 'glob') return matchesGlob(file, selector.path);
  if (selector.kind === 'prefix') return file.startsWith(selector.path);
  return file === selector.path;
}

function workspacePackages(metadata) {
  if (!metadata || !Array.isArray(metadata.packages)) throw new Error('execution inputs require complete workspace Cargo metadata');
  const members = new Set(metadata.workspace_members ?? []);
  return members.size === 0 ? metadata.packages : metadata.packages.filter((pkg) => members.has(pkg.id));
}

function targetKind(target) {
  if (target.kind.some((kind) => LIBRARY_KINDS.has(kind))) return 'lib';
  return ['test', 'bin', 'bench', 'example'].find((kind) => target.kind.includes(kind));
}

function targetInventory(metadata) {
  const inventory = new Map();
  for (const pkg of workspacePackages(metadata)) {
    if (!Array.isArray(pkg.targets)) throw new Error(`execution inputs require Cargo targets for package ${pkg.name}`);
    for (const target of pkg.targets) {
      const kind = targetKind(target);
      if (!kind) continue;
      const id = kind === 'lib' ? `${pkg.name}/lib` : `${pkg.name}/${kind}/${target.name}`;
      if (inventory.has(id)) throw new Error(`duplicate Cargo target ${id}`);
      inventory.set(id, { ...target, package: pkg.name, targetKind: kind });
    }
  }
  return inventory;
}

export function validateCacheInputContract(manifest, { packageNames, metadata } = {}) {
  const contract = manifest?.cache_inputs;
  record(contract, 'proof cache input contract');
  onlyKeys(contract, ['version', 'global', 'groups'], 'proof cache input contract');
  if (contract.version !== 2) throw new Error('unsupported proof cache input contract version');
  selectors(contract.global, 'proof cache global inputs');
  record(contract.groups, 'proof cache input groups');
  for (const [name, inputs] of Object.entries(contract.groups)) {
    if (!name) throw new Error('proof cache input group name must be non-empty');
    selectors(inputs, `proof cache input group ${name}`);
  }
  const execution = manifest.execution_inputs;
  record(execution, 'proof execution input contract');
  onlyKeys(execution, ['version', 'packages', 'targets'], 'proof execution input contract');
  if (execution.version !== 1) throw new Error('unsupported proof execution input contract version');
  record(execution.packages, 'proof execution package inputs');
  record(execution.targets, 'proof execution target inputs');
  const knownPackages = metadata ? new Set(workspacePackages(metadata).map((pkg) => pkg.name))
    : packageNames === undefined ? null : new Set(packageNames);
  const inventory = metadata ? targetInventory(metadata) : null;
  for (const [name, inputs] of Object.entries(execution.packages)) {
    if (!name || knownPackages && !knownPackages.has(name)) throw new Error(`proof execution inputs refer to unknown package ${name}`);
    selectors(inputs, `proof execution package ${name}`);
  }
  for (const [id, inputs] of Object.entries(execution.targets)) {
    const parts = id.split('/');
    if (!(parts.length === 2 && parts[1] === 'lib' ||
        parts.length === 3 && ['test', 'bin', 'bench', 'example'].includes(parts[1]) && parts[2]) ||
        !parts[0] || knownPackages && !knownPackages.has(parts[0]) || inventory && !inventory.has(id)) {
      throw new Error(`proof execution inputs refer to unknown target ${id}`);
    }
    selectors(inputs, `proof execution target ${id}`);
  }
  record(manifest.lanes, 'proof lanes');
  for (const [id, lane] of Object.entries(manifest.lanes)) {
    const inputs = lane?.cache_inputs;
    record(inputs, `proof lane ${id} cache inputs`);
    onlyKeys(inputs, ['groups', 'paths'], `proof lane ${id} cache inputs`);
    if (!Array.isArray(inputs.groups) || inputs.groups.some((name) =>
      typeof name !== 'string' || !Object.hasOwn(contract.groups, name))) {
      throw new Error(`proof lane ${id} cache inputs refer to an unknown group`);
    }
    if (new Set(inputs.groups).size !== inputs.groups.length) throw new Error(`proof lane ${id} cache inputs repeat a group`);
    selectors(inputs.paths, `proof lane ${id} cache paths`);
    selectors(lane.execution_inputs, `proof lane ${id} execution inputs`);
    for (const target of lane.assertion_targets ?? []) {
      if (inventory && !inventory.has(target)) throw new Error(`proof lane ${id} refers to unknown target ${target}`);
    }
  }
  return true;
}

export function declaredLaneCacheInputs(laneIds, manifest) {
  validateCacheInputContract(manifest);
  const inputs = [...manifest.cache_inputs.global];
  for (const id of laneIds) {
    if (!Object.hasOwn(manifest.lanes, id)) throw new Error(`unknown proof lane ${id}`);
    const lane = manifest.lanes[id].cache_inputs;
    for (const group of lane.groups) inputs.push(...manifest.cache_inputs.groups[group]);
    inputs.push(...lane.paths);
  }
  return uniqueSelectors(inputs);
}

function repositoryPath(root, path, label) {
  const result = relative(resolve(root), resolve(path)).replaceAll('\\', '/');
  if (!result || result.startsWith('../') || result === '..' || result.startsWith('/')) {
    throw new Error(`${label} must be inside the repository`);
  }
  return result;
}

function cargoArguments(lane) {
  const argv = lane.execution?.argv ?? [];
  const index = argv.indexOf('cargo');
  if (index === -1) return { command: null, args: [] };
  const command = argv[index + 1];
  const args = argv.slice(index + 2);
  const separator = args.indexOf('--');
  return { command, args: separator === -1 ? args : args.slice(0, separator) };
}

// Package source trees contain co-located unit tests and remain conservative.
// Integration tests are separate targets: a dependency on a package does not
// compile that package's integration suites. A directly selected test retains
// its complete tests/ helper tree, including cross-target #[path] imports.
export function resolveLaneCargoInputs(laneIds, manifest, metadata, { root } = {}) {
  if (!root) throw new Error('execution inputs require a repository root');
  validateCacheInputContract(manifest, { metadata });
  const packages = new Map(workspacePackages(metadata).map((pkg) => [pkg.name, pkg]));
  const inventory = targetInventory(metadata);
  const selected = new Set();
  const targets = new Set();
  for (const id of laneIds) {
    const lane = manifest.lanes[id];
    if (!lane) throw new Error(`unknown proof lane ${id}`);
    const roots = new Set((manifest.areas ?? []).filter((area) => area.lanes.includes(id))
      .map((area) => area.crate ?? area.closure_crate).filter((name) => packages.has(name)));
    for (const target of lane.assertion_targets ?? []) {
      if (!inventory.has(target)) throw new Error(`proof lane ${id} refers to unknown target ${target}`);
      roots.add(inventory.get(target).package);
      targets.add(target);
    }
    const { command, args } = cargoArguments(lane);
    for (let index = 0; index < args.length; index += 1) {
      if (['-p', '--package'].includes(args[index])) {
        const name = args[++index];
        if (!packages.has(name)) throw new Error(`proof lane ${id} refers to unknown package ${name}`);
        roots.add(name);
      }
    }
    if (lane.execution?.class === 'browser' || args.includes('--workspace') ||
        ['cargo', 'postgres'].includes(lane.execution?.class) && roots.size === 0) {
      for (const name of packages.keys()) roots.add(name);
    }
    if (args.includes('--all-targets')) {
      for (const [target, detail] of inventory) if (roots.has(detail.package)) targets.add(target);
    }
    // Compiled binaries can embed files even when no test harness runs.
    // Library target supplements denote unit-harness inputs; unconditional
    // library inputs belong to packages and already follow the closure.
    if (command) {
      for (let index = 0; index < args.length; index += 1) {
        if (!['--bin', '--example'].includes(args[index])) continue;
        const kind = args[index].slice(2);
        const name = args[++index];
        const matches = [...inventory].filter(([, detail]) => roots.has(detail.package) && detail.targetKind === kind && detail.name === name);
        if (matches.length !== 1) throw new Error(`proof lane ${id} has unknown or ambiguous ${kind} target ${name}`);
        targets.add(matches[0][0]);
      }
    }
    const explicitTarget = args.some((argument) => ['--lib', '--bin', '--example', '--test', '--bench', '--all-targets', '--bins', '--examples', '--tests', '--benches'].includes(argument));
    const bins = [...inventory].filter(([, detail]) => roots.has(detail.package) && detail.targetKind === 'bin');
    if (command === 'run' && !explicitTarget) {
      const defaults = bins.filter(([, detail]) => packages.get(detail.package).default_run === detail.name);
      const runnable = defaults.length ? defaults : bins;
      if (runnable.length !== 1) throw new Error(`proof lane ${id} has unknown or ambiguous default binary target`);
      targets.add(runnable[0][0]);
    } else if (lane.execution?.class === 'browser' ||
        !command && ['cargo', 'postgres'].includes(lane.execution?.class) || args.includes('--bins') ||
        ['build', 'check', 'clippy'].includes(command) && !explicitTarget ||
        [...targets].some((target) => inventory.get(target).targetKind === 'test' && roots.has(inventory.get(target).package))) {
      for (const [target] of bins) targets.add(target);
    }
    for (const name of roots) selected.add(name);
  }
  const queue = [...selected];
  while (queue.length) {
    for (const dependency of packages.get(queue.shift()).dependencies ?? []) {
      const name = dependency.name;
      if (!packages.has(name) || selected.has(name)) continue;
      selected.add(name);
      queue.push(name);
    }
  }
  const sources = [];
  const resolvedPackages = [...selected].sort().map((name) => {
    const pkg = packages.get(name);
    const path = `${repositoryPath(root, dirname(pkg.manifest_path), `package ${name}`)}/`;
    sources.push({ kind: 'file', path: `${path}Cargo.toml` }, { kind: 'file', path: `${path}build.rs` }, { kind: 'prefix', path: `${path}src/` });
    for (const target of pkg.targets) {
      if (target.kind.some((kind) => LIBRARY_KINDS.has(kind) || kind === 'custom-build')) {
        sources.push({ kind: 'file', path: repositoryPath(root, target.src_path, `target source ${name}/${target.name}`) });
      }
    }
    return { name, path };
  });
  for (const id of targets) {
    const target = inventory.get(id);
    const path = repositoryPath(root, target.src_path, `target source ${id}`);
    sources.push({ kind: 'file', path });
    if (target.targetKind === 'test') {
      const pkg = resolvedPackages.find(({ name }) => name === target.package);
      // Keep all integration helpers for this directly selected package; never
      // add this prefix merely because the package is a transitive dependency.
      sources.push({ kind: 'prefix', path: `${pkg.path}tests/` });
    } else if (['bench', 'example'].includes(target.targetKind)) {
      const pkg = resolvedPackages.find(({ name }) => name === target.package);
      sources.push({ kind: 'prefix', path: `${pkg.path}${target.targetKind === 'bench' ? 'benches' : 'examples'}/` });
    }
  }
  return { packages: resolvedPackages, targets: [...targets].sort(), selectors: uniqueSelectors(sources) };
}

export function resolveLaneExecutionInputs(laneIds, manifest, metadata, options = {}) {
  const cargo = resolveLaneCargoInputs(laneIds, manifest, metadata, options);
  const edges = [];
  const add = (scope, owner, inputs) => {
    for (const selector of inputs ?? []) edges.push({ scope, owner, selector });
  };
  for (const id of laneIds) add('lane', id, manifest.lanes[id].execution_inputs);
  for (const id of cargo.targets) add('target', id, manifest.execution_inputs.targets[id]);
  for (const pkg of cargo.packages) add('package', pkg.name, manifest.execution_inputs.packages[pkg.name]);
  return [...new Map(edges.map((edge) => [JSON.stringify(edge), edge])).entries()]
    .sort(([left], [right]) => left.localeCompare(right)).map(([, edge]) => edge);
}

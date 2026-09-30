// Cache dependencies are an execution contract, separate from behavioral
// ownership and lane selection. Every lane declares its non-Cargo inputs;
// package supplements follow the complete Cargo closure, including dev/build
// dependencies. Selectors never infer glob syntax from a literal filename.

const SELECTOR_KINDS = new Set(['file', 'prefix', 'glob']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
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
    if (!SELECTOR_KINDS.has(selector.kind)) {
      throw new Error(`${label} selector has unknown kind ${selector.kind}`);
    }
    const path = selector.path;
    if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') ||
        path.includes('\\') || path.includes('\0') || path.includes('//') ||
        path.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error(`${label} selector path must be a normalized repository-relative path`);
    }
    if (selector.kind === 'file' && path.endsWith('/')) {
      throw new Error(`${label} file selector may not end in '/'`);
    }
    if (selector.kind === 'glob' && !/[*?\[\]{}]/.test(path)) {
      throw new Error(`${label} glob selector must contain intentional glob syntax`);
    }
    const identity = JSON.stringify([selector.kind, path]);
    if (seen.has(identity)) throw new Error(`${label} has duplicate selector ${path}`);
    seen.add(identity);
  }
}

export function validateCacheInputContract(manifest, { packageNames } = {}) {
  const contract = manifest?.cache_inputs;
  record(contract, 'proof cache input contract');
  onlyKeys(contract, ['version', 'global', 'groups', 'packages'], 'proof cache input contract');
  if (contract.version !== 1) throw new Error('unsupported proof cache input contract version');
  selectors(contract.global, 'proof cache global inputs');
  record(contract.groups, 'proof cache input groups');
  for (const [name, inputs] of Object.entries(contract.groups)) {
    if (!name) throw new Error('proof cache input group name must be non-empty');
    selectors(inputs, `proof cache input group ${name}`);
  }
  record(contract.packages, 'proof cache package inputs');
  const knownPackages = packageNames === undefined ? null : new Set(packageNames);
  for (const [name, inputs] of Object.entries(contract.packages)) {
    if (!name || knownPackages && !knownPackages.has(name)) {
      throw new Error(`proof cache inputs refer to unknown package ${name}`);
    }
    selectors(inputs, `proof cache package ${name}`);
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
    if (new Set(inputs.groups).size !== inputs.groups.length) {
      throw new Error(`proof lane ${id} cache inputs repeat a group`);
    }
    selectors(inputs.paths, `proof lane ${id} cache paths`);
  }
  return true;
}

export function declaredLaneCacheInputs(laneIds, manifest, packageNames = []) {
  validateCacheInputContract(manifest);
  const contract = manifest.cache_inputs;
  const inputs = [...contract.global];
  for (const id of laneIds) {
    if (!Object.hasOwn(manifest.lanes, id)) throw new Error(`unknown proof lane ${id}`);
    const lane = manifest.lanes[id].cache_inputs;
    for (const group of lane.groups) inputs.push(...contract.groups[group]);
    inputs.push(...lane.paths);
  }
  for (const name of packageNames) inputs.push(...(contract.packages[name] ?? []));
  const unique = new Map(inputs.map(({ kind, path }) => [JSON.stringify([kind, path]), { kind, path }]));
  return [...unique.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));
}

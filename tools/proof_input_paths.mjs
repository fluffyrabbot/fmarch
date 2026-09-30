import { lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, matchesGlob } from 'node:path';

export function proofSourceFiles(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean).sort();
}

export class UnsafeProofInputError extends Error {
  constructor(path, detail) {
    super(`Unsafe proof input ${path}: ${detail}`);
    this.name = 'UnsafeProofInputError';
    this.code = 'UNSAFE_PROOF_INPUT';
  }
}

function segments(path) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') ||
      path.split('/').some(part => part === '.' || part === '..' || part === '')) {
    throw new UnsafeProofInputError(path, 'expected a normalized repository-relative path');
  }
  return path.split('/');
}

function literalRoot(pattern) {
  return pattern.split('/').filter((part, index, parts) =>
    parts.slice(0, index + 1).every(value => !/[*?\[\]{}()]/.test(value))).join('/');
}

function globCanDescendFrom(path, pattern) {
  // A slash inside a brace/extglob expression needs expansion before splitting
  // into segments. Conservatively protect its literal root instead of guessing
  // that a directory link cannot hide a selected file.
  if (/[{(][^})]*\//.test(pattern)) {
    const root = literalRoot(pattern);
    return !root || path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`);
  }
  const input = path.split('/');
  const glob = pattern.split('/');
  const seen = new Set();
  const visit = (i, j) => {
    const state = `${i}:${j}`;
    if (seen.has(state)) return false;
    seen.add(state);
    if (i === input.length) return true;
    if (j === glob.length) return false;
    if (glob[j] === '**') return visit(i, j + 1) || visit(i + 1, j);
    return matchesGlob(input[i], glob[j]) && visit(i + 1, j + 1);
  };
  return visit(0, 0);
}

function canAffect(path, selector) {
  if (selector.kind === 'file') return path === selector.path || selector.path.startsWith(`${path}/`);
  if (selector.kind === 'prefix') {
    return path.startsWith(selector.path) || selector.path === `${path}/` || selector.path.startsWith(`${path}/`);
  }
  if (selector.kind === 'glob') return globCanDescendFrom(path, selector.path);
  throw new UnsafeProofInputError(selector.path, `unknown selector kind ${selector.kind}`);
}

// Inspect each component with lstat before advancing, so a missing final file
// cannot conceal an existing (including dangling) symlink ancestor.
function inspect(root, relative, { candidate = false, states } = {}) {
  const parts = segments(relative);
  let absolute = root;
  for (const [index, part] of parts.entries()) {
    absolute = join(absolute, part);
    let stat;
    try {
      if (!states.has(absolute)) states.set(absolute, lstatSync(absolute));
      stat = states.get(absolute);
    }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
      throw error;
    }
    const current = parts.slice(0, index + 1).join('/');
    if (stat.isSymbolicLink()) throw new UnsafeProofInputError(current, 'source and fixture symlinks are not allowed');
    if (!stat.isFile() && !stat.isDirectory()) throw new UnsafeProofInputError(current, 'unsupported filesystem type');
    if (index < parts.length - 1 && !stat.isDirectory()) return;
    if (candidate && index === parts.length - 1 && stat.isDirectory()) {
      throw new UnsafeProofInputError(current, 'a Git input must be a regular file, not an opaque directory');
    }
  }
}

export function assertProofInputPaths({ root, files, selectors }) {
  const states = new Map();
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new UnsafeProofInputError(root, 'repository root must be a real directory');
  for (const selector of selectors) {
    const anchor = selector.kind === 'glob' ? literalRoot(selector.path) : selector.path.replace(/\/$/, '');
    if (anchor) inspect(root, anchor, { states });
  }
  for (const file of new Set(files)) {
    segments(file);
    if (selectors.some(selector => canAffect(file, selector))) inspect(root, file, { candidate: true, states });
  }
}

// Unlike the Git-only SQL-source guard, compilers and fixture consumers can
// read ignored files. Such inputs cannot be admitted without a fingerprint.
// Call this only for consumed source/fixture selectors, never broad cache
// context such as frontend/ or dependency/build directories.
export function assertNoIgnoredProofInputs({ root, selectors }) {
  assertProofInputPaths({ root, files: [], selectors });
  if (selectors.length === 0) return;
  const scopes = [...new Set(selectors.map(selector => {
    if (selector.kind === 'glob') return literalRoot(selector.path);
    if (selector.kind === 'file') return selector.path;
    if (selector.kind === 'prefix') {
      return selector.path.endsWith('/') ? selector.path.slice(0, -1)
        : selector.path.slice(0, Math.max(0, selector.path.lastIndexOf('/')));
    }
    throw new UnsafeProofInputError(selector.path, `unknown selector kind ${selector.kind}`);
  }))];
  // Start at the top-level source/fixture directory: a more specific pathspec
  // can conceal an ignored ancestor (and some Git versions reject a pathspec
  // inside a wholly ignored directory). Ignored trees remain opaque below it.
  const roots = [...new Set(scopes.map(scope => scope.split('/')[0]))];
  const boundedScopes = roots.filter(scope => !roots.some(other =>
    other !== scope && (!other || scope.startsWith(`${other}/`))));
  // --directory keeps ignored node_modules/target trees opaque. Literal
  // pathspecs preserve route brackets and prevent input paths acting as globs.
  const candidates = execFileSync('git', [
    'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--',
    ...boundedScopes.map(scope => `:(literal)${scope || '.'}`),
  ], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
  const relevant = candidates.filter(candidate => {
    const path = candidate.replace(/\/$/, '');
    let stat;
    try { stat = lstatSync(join(root, path)); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
    return selectors.some(selector => {
      if (stat.isDirectory() || stat.isSymbolicLink()) return canAffect(path, selector);
      if (selector.kind === 'glob') return matchesGlob(path, selector.path);
      if (selector.kind === 'prefix') return path.startsWith(selector.path);
      return path === selector.path;
    });
  });
  if (relevant.length === 0) return;
  // With --directory, Git can list unignored ancestor directories that contain
  // only ignored children. Confirm actual ignore status to avoid false rejects.
  let ignored;
  try {
    ignored = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root, input: `${relevant.join('\0')}\0`, maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8').split('\0').filter(Boolean);
  } catch (error) {
    if (error.status === 1 && error.stdout?.length === 0) return;
    throw error;
  }
  if (ignored.length > 0) {
    const path = ignored.sort()[0].replace(/\/$/, '');
    throw new UnsafeProofInputError(path, 'ignored source or fixture input is not fingerprinted; track it or remove it');
  }
}

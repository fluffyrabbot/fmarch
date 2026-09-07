#!/usr/bin/env node
// A deliberately bounded declaration reader, not a Rust compiler or serde schema generator.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const OUTPUT = 'docs/reference/rust-contracts.md';
export const SOURCES = [
  ['crates/domain/src/ir.rs', [
    'IrAbility', 'InvestigateMode', 'Modifier',
  ]],
  ['crates/domain/src/phase.rs', [
    'PhaseKind',
  ]],
  ['crates/domain/src/state.rs', [
    'SlotLifecycle', 'Submission', 'StateSnapshot', 'ActionUseRecord',
    'ActionCounterRecord', 'ActionGrantRecord', 'LinkRecord', 'RetaliationRecord',
    'ConversionOriginRecord', 'EffectRecord', 'SlotState', 'Seed',
    'LogicalTime',
  ]],
  ['crates/eventstore/src/lib.rs', [
    'ActorId', 'EventInput', 'StoredEvent',
  ]],
  ['crates/domain/src/events.rs', [
    'InnerEvent', 'ResolutionApplied', 'ResolutionTrace', 'DayVoteOutcome',
    'VoteStatus', 'DayAnnouncement', 'LastWordsRecorded', 'LastWordsVoteSummary',
    'PhaseAnnouncement', 'Death',
  ]],
  ['crates/game_platform/src/lib.rs', [
    'DayEventState', 'DayEventResolutionMode', 'ConcreteEffect', 'DayProgram',
    'DayEventEvent', 'DayEvent', 'NarrativeTemplate', 'EventChannelPolicy',
    'UnixSeconds', 'DurationSeconds', 'DayEventSchedule', 'ParticipationSpec',
    'RewardBinding', 'RewardEffectTemplate', 'EffectPlan', 'DayEventDecision',
    'ParticipationPayload',
  ]],
  ['crates/domain/src/pack/model.rs', [
    'Pack', 'Role', 'ActionTemplate', 'Constraints',
    'PrecedenceRule', 'VisibilityRule', 'ResultOverride', 'RedirectPolicy',
    'RedirectKind', 'TriggerRule', 'TriggerOn', 'TriggerEvent',
    'ActorRef', 'TargetRef', 'VotePolicy', 'DynamicVoteWeightPolicy',
    'DynamicVoteWeightRule', 'DynamicVoteWeightGrantRule', 'HostPromptResolutionEffectPolicy', 'PhasePolicy',
    'WinPolicy', 'WinRule', 'WinCondition',
  ]],
  ['crates/domain/src/resolver.rs', [
    'ResolutionInput', 'ResolutionOutput',
  ]],
];

export function rustTokens(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    if (rest.startsWith('//')) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
    if (rest.startsWith('/*')) {
      let depth = 1; i += 2;
      while (depth && i < source.length) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('unterminated Rust block comment');
      continue;
    }
    const raw = /^(?:b|c)?r(#{0,255})"/.exec(rest);
    let end;
    if (raw) {
      const close = '"' + raw[1];
      end = source.indexOf(close, i + raw[0].length);
      if (end < 0) throw new Error('unterminated Rust raw string');
      end += close.length;
    } else {
      const quoted = /^(?:b|c)?"(?:\\[\s\S]|[^"\\])*"/.exec(rest);
      const char = /^(?:b)?'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'/u.exec(rest);
      const word = /^(?:r#)?[A-Za-z_][A-Za-z_0-9]*|^\d[\w.]*/.exec(rest);
      if (/^(?:b|c)?"/.test(rest) && !quoted) throw new Error('unterminated Rust string');
      end = i + (quoted?.[0].length ?? char?.[0].length ?? word?.[0].length ?? 1);
    }
    tokens.push({ text: source.slice(i, end), start: i }); i = end;
  }
  return tokens;
}

const pairs = { '{': '}', '(': ')', '[': ']', '<': '>' };
function group(tokens, at) {
  const close = pairs[tokens[at]?.text];
  if (!close) throw new Error('expected Rust delimiter');
  const stack = [close];
  for (let i = at + 1; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (pairs[t]) stack.push(pairs[t]);
    else if (Object.values(pairs).includes(t)) {
      if (stack.pop() !== t) throw new Error(`unbalanced Rust delimiter ${t}`);
      if (!stack.length) return i;
    }
  }
  throw new Error('unterminated Rust declaration');
}
function attributes(tokens) {
  let i = 0;
  while (tokens[i]?.text === '#') {
    if (tokens[i + 1]?.text !== '[') throw new Error('unsupported Rust attribute');
    const end = group(tokens, i + 1);
    const name = tokens[i + 2]?.text;
    if (name === 'cfg' || name === 'cfg_attr') throw new Error('conditional members need an explicit reference policy');
    i = end + 1;
  }
  return tokens.slice(i);
}
function entries(tokens) {
  const result = []; let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (pairs[tokens[i].text]) i = group(tokens, i);
    else if (tokens[i].text === ',') { result.push(tokens.slice(start, i)); start = i + 1; }
  }
  if (start < tokens.length) result.push(tokens.slice(start));
  return result.filter(x => x.length);
}
function renderTokens(tokens) {
  return tokens.map(t => t.text).join(' ').replace(/\s*:\s*:\s*/g, '::')
    .replace(/\s*([<>\[\]()])/g, '$1').replace(/([<\[(])\s*/g, '$1')
    .replace(/\s*,\s*/g, ', ').replace(/\s*:\s*/g, ': ').replace(/: : /g, '::')
    .replace(/&\s+/g, '&').trim();
}
function field(tokens, named) {
  tokens = attributes(tokens);
  if (tokens[0]?.text === 'pub') {
    tokens = tokens.slice(1);
    if (tokens[0]?.text === '(') tokens = tokens.slice(group(tokens, 0) + 1);
  }
  if (named && (!/^\w+$/.test(tokens[0]?.text ?? '') || tokens[1]?.text !== ':')) throw new Error('unsupported named Rust field');
  if (!tokens.length || (named && tokens.length < 3)) throw new Error('empty Rust field');
  return renderTokens(tokens);
}
export function readDeclaration(source, name) {
  const tokens = rustTokens(source); const candidates = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].text === 'pub' && ['enum', 'struct', 'type'].includes(tokens[i + 1].text) && tokens[i + 2].text === name) candidates.push(i);
  }
  if (candidates.length !== 1) throw new Error(`expected exactly one public declaration for ${name}, got ${candidates.length}`);
  const i = candidates[0]; const kind = tokens[i + 1].text; const open = i + 3;
  const line = source.slice(0, tokens[i].start).split('\n').length;
  if (kind === 'type') {
    if (tokens[open]?.text !== '=') throw new Error(`${name}: only nongeneric type aliases are supported`);
    const end = tokens.findIndex((token, index) => index > open && token.text === ';');
    if (end < 0 || end === open + 1) throw new Error(`${name}: missing alias target`);
    const target = tokens.slice(open + 1, end);
    // Validate nested delimiters using the same bounded syntax as field types.
    entries(target);
    return { name, kind, line, members: [{ name: 'Target', declaration: renderTokens(target) }] };
  }
  if (kind === 'struct' && tokens[open]?.text === '(') {
    const end = group(tokens, open);
    if (tokens[end + 1]?.text !== ';') throw new Error(`${name}: unsupported tuple struct suffix`);
    const members = entries(tokens.slice(open + 1, end)).map((entry, index) => ({ name: String(index), declaration: field(entry, false) }));
    if (!members.length) throw new Error(`${name}: empty declaration`);
    return { name, kind, line, members };
  }
  if (tokens[open]?.text !== '{') throw new Error(`${name}: unsupported declaration shape`);
  const end = group(tokens, open);
  const members = entries(tokens.slice(open + 1, end)).map(entry => {
    const t = attributes(entry);
    if (kind === 'struct') {
      const declaration = field(t, true);
      return { name: declaration.slice(0, declaration.indexOf(':')), declaration };
    }
    const member = t[0]?.text;
    if (!/^[A-Za-z_]\w*$/.test(member ?? '')) throw new Error(`${name}: unsupported variant`);
    if (t.length === 1) return { name: member, declaration: 'unit' };
    const opening = t[1]?.text;
    if (!['{', '('].includes(opening) || group(t, 1) !== t.length - 1) throw new Error(`${name}::${member}: unsupported variant shape`);
    const fields = entries(t.slice(2, -1)).map(e => field(e, opening === '{'));
    return { name: member, declaration: opening === '{' ? `{ ${fields.join(', ')} }` : `(${fields.join(', ')})` };
  });
  if (!members.length) throw new Error(`${name}: empty declaration`);
  return { name, kind, line: source.slice(0, tokens[i].start).split('\n').length, members };
}
function code(value) { return '<code>' + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;') + '</code>'; }
export async function renderReference(root = ROOT) {
  const lines = ['<!-- Generated by tools/rust_reference.mjs; do not edit. -->', '# Rust contract reference', '',
    'Regenerate with `npm run generate:rust-reference`; verify with `npm run check:rust-reference`.', '',
    'These tables are source declarations, not JSON/CBOR schemas. They include tuple',
    'payload type names without recursively expanding them. Follow the source links',
    'for serde attributes, visibility, conditional type derives, docs, and runtime validation.',
    'Tuple-field rows describe representation; they do not imply public constructors.',
    'The bounded reader rejects unsupported selected declaration/member shapes;',
    'it does not expand macros, evaluate cfg, or resolve Rust types.', ''];
  for (const [file, names] of SOURCES) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const name of names) {
      const d = readDeclaration(source, name);
      lines.push(`## ${name}`, '', `Source: [${file}](../../${file}#L${d.line}) (${d.kind}).`, '',
        '| Member | Rust declaration |', '|---|---|', ...d.members.map(m => `| ${code(m.name)} | ${code(m.declaration)} |`), '');
    }
  }
  return lines.join('\n');
}
export async function checkReference(root = ROOT) {
  const expected = await renderReference(root);
  const current = await readFile(path.join(root, OUTPUT), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (current !== expected) throw new Error(`${OUTPUT} is stale or missing; run npm run generate:rust-reference`);
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('Usage: rust_reference.mjs --write|--check');
  if (args[0] === '--write') { await mkdir(path.dirname(path.join(ROOT, OUTPUT)), { recursive: true }); await writeFile(path.join(ROOT, OUTPUT), await renderReference()); }
  else await checkReference();
  console.log(`${OUTPUT}: ${args[0] === '--write' ? 'generated' : 'current'}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });

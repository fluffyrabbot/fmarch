#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import GithubSlugger from 'github-slugger';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
function walk(node, visit) { visit(node); for (const child of node.children ?? []) walk(child, visit); }
function plain(node) { return node.value ?? (node.children ?? []).map(plain).join(''); }
export function anchors(tree) {
  const result = new Set(); const slugger = new GithubSlugger();
  walk(tree, node => {
    if (node.type === 'heading') result.add(slugger.slug(plain(node)));
    if (node.type === 'html') for (const match of node.value.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  });
  return result;
}
export function npmCommands(value) {
  const commands = [];
  for (const match of value.matchAll(/\bnpm\s+(?:--prefix\s+([\w./-]+)\s+)?run\s+(?:--prefix\s+([\w./-]+)\s+)?([\w][\w:.-]*)/g)) {
    commands.push({ prefix: match[1] ?? match[2] ?? '.', name: match[3] });
  }
  return commands;
}
export async function checkDocumentation(root = ROOT, files) {
  files ??= execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const inventory = new Set(files); const issues = []; const trees = new Map(); const packages = new Map();
  async function tree(file) { if (!trees.has(file)) trees.set(file, fromMarkdown(await readFile(path.join(root, file), 'utf8'))); return trees.get(file); }
  for (const file of files.filter(f => /\.md$/i.test(f))) {
    const document = await tree(file); const definitions = new Map(); const nodes = [];
    walk(document, node => { nodes.push(node); if (node.type === 'definition') definitions.set(node.identifier, node.url); });
    for (const node of nodes) {
      const report = message => issues.push(`${file}:${node.position?.start.line ?? 1}: ${message}`);
      const url = ['link', 'image'].includes(node.type) ? node.url : ['linkReference', 'imageReference'].includes(node.type) ? definitions.get(node.identifier) : undefined;
      if (url !== undefined && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        let target, fragment;
        try { const split = url.split('#'); target = decodeURIComponent(split[0].split('?')[0]); fragment = decodeURIComponent(split.slice(1).join('#')); }
        catch { report(`invalid URL encoding: ${url}`); continue; }
        const resolved = target ? path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(file), target)) : file;
        if (!inventory.has(resolved) && !files.some(f => f.startsWith(resolved.replace(/\/$/, '') + '/'))) report(`missing local link: ${url}`);
        else if (fragment && /\.md$/i.test(resolved) && !anchors(await tree(resolved)).has(fragment)) report(`missing heading: ${url}`);
        else if (/^L\d+(?:-L\d+)?$/.test(fragment) && inventory.has(resolved)) {
          const count = (await readFile(path.join(root, resolved), 'utf8')).split('\n').length;
          if (fragment.match(/\d+/g).some(n => Number(n) > count || Number(n) < 1)) report(`invalid source line: ${url}`);
        }
      }
      if (['code', 'inlineCode'].includes(node.type)) for (const command of npmCommands(node.value)) {
        const manifest = path.posix.join(command.prefix, 'package.json');
        if (!packages.has(manifest)) packages.set(manifest, inventory.has(manifest) ? JSON.parse(await readFile(path.join(root, manifest), 'utf8')).scripts ?? {} : null);
        const scripts = packages.get(manifest);
        if (!scripts || !Object.hasOwn(scripts, command.name)) report(`unknown npm script: ${command.prefix}: ${command.name}`);
      }
    }
  }
  return issues;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = await checkDocumentation();
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
  else console.log('Documentation links and npm scripts are current.');
}

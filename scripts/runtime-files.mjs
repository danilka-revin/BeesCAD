#!/usr/bin/env node
// Какие файлы нужны установленной программе (~/.local/share/beescad).
//
// Список собирается по графу локальных импортов от точек входа
// (scripts/server.mjs, scripts/update.mjs), поэтому новый модуль попадает
// в установку автоматически. Проверка --check ловит неполную установку заранее.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(HERE, '..');

export const ENTRY_FILES = ['scripts/server.mjs', 'scripts/update.mjs'];
export const ASSET_FILES = ['scripts/icon.svg'];

const SPECIFIER_RE = /\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g;

function stripComments(code) {
  const CODE = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TPL = 5;
  let out = '';
  let state = CODE;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];
    if (state === CODE) {
      if (c === '/' && next === '/') { state = LINE; i++; continue; }
      if (c === '/' && next === '*') { state = BLOCK; i++; continue; }
      if (c === "'") state = SQ;
      else if (c === '"') state = DQ;
      else if (c === '`') state = TPL;
    } else if (state === LINE) {
      if (c === '\n') { state = CODE; out += c; }
      continue;
    } else if (state === BLOCK) {
      if (c === '*' && next === '/') { state = CODE; i++; } else if (c === '\n') out += c;
      continue;
    } else if (c === '\\') {
      out += c + (next ?? '');
      i++;
      continue;
    } else if ((state === SQ && c === "'") || (state === DQ && c === '"') || (state === TPL && c === '`')) {
      state = CODE;
    }
    out += c;
  }
  return out;
}

function importsOf(file) {
  let code = '';
  try {
    code = stripComments(readFileSync(file, 'utf8'));
  } catch {
    return { files: [], missing: [] };
  }
  const files = [];
  const missing = [];
  for (const m of code.matchAll(SPECIFIER_RE)) {
    const spec = m[1] || m[2];
    const path = resolve(dirname(file), spec);
    if (existsSync(path)) files.push(path);
    else missing.push(spec);
  }
  return { files, missing };
}

export function runtimeFiles(srcDir = SRC_DIR) {
  const root = resolve(srcDir);
  const seen = new Set();
  const queue = [...ENTRY_FILES, ...ASSET_FILES].map((rel) => join(root, rel));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (!/\.m?js$/.test(file)) continue;
    for (const dep of importsOf(file).files) queue.push(dep);
  }
  return [...seen]
    .map((file) => relative(root, file).split(sep).join('/'))
    .sort();
}

export function missingRuntimeFiles(appDir) {
  const dir = resolve(appDir);
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return ['server.mjs'];
  }
  const missing = new Set();
  if (!entries.includes('server.mjs')) missing.add('server.mjs');
  for (const name of entries) {
    if (!/\.m?js$/.test(name)) continue;
    for (const spec of importsOf(join(dir, name)).missing) missing.add(basename(spec));
  }
  return [...missing].sort();
}

const launchedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return fileURLToPath(import.meta.url) === resolve(entry)
      || import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (launchedDirectly) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--check') {
    const dir = argv[1] || '';
    if (!dir) {
      console.error('нужен каталог: node scripts/runtime-files.mjs --check <каталог программы>');
      process.exit(2);
    }
    const missing = missingRuntimeFiles(dir);
    if (missing.length) {
      console.error('не хватает файлов программы: ' + missing.join(', '));
      process.exit(1);
    }
    console.log('файлы программы на месте: ' + dir);
    process.exit(0);
  }
  for (const rel of runtimeFiles(argv[0])) console.log(rel);
}

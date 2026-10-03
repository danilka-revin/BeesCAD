#!/usr/bin/env node
// Запись версии сборки в dist/version.json (после vite build).
// Версия = SHA коммита main/ветки, из которой собирали. Используется:
//  • сервером (endpoint /version),
//  • диалогом «О программе» в интерфейсе,
//  • автообновлением (scripts/update.mjs) для сравнения с GitHub.
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');

const git = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

// автообновление собирает из tar.gz без .git — SHA передаётся через окружение
const envSha = /^[0-9a-f]{40}$/i.test(process.env.BEESCAD_BUILD_SHA || process.env.PSBEES_BUILD_SHA || '')
  ? (process.env.BEESCAD_BUILD_SHA || process.env.PSBEES_BUILD_SHA)
  : '';
const sha = envSha || git('git rev-parse HEAD') || 'local';
const version = {
  sha,
  short: envSha ? envSha.slice(0, 7) : (git('git rev-parse --short HEAD') || sha.slice(0, 7)),
  branch: process.env.BEESCAD_BUILD_BRANCH || process.env.PSBEES_BUILD_BRANCH || git('git rev-parse --abbrev-ref HEAD') || '',
  built: new Date().toISOString(),
};

const dist = process.argv[2] ? join(root, process.argv[2]) : join(root, 'dist');
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'version.json'), JSON.stringify(version, null, 1) + '\n');
console.log(`версия сборки: ${version.short} (${version.branch || 'нет git'}, ${version.built})`);

#!/usr/bin/env node
// Downloads the public-domain Vector-Playing-Cards pack and copies cards-svg/* into public/cards.
//   npm run cards:download
// 1. tries `git clone --depth 1`; 2. falls back to the GitHub zip (unzip / tar).
// Afterwards it regenerates client/src/cards/cardImages.js from the real filenames.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/notpeter/Vector-Playing-Cards.git';
const ZIP = 'https://github.com/notpeter/Vector-Playing-Cards/archive/refs/heads/master.zip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public/cards');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vpc-'));

function findCardsSvg(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'cards-svg') return full;
    const nested = findCardsSvg(full);
    if (nested) return nested;
  }
  return null;
}

function tryGit() {
  const res = spawnSync('git', ['clone', '--depth', '1', REPO, path.join(work, 'vpc')], { stdio: 'inherit' });
  return res.status === 0 ? findCardsSvg(path.join(work, 'vpc')) : null;
}

async function tryZip() {
  console.log(`git unavailable or failed; downloading ${ZIP}`);
  const res = await fetch(ZIP);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const zipPath = path.join(work, 'vpc.zip');
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  const out = path.join(work, 'unzipped');
  fs.mkdirSync(out);
  const attempts = [
    ['unzip', ['-q', zipPath, '-d', out]],
    ['tar', ['-xf', zipPath, '-C', out]],
  ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.status === 0) return findCardsSvg(out);
  }
  throw new Error('Could not extract the zip (need `unzip` or a `tar` that understands zip files).');
}

try {
  const src = tryGit() ?? (await tryZip());
  if (!src) throw new Error('cards-svg folder not found in the download.');
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    if (!/\.svg$/i.test(f)) continue;
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
    n++;
  }
  console.log(`Copied ${n} SVG files to ${path.relative(root, dest)}`);
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-card-map.mjs')], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'scripts/check-cards.mjs')], { stdio: 'inherit' });
} catch (e) {
  console.error(`\nCould not download the card pack: ${e.message}`);
  console.error('The app still works with generated fallback cards. To add the real artwork manually,');
  console.error(`copy the files from the "cards-svg" folder of ${REPO.replace('.git', '')} into public/cards/`);
  console.error('then run: npm run cards:map');
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

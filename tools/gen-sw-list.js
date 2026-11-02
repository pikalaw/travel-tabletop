#!/usr/bin/env node
// Writes the list of shipped files and a content-hash version into sw.js.
// Run before every release:  node tools/gen-sw-list.js
// A stale version leaves installed devices on the old app, so this is part of release.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SHIP = ['index.html', 'manifest.json', 'styles.css', 'src', 'vendor', 'assets'];
const SKIP = /\.d\.ts$|\.map$|\.DS_Store$/;

function walk(p) {
  const s = statSync(p);
  if (s.isDirectory()) return readdirSync(p).sort().flatMap((n) => walk(join(p, n)));
  return SKIP.test(p) ? [] : [p];
}

const files = SHIP.flatMap((p) => walk(join(root, p))).map((f) => relative(root, f).split('\\').join('/'));
const hash = createHash('sha256');
for (const f of files) { hash.update(f); hash.update(readFileSync(join(root, f))); }
const appVersion = /APP_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'src/version.js'), 'utf8'))[1];
const version = `${appVersion}-${hash.digest('hex').slice(0, 10)}`;

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const list = ['./', ...files.map((f) => `./${f}`)];
const out = sw
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const FILES = \[[\s\S]*?\];/, `const FILES = ${JSON.stringify(list, null, 2)};`);
writeFileSync(join(root, 'sw.js'), out);
console.log(`sw.js: version ${version}, ${list.length} files`);

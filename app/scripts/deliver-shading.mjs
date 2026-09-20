/** THE I5.5 DELIVER — write a `compose:shading` artifact into the consuming app's own
 *  tracked factory-bank seed (`app/js/formats/_sdf-factory-banks.js`'s MACHINE-WRITTEN
 *  region — see that file's own header). NOT the kv-merge transport P2.10.5 names for a
 *  per-machine write: the operator's ruling for THIS run was the shipped, tracked seed
 *  (`_sdf-factory-banks.js` header, operator verbatim: "I consider all of these 'base
 *  presets' to be the same as 'base sliders'/knobs ... it WILL be product.").
 *
 *  Replaces ONLY the `var BANKS = { … };` literal — found by brace-balancing from `var
 *  BANKS = `, the same technique `core/rosters.ts readNamedLiteral` uses to READ a literal
 *  without touching anything around it. Everything before and after (the header comment,
 *  the two `if` exports, the IIFE wrapper) is preserved byte-for-byte.
 *
 *  Verifies the written file `require()`s clean and the bank/slot counts match the source
 *  artifact — a corrupted rewrite must fail LOUDLY, never ship silently.
 *
 *    node --run deliver:shading -- --in data/shading-compose-latest.json \
 *      --target /Users/exiledm4air/gits/visualeyes/app/js/formats/_sdf-factory-banks.js
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';

const argv = process.argv.slice(2);
const arg = (n,d) => { const i = argv.indexOf('--'+n); return i>=0 ? argv[i+1] : d; };
const fail = (m) => { console.error('DELIVER FAILED: ' + m); process.exit(1); };

const cfg = loadConfig();
const inPath = arg('in', join(cfg.dataDir, 'shading-compose-latest.json'));
const targetPath = arg('target',
  join(cfg.appRoot, 'js', 'formats', '_sdf-factory-banks.js'));

let artifact;
try { artifact = JSON.parse(readFileSync(inPath, 'utf8')); }
catch (e) { fail(`cannot read compose artifact at ${inPath} — ${e?.message ?? e}`); }
if (!artifact.banks || typeof artifact.banks !== 'object') fail(`${inPath} carries no "banks" object`);

const src = readFileSync(targetPath, 'utf8');
const marker = 'var BANKS = ';
const at = src.indexOf(marker);
if (at < 0) fail(`no "${marker}" literal in ${targetPath} — it was renamed or the file moved`);
const open = at + marker.length;
if (src[open] !== '{') fail(`"${marker}" is not followed by an object literal in ${targetPath}`);

// Brace-balance to the matching close, skipping strings/comments — mirrors
// `core/rosters.ts readNamedLiteral`'s scanner exactly, so a value that happens to embed
// `{`/`}` inside a quoted string (a label) can never mis-close the scan.
let depth = 0, end = -1, inStr = null;
for (let i = open; i < src.length; i++) {
  const c = src[i];
  if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) fail(`the "${marker}" literal in ${targetPath} is not brace-balanced`);
// Consume the trailing `;` the header shows after the closing brace.
let semi = end + 1;
while (src[semi] === ' ') semi++;
if (src[semi] !== ';') fail(`"${marker}{...}" in ${targetPath} is not followed by ";" — refusing to guess the boundary`);

const newLiteral = JSON.stringify(artifact.banks, null, 2);
const rewritten = src.slice(0, open) + newLiteral + src.slice(semi);
writeFileSync(targetPath, rewritten);

// ── verify: require() clean, and the bank/slot counts match what was written ──────────
const require_ = createRequire(import.meta.url);
const modPath = require_.resolve(targetPath);
delete require_.cache[modPath];
const loaded = require_(targetPath);

const bankIds = Object.keys(artifact.banks);
const problems = [];
for (const gid of bankIds) {
  const wantSlots = Object.keys(artifact.banks[gid].presets ?? {});
  const got = loaded[gid]?.presets ?? {};
  const gotSlots = Object.keys(got);
  if (gotSlots.length !== wantSlots.length)
    problems.push(`${gid}: wrote ${wantSlots.length} slots, require() reads back ${gotSlots.length}`);
  for (const s of wantSlots) if (!(s in got)) problems.push(`${gid}: slot ${s} missing on read-back`);
}
if (problems.length) fail('read-back mismatch:\n  ' + problems.join('\n  '));

console.log(JSON.stringify({
  run:'deliver:shading', target: targetPath, source: inPath,
  banks: bankIds.length,
  slotsPerBank: Object.fromEntries(bankIds.map(g => [g, Object.keys(artifact.banks[g].presets ?? {}).length])),
  bytesWritten: rewritten.length,
  requireOk: true
}, null, 2));

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
 *  ── AND IT VERIFIES THE PICTURE (decision-models.md §P2.10.6, 2026-09-20) ────────────
 *  A read-back check proves the FILE is intact and says nothing about what the slots do.
 *  Operator, on the set this script delivered the first time: "only TWO render on the
 *  object, everything else is black." So EVERY delivered slot — all 121 — is rendered
 *  headless on the resolver-picked subject through `app/tools/render-shading-look.js`,
 *  and a single invisible slot REFUSES THE DELIVERY. This is the last line: compose
 *  filters candidates, this proves what actually landed.
 *
 *  A child-bank slot is rendered over the record's own defaults; a `surface` slot is a
 *  whole look and is rendered as it is. Both are how the operator will meet them.
 *
 *    node --run deliver:shading -- --in data/shading-compose-latest.json \
 *      --target /Users/exiledm4air/gits/visualeyes/app/js/formats/_sdf-factory-banks.js
 *      [--no-render-check]  [--render-port 8098]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {RenderGate} from '../core/render-gate.js';

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

// ── the picture check — every slot, on the real subject ──────────────────────────────
let renderReport = {present:false, note:'--no-render-check'};
if (!argv.includes('--no-render-check')) {
  const gate = await RenderGate.open(cfg.appRoot,
    {port: parseInt(arg('render-port','8098'),10)});
  const black = [];
  for (const gid of bankIds) {
    const presets = artifact.banks[gid].presets ?? {};
    for (const slot of Object.keys(presets).sort((a,b)=>Number(a)-Number(b))) {
      const params = presets[slot]?.values?.params ?? {};
      const v = await gate.check(`${gid}:${slot}`, params);
      if (!v.visible) black.push({bank:gid, slot, name:presets[slot]?.name ?? null,
        reason:v.reason, avgLuma:v.metrics?.avgLuma ?? null, darkFrac:v.metrics?.darkFrac ?? null});
    }
  }
  renderReport = {
    present:true, subject:gate.subject, thresholds:gate.thresholds,
    defaultMetrics:gate.defaultMetrics, checked:gate.requests, black,
    perSlot: gate.log.map(e => ({id:e.id, visible:e.visible, reason:e.reason,
      avgLuma:e.avgLuma, darkFrac:e.darkFrac}))
  };
  await gate.close();
  if (black.length) {
    // The file on disk is already rewritten at this point — say so plainly rather than
    // leaving a reader to wonder, and name every black slot so the next compose can be
    // aimed rather than guessed at.
    console.error(JSON.stringify({blackSlots:black}, null, 2));
    fail(`${black.length} of ${gate.requests} delivered slot(s) render BLACK on ${gate.subject.label} — ` +
      `the file at ${targetPath} was written but MUST NOT ship; re-compose (the black slots are listed above).`);
  }
}

console.log(JSON.stringify({
  run:'deliver:shading', target: targetPath, source: inPath,
  renderCheck: renderReport.present
    ? {subject: renderReport.subject.label, checked: renderReport.checked, black: renderReport.black.length,
       thresholds: renderReport.thresholds}
    : renderReport,
  banks: bankIds.length,
  slotsPerBank: Object.fromEntries(bankIds.map(g => [g, Object.keys(artifact.banks[g].presets ?? {}).length])),
  bytesWritten: rewritten.length,
  requireOk: true
}, null, 2));

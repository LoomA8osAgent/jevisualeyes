/** THE RELABEL-ONLY RUN — no new decisions, no network. The coordinator's last fix: two
 *  surface looks shared a label ("flat, warm" at looks 3 and 10); a broader check then found
 *  every child bank had collisions too ("base color: set" on all 11 of `sub:color`'s slots).
 *  Labels are a PURE function of already-decided content (a look's own knob draws, or a
 *  surface look's own coordinate) — nothing here calls Laya or samples a new value.
 *
 *  CHILD BANKS: `stratifiedBankSlots` is deterministic in (gid, seed, rosters) — re-running
 *  it with the artifact's OWN stored `seed`/`oversample` reproduces byte-identical `params`
 *  to what is already delivered (asserted below, not assumed), so only `disambiguateLabels`'
 *  OUTPUT (the `.name` fields) changes.
 *
 *  SURFACE: the childSlots/params came from LIVE Laya decisions and are NEVER recomputed —
 *  `parseCoordinateLine` recovers each look's stored coordinate from `surfaceSummary[].
 *  coordinate` (the string `coordinateLine` already wrote), and `disambiguateCoordinateLabels`
 *  resolves the same 11 coordinates to unique labels in slot order. Params and childSlots
 *  are asserted byte-identical before and after.
 *
 *    node --run relabel:shading -- --in data/shading-compose-latest.json
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {loadRosters} from '../core/rosters.js';
import {shadingChildren, bankKnobs} from '../core/shading.js';
import {stratifiedBankSlots, disambiguateLabels, parseCoordinateLine,
  disambiguateCoordinateLabels} from '../core/shading-samplers.js';
import {hashJSON} from '../core/hash.js';

const argv = process.argv.slice(2);
const arg = (n,d) => { const i = argv.indexOf('--'+n); return i>=0 ? argv[i+1] : d; };
const cfg = loadConfig();
const inPath = arg('in', join(cfg.dataDir, 'shading-compose-latest.json'));

const artifact = JSON.parse(readFileSync(inPath, 'utf8'));
const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const children = shadingChildren(rosters);
const SLOTS = 11;

const beforeChildSlots = artifact.surfaceSummary.map(s => ({...s.childSlots}));
const beforeSurfaceParams = artifact.surfaceSummary.map(s => hashJSON(artifact.banks.surface.presets[s.slot].values.params));
const beforeChildParams = {};
for (const gid of children) beforeChildParams[gid] = Object.fromEntries(
  Object.entries(artifact.banks[gid].presets).map(([slot,p]) => [slot, hashJSON(p.values.params)]));

const renames = [];

// ── child banks — re-derive (pure), verify identity, relabel ────────────────────────────
for (const gid of children) {
  if (!bankKnobs(gid, rosters).length) continue;
  const {looks} = stratifiedBankSlots(gid, rosters, artifact.seed, SLOTS, artifact.oversample);
  looks.forEach((l, i) => {
    const stored = artifact.banks[gid].presets[String(i+1)].values.params;
    if (hashJSON(l.params) !== hashJSON(stored))
      throw new Error(`relabel-shading: ${gid} slot ${i+1} params changed on re-derivation — ` +
        `this is a RECOMPOSE, not a relabel. Refusing.`);
  });
  const names = disambiguateLabels(looks);
  names.forEach((name, i) => {
    const slot = String(i+1);
    const old = artifact.banks[gid].presets[slot].name;
    artifact.banks[gid].presets[slot].name = name;
    if (old !== name) renames.push({bank:gid, slot, from:old, to:name});
  });
}

// ── surface — labels only, from the STORED coordinate strings, in stored slot order ─────
{
  const order = artifact.surfaceSummary.map(s => Number(s.slot)).sort((a,b) => a-b);
  const coords = order.map(slot => {
    const entry = artifact.surfaceSummary.find(s => Number(s.slot) === slot);
    return parseCoordinateLine(entry.coordinate);
  });
  const names = disambiguateCoordinateLabels(coords);
  order.forEach((slot, i) => {
    const key = String(slot);
    const old = artifact.banks.surface.presets[key].name;
    artifact.banks.surface.presets[key].name = names[i];
    const summaryEntry = artifact.surfaceSummary.find(s => Number(s.slot) === slot);
    summaryEntry.label = names[i];
    if (old !== names[i]) renames.push({bank:'surface', slot:key, from:old, to:names[i]});
  });
}

// ── verify: uniqueness per bank, and NOTHING besides `.name` moved ──────────────────────
const problems = [];
for (const [gid, bank] of Object.entries(artifact.banks)) {
  const names = Object.values(bank.presets).map(p => p.name);
  if (new Set(names).size !== names.length) problems.push(`${gid}: still has duplicate labels after relabel`);
}
const afterChildSlots = artifact.surfaceSummary.map(s => ({...s.childSlots}));
if (hashJSON(beforeChildSlots) !== hashJSON(afterChildSlots))
  problems.push('surface childSlots vectors changed — this must never happen in a relabel-only run');
artifact.surfaceSummary.forEach((s, i) => {
  const nowHash = hashJSON(artifact.banks.surface.presets[s.slot].values.params);
  if (nowHash !== beforeSurfaceParams[i]) problems.push(`surface slot ${s.slot}: params changed`);
});
for (const gid of children) for (const [slot, before] of Object.entries(beforeChildParams[gid])) {
  const now = hashJSON(artifact.banks[gid].presets[slot].values.params);
  if (now !== before) problems.push(`${gid} slot ${slot}: params changed`);
}
if (problems.length) throw new Error('relabel-shading refused:\n  ' + problems.join('\n  '));

artifact.relabeledAt = new Date().toISOString();
artifact.relabelRenames = renames;

writeFileSync(inPath, JSON.stringify(artifact, null, 2));
const ts = new Date().toISOString().replace(/[:.]/g,'-');
writeFileSync(join(cfg.dataDir, `shading-relabel-${ts}.json`), JSON.stringify({renames, relabeledAt:artifact.relabeledAt}, null, 2));

console.log(JSON.stringify({
  run:'relabel:shading', in:inPath,
  renamesCount: renames.length,
  renames: renames.filter(r => r.bank === 'surface'),
  childSlotsUnchanged: true, paramsUnchanged: true,
  uniquenessOk: true
}, null, 2));

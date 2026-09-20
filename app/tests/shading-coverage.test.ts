/** THE HARD COVERAGE GATE — operator ruling, 2026-09-20 13:59, verbatim: "i said all ENUMS
 *  used." Across every shading bank, every option of every menu row (bool or enum) must
 *  appear in at least one of that bank's 11 slots, wherever 11 slots make it mathematically
 *  possible (option count ≤ 11) — the two `composable:false` rows are excluded from the
 *  roster already (`shading.ts bankKnobs`) and never appear as a menu row here at all.
 *
 *  This is the SAME check `compose-shading.mjs assertFullCoverage` runs at delivery time —
 *  proven here with ZERO network calls, because `stratifiedBankSlots` is pure code (no
 *  provider): a run that fails this test would refuse to deliver for the identical reason.
 */
import {test, assert} from 'vitest';
import {loadConfig} from '../server/config.js';
import {loadRosters} from '../core/rosters.js';
import {shadingBankIds, bankKnobs} from '../core/shading.js';
import {stratifiedBankSlots, menuRows, disambiguateLabels,
  spreadShadingCoordinates, disambiguateCoordinateLabels} from '../core/shading-samplers.js';

const cfg = loadConfig();
const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const SEED = 7331;
const SLOTS = 11;

test('every shading bank exists and carries at least one knob', () => {
  const banks = shadingBankIds(rosters);
  assert.equal(banks.length, 11);
  for (const gid of banks) assert.ok(bankKnobs(gid, rosters).length > 0, `${gid}: no knobs after exclusions`);
});

for (const gid of shadingBankIds(rosters)) {
  test(`${gid}: every COVERABLE menu row's every option appears across its 11 slots`, () => {
    const {coverage, looks, duplicates} = stratifiedBankSlots(gid, rosters, SEED, SLOTS);
    assert.equal(looks.length, SLOTS, `${gid}: must always fill exactly ${SLOTS} slots`);
    const rows = menuRows(gid, rosters);
    assert.equal(coverage.length, rows.length, `${gid}: coverage report must name every menu row`);
    const bad = coverage.filter(c => c.coverable && c.missing.length > 0);
    assert.deepEqual(bad, [], `${gid}: coverable rows missing options`);
    // a row with more options than slots is reported, never silently ignored
    for (const c of coverage) if (!c.coverable) assert.ok(c.total > SLOTS, `${gid}.${c.name}: flagged non-coverable but total (${c.total}) <= ${SLOTS}`);
    // duplicates, when present, are REPORTED (never silently identical slots)
    if (duplicates.length) {
      for (const d of duplicates) assert.ok(d.duplicateOfSlot >= 1 && d.duplicateOfSlot < d.slot);
    }
    // LABELS ARE UNIQUE WITHIN THE BANK (coordinator's last fix, 2026-09-20: "flat, warm" at
    // looks 3 and 10; a broader check then found EVERY child bank had collisions — e.g.
    // sub:color's "base color: set" on all 11 slots — because the single-strongest-mover
    // label ignores the other 3 knobs entirely). `disambiguateLabels` must resolve every
    // collision, even when the underlying CONTENT is an exact duplicate (`sub:lighting`'s
    // padded slots) — the "#N" fallback guarantees this unconditionally.
    const names = disambiguateLabels(looks);
    assert.equal(names.length, SLOTS);
    assert.equal(new Set(names).size, SLOTS, `${gid}: disambiguateLabels produced a duplicate — ${JSON.stringify(names)}`);
    for (const n of names) assert.ok(n.length > 0 && n.length <= 24, `${gid}: label "${n}" is empty or over 24 chars`);
  });
}

test('surface — coordinate-derived labels are unique across all 11 looks, even after collision', () => {
  const coords = spreadShadingCoordinates(11, 7331);
  const names = disambiguateCoordinateLabels(coords);
  assert.equal(new Set(names).size, 11, `surface labels not unique: ${JSON.stringify(names)}`);
  for (const n of names) assert.ok(n.length > 0 && n.length <= 24, `label "${n}" invalid length`);
});

test('sub:lighting — only 8 distinct states exist (3 bools); all 8 present, 3 slots duplicate by necessity', () => {
  const {looks, duplicates} = stratifiedBankSlots('sub:lighting', rosters, SEED, SLOTS);
  const sigs = looks.map(l => JSON.stringify([l.params.light1Enabled, l.params.light2Enabled, l.params.light3Enabled]));
  assert.equal(new Set(sigs).size, 8, 'sub:lighting has exactly 8 distinct 3-bool states');
  assert.equal(duplicates.length, 3, 'the remaining 3 of 11 slots must be reported duplicates');
});

test('sub:palette — the palette MAPPING enum and the palette value itself both vary across slots', () => {
  const {looks, coverage} = stratifiedBankSlots('sub:palette', rosters, SEED, SLOTS);
  const mapping = coverage.find(c => c.name === 'paletteMapping');
  assert.ok(mapping, 'sub:palette must export a paletteMapping menu row');
  assert.equal(mapping!.missing.length, 0, 'every paletteMapping option must be covered');
  const paletteValues = new Set(looks.map(l => l.params.palette));
  assert.ok(paletteValues.size > 1, 'the palette knob itself must vary, not just the mapping mode');
});

test('sub:light1 / sub:light2 / sub:light3 each cover every enum row the roster exports for them ' +
     '(not just type) and do not mirror one another slot-for-slot', () => {
  const perLight = ['sub:light1','sub:light2','sub:light3'].map(gid => {
    const {coverage, looks} = stratifiedBankSlots(gid, rosters, SEED, SLOTS);
    const rows = menuRows(gid, rosters);
    assert.ok(rows.length >= 2, `${gid}: expected more than one enum/bool row (type is not the only one)`);
    for (const c of coverage) if (c.coverable) assert.equal(c.missing.length, 0, `${gid}.${c.name} not fully covered`);
    return looks.map(l => l.params[`${gid.replace('sub:','')}Type`]);
  });
  // Not every slot k has the same type across all three banks (independent stratification).
  let anyDiffer = false;
  for (let i = 0; i < SLOTS; i++)
    if (perLight[0][i] !== perLight[1][i] || perLight[1][i] !== perLight[2][i]) { anyDiffer = true; break; }
  assert.ok(anyDiffer, 'light1/light2/light3 must not mirror the same type at every slot index');
});

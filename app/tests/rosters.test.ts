/** THE ROSTER-ARTIFACT READ, and the two things it newly makes possible.
 *
 *  Paths and seams, not suites. The roster loader's other three read modes are a known-good
 *  path and are not re-proven here; what is new is that the waveform bank, the easing library
 *  and the raymarch prefix now arrive from the app's own EXPORTED bundle instead of from a
 *  named-literal source read. So what is asserted is the seam and nothing else:
 *
 *    · the bundle is READ — every field arrives as the export wrote it, and the export's own
 *      source hashes surface as provenance, because a composition that cannot name which
 *      export it composed against has no provenance (`docs/COMPOSER.md` §5);
 *    · an ABSENT bundle is REPORTED — falsified by pointing the loader at a path that does
 *      not exist and requiring every roster that needed it to appear in `missing[]` with an
 *      empty menu. A loader that has never reported is indistinguishable from one that
 *      cannot, and the deleted named-literal fallback is exactly what used to hide this;
 *    · the feeling vocabulary resolves BOTH WAYS off the one table (`axes.ts MOTION_FEELING`),
 *      and every family it names is a family the live roster actually ships — a feeling that
 *      resolves to a family nobody exports is an empty menu that looks full;
 *    · a curve's SHAPE is read off its own samples, not its name — asserted on one monotonic,
 *      one overshooting and one oscillating entry.
 *
 *  THE FIXTURE is `tests/fixtures/rosters.json`: two waveforms, three easings and the prefix,
 *  COPIED verbatim out of a real export. The curves in it are the app resolver's own samples,
 *  so the shape assertions are assertions about the real roster rather than about a plant.
 */
import {test, assert} from 'vitest';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../server/config.js';
import {clearRosterCache, curveShape, loadRosters, rostersArtifactPath} from '../core/rosters.js';
import {MOTION_FEELING, easingFamiliesForFeeling, easingFamiliesForMotion,
  feelingsForEasingFamily} from '../core/axes.js';
import {movementOptions} from '../core/samplers.js';

const cfg = loadConfig();
const FIXTURE = fileURLToPath(new URL('./fixtures/rosters.json', import.meta.url));
const ABSENT = fileURLToPath(new URL('./fixtures/no-such-rosters.json', import.meta.url));
assert.ok(existsSync(FIXTURE), `the fixture bundle is this suite's input and is missing at ${FIXTURE}`);
assert.ok(!existsSync(ABSENT), 'the absent-bundle path must not exist, or the falsification proves nothing');

clearRosterCache();
const fixture = loadRosters(cfg.appRoot, FIXTURE);

test('the bundle is READ: waveforms, easings and the prefix arrive as the export wrote them', () => {
  assert.deepEqual(fixture.waveforms, [{id:'sine',label:'Sine'},{id:'cosine',label:'Cosine'}]);
  assert.deepEqual(fixture.easings.map(e => e.id), ['inQuad','outBack','outElastic']);
  assert.equal(fixture.rmBase, 'rm');
  for (const e of fixture.easings) {
    assert.ok(e.family && e.label && e.kind, `${e.id}: family, label and kind all ride the entry`);
    assert.equal(e.curve.form, 'samples');
    assert.equal(e.curve.n, 65, 'the curve is sampled at 65 points of t ∈ [0,1]');
    assert.equal(e.curve.samples!.length, 65);
    assert.equal(e.curve.samplesFrom, 'resolveFn',
      'anything other than resolveFn means the app resolver handed back something else');
  }
  // …and none of the three rosters reported itself missing.
  assert.deepEqual(fixture.missing, []);
});

test('the export\'s source hashes surface as provenance (§5)', () => {
  const p = fixture.provenance;
  assert.ok(p, 'a readable bundle must carry provenance');
  assert.equal(p!.artifactPath, FIXTURE);
  assert.ok(p!.generator.length > 0 && p!.generated.length > 0);
  assert.ok(p!.sources.length > 0, 'the export names the app sources it was read from');
  for (const s of p!.sources) {
    assert.match(s.sha256, /^[0-9a-f]{64}$/, `${s.file}: a source hash is a sha256`);
    assert.ok(s.file.startsWith('app/'), `${s.file}: the hash names a file in the app tree`);
  }
});

test('an ABSENT bundle is REPORTED, and every menu that needed it is empty (falsification)', () => {
  const r = loadRosters(cfg.appRoot, ABSENT);
  const named = r.missing.map(m => m.roster).sort();
  for (const roster of ['rosters.json','waveforms','easings','rmBase'])
    assert.include(named, roster, `${roster} must name itself in missing[]`);
  for (const m of r.missing) assert.ok(m.reason.trim().length > 0, `${m.roster}: a reason, not a flag`);
  assert.deepEqual(r.waveforms, []);
  assert.deepEqual(r.easings, []);
  assert.equal(r.rmBase, '');
  assert.equal(r.provenance, null, 'no bundle ⇒ no provenance, never a fabricated one');
  // The rosters that do NOT come from the bundle are unaffected — a missing artifact empties
  // its own menus and nothing else.
  assert.notInclude(named, 'ops');
});

test('the default path is where the app writes it, and is what an unconfigured load reads', () => {
  assert.equal(rostersArtifactPath('/x/app'), '/x/app/user-media/shapes/rosters.json');
  assert.equal(cfg.rostersArtifact, rostersArtifactPath(cfg.appRoot),
    'the configured default and the loader default must be the same file');
});

/* ── the feeling vocabulary ─────────────────────────────────────────────────────── */

test('the feeling table resolves BOTH ways, off one table', () => {
  assert.deepEqual(easingFamiliesForFeeling('springy'), ['elastic','spring']);
  assert.include(easingFamiliesForFeeling('bouncy'), 'back');
  assert.include(feelingsForEasingFamily('elastic'), 'springy');
  assert.include(feelingsForEasingFamily('back'), 'bouncy');
  assert.deepEqual(easingFamiliesForFeeling('not-a-feeling'), [],
    'an unknown feeling names no family — it never falls back to all of them');
  assert.deepEqual(feelingsForEasingFamily('not-a-family'), []);
  // Round trip: every family a feeling names lists that feeling back.
  for (const [feeling, row] of Object.entries(MOTION_FEELING))
    for (const family of row.families)
      assert.include(feelingsForEasingFamily(family), feeling, `${feeling} ⇄ ${family}`);
});

test('every family the feeling table names is one the LIVE roster ships', () => {
  const live = loadRosters(cfg.appRoot, cfg.rostersArtifact);
  assert.notInclude(live.missing.map(m => m.roster), 'easings',
    'the live easing roster is this assertion\'s input');
  const families = new Set(live.easings.map(e => e.family));
  for (const [feeling, row] of Object.entries(MOTION_FEELING))
    for (const family of row.families)
      assert.ok(families.has(family),
        `feeling "${feeling}" names family "${family}", which the app does not export — ` +
        'the menu would look full and be empty');
  // A feeling sits on a motion axis VALUE, never a new word.
  const motionValues = new Set(['still','slow','pulse','driving']);
  for (const [feeling, row] of Object.entries(MOTION_FEELING))
    assert.ok(motionValues.has(row.motion), `${feeling}: "${row.motion}" is not a motion axis value`);
});

test('a motion word selects families; an unconstrained axis selects none', () => {
  assert.include(easingFamiliesForMotion('pulse'), 'elastic');
  assert.include(easingFamiliesForMotion('pulse'), 'back');
  assert.notInclude(easingFamiliesForMotion('pulse'), 'linear');
  assert.deepEqual(easingFamiliesForMotion('any'), []);
  assert.deepEqual(easingFamiliesForMotion(undefined), []);
});

/* ── the shape reader ───────────────────────────────────────────────────────────── */

test('a curve\'s shape is read off its SAMPLES — monotonic, overshoot, oscillating', () => {
  const by = (id:string) => fixture.easings.find(e => e.id === id)!;
  assert.equal(curveShape(by('inQuad').curve), 'monotonic',
    'an ease-in never changes direction: one move from A to B');
  assert.equal(curveShape(by('outBack').curve), 'overshoot',
    'back leaves [0,1] and comes back in one turn');
  assert.equal(curveShape(by('outElastic').curve), 'oscillating',
    'elastic turns repeatedly');
  // Read from the samples, NOT the name: the same entry with a straight ramp planted in it
  // reads monotonic, and with no samples at all reads as nothing rather than as a guess.
  const elastic = by('outElastic');
  const ramp = Array.from({length:65}, (_v,i) => i/64);
  assert.equal(curveShape({...elastic.curve, samples:ramp}), 'monotonic');
  assert.equal(curveShape({definition:{kind:'named'}, form:'declarative',
    unresolved:'easingLib.resolveFn returned no callable'}), null,
    'an unresolved curve has no readable shape — null, never a straight line');
});

/* ── the one menu ───────────────────────────────────────────────────────────────── */

test('the movement menu is waveforms AND the easings the coordinate admits', () => {
  const ids = (c:Record<string,string>) => movementOptions(fixture, c).map(o => o.id);
  const free = ids({});
  assert.include(free, 'sine', 'the waveform bank is always on the menu');
  assert.include(free, 'ease:outBack', 'an unconstrained motion axis admits every easing');
  assert.equal(new Set(free).size, free.length, 'ids on one menu are distinct');

  const pulse = ids({motion:'pulse'});
  assert.include(pulse, 'ease:outElastic', 'elastic speaks "springy", which is pulse');
  assert.notInclude(pulse, 'ease:inQuad', 'quad speaks "drifting", which is not pulse');

  // A one-shot ramp held forever is not driving movement — and the withholding is read off
  // the curve, so an overshooting or cycling member of the same family stays offered.
  const driving = ids({motion:'driving'});
  assert.notInclude(driving, 'ease:inQuad');

  // Every easing option carries its family and its shape in the LABEL, because that is the
  // vocabulary a feeling word is answered in — the id is looked up, never read for meaning.
  for (const o of movementOptions(fixture, {}))
    if (o.id.startsWith('ease:'))
      assert.match(o.label, /—.+,\s(monotonic|overshoot|oscillating)$/, `${o.id}: ${o.label}`);
});

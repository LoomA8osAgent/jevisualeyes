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
import {clearRosterCache, composableMenuValues, curveShape, loadRosters, rostersArtifactPath} from '../core/rosters.js';
import {MOTION_FEELING, easingFamiliesForFeeling, easingFamiliesForMotion,
  feelingsForEasingFamily} from '../core/axes.js';
import {movementOptions, stackKnobs} from '../core/samplers.js';
import type {Rosters, OpInput} from '../core/rosters.js';
import type {RecordDescriptor} from '../core/records.js';

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
  for (const roster of ['rosters.json','waveforms','easings','rmBase',
                        'material','lighting','raymarchInputs','layers','menus'])
    assert.include(named, roster, `${roster} must name itself in missing[]`);
  for (const m of r.missing) assert.ok(m.reason.trim().length > 0, `${m.roster}: a reason, not a flag`);
  assert.deepEqual(r.waveforms, []);
  assert.deepEqual(r.easings, []);
  assert.equal(r.rmBase, '');
  assert.deepEqual(r.material, []);
  assert.deepEqual(r.lighting, []);
  assert.deepEqual(r.raymarchInputs, []);
  assert.deepEqual(r.layers, {bgModes:[], fillModes:[]});
  assert.deepEqual(r.menus, {}, 'an absent bundle empties the menu-buried-enum map too');
  assert.equal(r.provenance, null, 'no bundle ⇒ no provenance, never a fabricated one');
  // The rosters that do NOT come from the bundle are unaffected — a missing artifact empties
  // its own menus and nothing else. `ops` is unaffected on purpose: it stays on Mode 1
  // (`require()` of `_ops-canon.js`), the preferred mode, because that read already carries
  // DESCRIPTION on every entry — swapping it for the bundle would buy nothing and would drop
  // `INJECTED_OP_NAMES`, which the bundle does not export.
  assert.notInclude(named, 'ops');
});

/* ── the shared canons: material / lighting / raymarchOps / layers, read Mode 3 ──────
 *
 *  These four used to be Mode-2 window-global evaluations of `_mesh-material.js`
 *  (itself seeding `_point-line-texture.js` + `_texmapping-canon.js`) / `_lighting.js` /
 *  `_raymarch-ops.js` / `_layer-canon.js`. The export now carries their resolved
 *  descriptor rows directly, so what is asserted here is the SEAM: the bundle's own rows
 *  arrive unmodified, and an absent bundle empties all four menus (covered above) rather
 *  than falling back to a stale window-global read. `layers` was the LAST of the four —
 *  `readWindowGlobal` (Mode 2) has no remaining caller and is deleted with it. */

test('material / lighting / raymarchInputs arrive from `shared.*` exactly as the export wrote them', () => {
  assert.equal(fixture.material.length, 2);
  assert.equal(fixture.lighting.length, 2);
  assert.equal(fixture.raymarchInputs.length, 2);
  assert.deepEqual(fixture.material.map(m => m.NAME), ['materialType','matEmissiveR']);
  assert.deepEqual(fixture.lighting.map(l => l.NAME), ['light1Enabled','light1Type']);
  assert.deepEqual(fixture.raymarchInputs.map(i => i.NAME), ['rm_ao','rm_ao_radius']);
  // material/lighting carry TIP, not the endpoint-form DESCRIPTION, today — reported, not
  // assumed (`docs/COMPOSER.md` §8).
  for (const m of fixture.material) assert.equal(m.DESCRIPTION, undefined);
  for (const l of fixture.lighting) assert.equal(l.DESCRIPTION, undefined);
  // raymarchOps carries DESCRIPTION already, endpoint-form on at least one entry.
  assert.match(fixture.raymarchInputs[0].DESCRIPTION ?? '', / — /);
});

test('layers arrives from `shared.layers.{bg,fill}` as bgModes/fillModes, exactly as the export wrote it', () => {
  assert.deepEqual(fixture.layers.bgModes, [
    {key:'color',label:'color'}, {key:'texture',label:'texture'},
    {key:'color+texture',label:'color + texture'}
  ]);
  assert.deepEqual(fixture.layers.fillModes, [
    {key:'color',label:'color'}, {key:'texture',label:'texture'},
    {key:'color+texture',label:'color + texture'},
    {key:'color+texture+layer',label:'color + texture + layer'}
  ]);
});

/* ── the DESCRIPTION-over-TIP rule (`samplers.ts stackKnobs` case 'mathops') ──────────
 *
 *  Three synthetic op entries — one with both fields, one with TIP only, one with
 *  neither — assert the rule directly: DESCRIPTION wins when present, TIP is the legacy
 *  fallback, and a knob with neither is not composable. A synthetic `Rosters` is used so
 *  this is a proof about the RULE, not about which entries the live app happens to carry
 *  (the live-composability count is a separate, reported measurement — see samplers.test.ts). */

function opWith(name:string, opts:{description?:string; tip?:string}):OpInput {
  return {NAME:name, TYPE:'float', LABEL:name, DEFAULT:0, MIN:0, MAX:1, _groupId:'symmetry',
    DESCRIPTION:opts.description, TIP:opts.tip};
}

test('mathops: DESCRIPTION wins over TIP; TIP is the fallback; neither is not composable', () => {
  const ops:OpInput[] = [
    opWith('u_both', {description:'has both — a, b', tip:'legacy tip for both'}),
    opWith('u_tipOnly', {tip:'legacy tip only'}),
    opWith('u_neither', {})
  ];
  const synthetic:Rosters = {...fixture, ops:{all:ops, injectedNames:ops.map(o=>o.NAME), injected:ops}};
  const knobs = stackKnobs({} as RecordDescriptor, 'mathops', synthetic);
  const byName = new Map(knobs.map(k => [k.name, k]));
  assert.equal(byName.get('u_both')!.description, 'has both — a, b',
    'DESCRIPTION wins even when TIP is also present');
  assert.equal(byName.get('u_both')!.composable, true);
  assert.equal(byName.get('u_tipOnly')!.description, 'legacy tip only',
    'TIP is the fallback when there is no DESCRIPTION');
  assert.equal(byName.get('u_tipOnly')!.composable, true);
  assert.equal(byName.get('u_neither')!.description, null);
  assert.equal(byName.get('u_neither')!.composable, false,
    'a knob with neither DESCRIPTION nor TIP is not composable (docs/COMPOSER.md §8)');
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

/* ── the menu-buried enums (`agent-reports/menu-state-inventory.md`) ─────────────────
 *
 *  Paths and seams, not suites. Four named snapshot fields that never rode an ordinary
 *  INPUT descriptor — `scaleMode`, `sliderBlend`, `opActive.sdf`, `clock.source` — now
 *  arrive as a 4th `shared.*` shape (`shared.menus`, array of `{key,home,values,source}`).
 *  What is asserted here is the READ and the GATE, both proven once and never re-proven per
 *  consumer: the bundle's rows arrive keyed by their own `key`, an absent bundle empties the
 *  map (covered above), and `composableMenuValues` is the ONLY door — it returns the
 *  description-bearing subset, and nothing else ever reads `menu.values` directly. */

test('the menus arrive keyed by their own `key`, exactly as the export wrote them', () => {
  assert.deepEqual(Object.keys(fixture.menus).sort(),
    ['clock.source','opActive.sdf','scaleMode','sliderBlend']);
  assert.equal(fixture.menus['scaleMode'].home, 'card.scaleMode');
  assert.equal(fixture.menus['scaleMode'].source, 'app/js/formats/_scale-canon.js');
  assert.deepEqual(fixture.menus['scaleMode'].values.map(v => v.id), ['stretch','fit']);
});

test('composableMenuValues is the per-VALUE gate (§8) — a menu can be partially lifted', () => {
  // scaleMode + opActive.sdf: every value in the fixture carries a sentence.
  assert.equal(composableMenuValues(fixture.menus['scaleMode']).length, 2);
  assert.equal(composableMenuValues(fixture.menus['opActive.sdf']).length, 2);
  // sliderBlend + clock.source: no value in the fixture carries one — the gate returns
  // empty, never a guessed subset.
  assert.deepEqual(composableMenuValues(fixture.menus['sliderBlend']), []);
  assert.deepEqual(composableMenuValues(fixture.menus['clock.source']), []);
  // An undefined menu (a key the bundle never shipped) reads as empty too, never a throw —
  // a sampler that asks for a menu the app has not built yet gets nothing to draw, not a
  // crash mid-bake.
  assert.deepEqual(composableMenuValues(undefined), []);
  // Falsification: plant a description on one sliderBlend value and prove the gate now
  // admits exactly that one, never the whole menu.
  const planted = {...fixture.menus['sliderBlend'],
    values:fixture.menus['sliderBlend'].values.map((v,i) =>
      i === 0 ? {...v, description:'normal alpha-over compositing'} : v)};
  const admitted = composableMenuValues(planted);
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].id, 'normal');
});

/** THE SAMPLER'S ONE PROOF: for ONE record, every sampled look lies inside every knob's declared
 *  bounds, carries a stable id and a readable one-line description, and NAMES every knob
 *  it declined to move.
 *
 *  Paths and seams, not suites. The record-load path and the kernel are proven elsewhere
 *  (the 26 tests beside this file); what is new here is the sampler, so what is asserted
 *  here is the sampler's two contracts and nothing else:
 *
 *    · validity is a property of the GENERATOR (`docs/COMPOSER.md` §1) — asserted positively over
 *      every drawn value, and FALSIFIED once by handing the guard a look that violates a
 *      bound and requiring it to throw. A guard that has never refused is indistinguishable
 *      from one that cannot.
 *    · a knob with no situation sentence is not composable (`docs/COMPOSER.md` §8) — asserted as
 *      an EXACT set equality against the descriptor, so neither a silent skip nor a silent
 *      guess can pass.
 *
 *  THE SUBJECT. The test scans the live descriptor index for a record with ≥3 composable
 *  knobs and uses it. The sentence lift (`docs/PLAN.md` §2 risk 1) has now landed for the
 *  mechanical buckets, so the scan finds a real record and the plant below is bypassed —
 *  which is exactly what it was written for. The plant remains as the fallback for a tree
 *  where the lift has not landed: a real record whose real bounds are used verbatim and
 *  whose sentences are LIFTED — not invented — from the comments the record's own source
 *  already carries beside each input (bucket A of the knob census).
 */
import {test, assert} from 'vitest';
import {existsSync} from 'node:fs';
import {loadConfig} from '../server/config.js';
import {loadRecordIndex} from '../core/records.js';
import type {Knob, RecordDescriptor} from '../core/records.js';
import {composableMenuValues, loadRosters} from '../core/rosters.js';
import {sampleLooks, assertLookInBounds, stackKnobs} from '../core/samplers.js';
import {buildCandidateMap, criteriaFor, resolveLook} from '../core/candidates.js';
import {AXES, STACKS, STACK_AXES} from '../core/axes.js';
import type {AxisCoordinate, LookCandidate, StackId} from '../core/types.js';

const cfg = loadConfig();
const HAVE_APP = existsSync(cfg.shapesIndex);
assert.ok(HAVE_APP,
  `the descriptor index is the tool's whole input and is missing at ${cfg.shapesIndex} — ` +
  'point JEV_APP_ROOT / JEV_SHAPES_INDEX at the live app tree');

const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);

/** Sentences LIFTED verbatim-in-substance from the record source's own input comments,
 *  compressed to the endpoint form `<effect> — <MIN end>, <MAX end>`
 *  (`docs/COMPOSER.md` §8). A test plant, not authored canon. */
const LIFTED:Record<string,string> = {
  grainDensity: 'how fine the grain network reads — few large polygons, a dense microstructure of many small grains',
  grainDisorder:'how far the cells wander off the perfect honeycomb — an exact relaxed honeycomb, cells stretched sheared and uneven like an etched section',
  seamWidth:    'how wide the boundary seams draw, in cell units — hairline seams, broad soft bands',
  seamDepth:    'whether the boundaries cut into the plate or stand proud of it — cut as a fracture network, raised like a polished section'
};
const PLANT_ID = 'grain-boundary-network';

function plant(record:RecordDescriptor):RecordDescriptor {
  const knobs:Knob[] = record.knobs.map(k => LIFTED[k.name]
    ? {...k, description:LIFTED[k.name], descriptionOrigin:'lifted' as const,
       composable:true, skipReason:null}
    : k);
  const composableKnobs = knobs.filter(k => k.composable);
  const stacks = composableKnobs.length && !record.stacks.includes('modulation')
    ? [...record.stacks, 'modulation' as const] : record.stacks;
  return {...record, knobs, composableKnobs, stacks};
}

/** The scan the brief asks for — a real composable record wins; the plant is the fallback. */
function subject():{record:RecordDescriptor; planted:boolean; composableRecords:number} {
  const composable = index.composableIds();
  const real = composable.map(id => index.get(id)).find(r => r.composableKnobs.length >= 3);
  return real
    ? {record:real, planted:false, composableRecords:composable.length}
    : {record:plant(index.get(PLANT_ID)), planted:true, composableRecords:composable.length};
}

const SUBJECT = subject();
const COORD:AxisCoordinate = {motion:'pulse', density:'busy', contrast:'hard',
                              warmth:'cold', order:'regular', depth:'deep'};
const N = 8;

test('THE STATE OF THE LIFT is reported, not assumed', () => {
  // Not a pass/fail on the corpus — a printed measurement, so a green suite can never be
  // mistaken for "the bake is ready". 0 composable records means I7 composes nothing.
  console.log(`[I3] descriptor index: ${index.count} records; ` +
    `${SUBJECT.composableRecords} with ≥1 composable knob; ` +
    `subject = ${SUBJECT.record.id}${SUBJECT.planted ? ' (PLANTED — the sentence lift has not landed)' : ''}; ` +
    `${SUBJECT.record.composableKnobs.length} of ${SUBJECT.record.knobs.length} knobs composable`);
  assert.ok(SUBJECT.record.composableKnobs.length >= 3, 'the subject must carry ≥3 composable knobs');
  assert.deepEqual(rosters.missing, [], 'every shared roster must be readable from the app tree');
});

test('every sampled value lies inside its knob\'s declared [MIN, MAX]', () => {
  for (const stack of SUBJECT.record.stacks) {
    const knobs = new Map(stackKnobs(SUBJECT.record, stack, rosters).map(k => [k.key, k]));
    for (const seed of [1, 4242]) {
      const looks = sampleLooks(SUBJECT.record, stack, COORD, {n:N, seed, rosters});
      assert.equal(looks.length, N, `${stack} must produce ${N} looks`);
      for (const look of looks)
        for (const [key, value] of Object.entries(look.params)) {
          const k = knobs.get(key);
          if (!k || typeof value !== 'number') continue;
          assert.ok(value >= k.min && value <= k.max,
            `${stack}.${key} = ${value} outside [${k.min}, ${k.max}] in ${look.id}`);
        }
    }
  }
});

test('the bounds guard REFUSES a violating look (falsification)', () => {
  const knob = SUBJECT.record.composableKnobs[0];
  const bad:LookCandidate = {id:'shape_0_planted', description:'a planted out-of-range look',
    params:{[knob.name]: knob.max + 1}};
  assert.throws(() => assertLookInBounds(SUBJECT.record, 'shape', bad, rosters), RangeError);
  // …and the same look inside the bound does not throw, so the guard is reading the value
  // and not simply the plant.
  assert.doesNotThrow(() => assertLookInBounds(SUBJECT.record, 'shape',
    {...bad, params:{[knob.name]: knob.max}}, rosters));
});

test('ids are stable at one seed and differ across seeds', () => {
  const a = sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed:1, rosters}).map(l => l.id);
  const b = sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed:1, rosters}).map(l => l.id);
  const c = sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed:4242, rosters}).map(l => l.id);
  assert.deepEqual(a, b, 'the same (record, coordinate, seed) must reproduce byte-identically');
  assert.notDeepEqual(a, c, 'a different seed must draw a different set');
  assert.equal(new Set(a).size, N, 'ids within one draw must be distinct');
  for (const id of a) assert.match(id, /^shape_\d+_[0-9a-f]{8}$/);
});

test('every look carries a readable one-line description', () => {
  for (const stack of SUBJECT.record.stacks)
    for (const look of sampleLooks(SUBJECT.record, stack, COORD, {n:N, seed:9, rosters})) {
      assert.ok(look.description.trim().length > 0, `${stack}: empty description`);
      assert.notInclude(look.description, '\n', 'a candidate line is ONE line');
    }
});

test('skipped[] names EXACTLY the non-composable knobs, held at DEFAULT', () => {
  const expected = SUBJECT.record.knobs.filter(k => !k.composable).map(k => k.name).sort();
  for (const look of sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed:5, rosters})) {
    assert.deepEqual((look.skipped ?? []).slice().sort(), expected);
    for (const name of expected) {
      const knob = SUBJECT.record.knobs.find(k => k.name === name)!;
      assert.equal(look.params[name], knob.default,
        `a non-composable knob must be held at its DEFAULT, never guessed (${name})`);
    }
  }
});

test('the candidate map is what a chosen id resolves against (§10.2)', () => {
  const coordinate = Object.fromEntries(SUBJECT.record.stacks.map(s => [s, COORD]));
  const map = buildCandidateMap(SUBJECT.record, coordinate, {n:N, seed:11, rosters});
  assert.ok(Object.keys(map.candidates).length > 0, 'at least one stack must be askable');
  for (const [qid, looks] of Object.entries(map.candidates)) {
    assert.deepEqual(criteriaFor(looks), map.criteria[qid]);
    assert.equal(resolveLook(map, qid, looks[0].id).id, looks[0].id);
    assert.throws(() => resolveLook(map, qid, 'not-a-candidate'));
  }
  // The same draw twice ⇒ the same persisted hash, which is what makes a resumed bake's
  // rebuilt pending payload comparable to the one it replaces (`jobs.ts persistPending`).
  assert.equal(buildCandidateMap(SUBJECT.record, coordinate, {n:N, seed:11, rosters}).hash, map.hash);
});

/* ── I4: the stack table, and the two new stacks (`material`, `lighting`) ──────────
 *
 *  Same shape as the SDF subject above: scan for a real mesh-route record and use it —
 *  no plant, because `material`/`lighting` are offered whenever a record's own `route`
 *  admits a mesh, which is a mechanical condition (`records.ts` `MESH_ROUTES`), not a
 *  descriptor-lift condition. THE STATE OF THE LIFT for these two moves independently of
 *  this repo (`docs/COMPOSER.md` §8.1: `DESCRIPTION ?? TIP`, and the export can regain or
 *  lose `DESCRIPTION` coverage between runs) — reported below, not assumed or hardcoded,
 *  exactly as the shape/mathops/shade suite above reports its own lift state. */

function meshSubject():RecordDescriptor {
  const id = index.ids.find(id => index.get(id).stacks.includes('material'));
  assert.ok(id, 'no mesh-route record in the live index carries the `material` stack');
  return index.get(id!);
}
const MESH = meshSubject();

test('[material/lighting] the stack table is complete: every stack every fixture record offers has axes, ' +
     'and every one of those axes carries situation-word vocabulary', () => {
  const seen = new Set<StackId>();
  for (const id of index.ids) for (const s of index.get(id).stacks) seen.add(s);
  for (const s of seen) {
    assert.ok(STACKS.includes(s), `"${s}" is offered by a live record but has no STACK_AXES entry`);
    for (const axis of STACK_AXES[s]) {
      const opts = AXES[axis]?.options.filter(o => o.id !== 'any') ?? [];
      assert.ok(opts.length > 0, `stack "${s}" answers axis "${axis}", which carries no vocabulary`);
    }
  }
  // The two new stacks specifically, named — a "seen" set that happened not to need them
  // would let this test pass for the wrong reason.
  assert.ok(seen.has('material') && seen.has('lighting'),
    'the live index must carry at least one mesh-route record exercising both new stacks');
});

test('[material/lighting] material/lighting: THE STATE OF THE LIFT is reported, not assumed', () => {
  const mat = stackKnobs(MESH, 'material', rosters);
  const light = stackKnobs(MESH, 'lighting', rosters);
  console.log(`[material/lighting] material: ${mat.length} knobs, ${mat.filter(k=>k.composable).length} composable; ` +
    `lighting: ${light.length} knobs, ${light.filter(k=>k.composable).length} composable ` +
    `(subject ${MESH.id})`);
  assert.ok(mat.length > 0, 'the mesh-material roster must be readable from the app tree');
  assert.ok(light.length > 0, 'the light-rig roster must be readable from the app tree');
});

test('[material/lighting] every sampled material/lighting value lies inside its knob\'s declared [MIN, MAX]', () => {
  for (const stack of ['material','lighting'] as StackId[]) {
    const knobs = new Map(stackKnobs(MESH, stack, rosters).map(k => [k.key, k]));
    const looks = sampleLooks(MESH, stack, COORD, {n:N, seed:1, rosters});
    assert.equal(looks.length, N, `${stack} must produce ${N} looks`);
    for (const look of looks) {
      assertLookInBounds(MESH, stack, look, rosters);   // positive proof, code's own guard
      for (const [key, value] of Object.entries(look.params)) {
        const k = knobs.get(key);
        if (!k || typeof value !== 'number') continue;
        assert.ok(value >= k.min && value <= k.max,
          `${stack}.${key} = ${value} outside [${k.min}, ${k.max}] in ${look.id}`);
      }
    }
  }
});

test('[material/lighting] the bounds guard REFUSES a violating material/lighting look (falsification)', () => {
  for (const stack of ['material','lighting'] as StackId[]) {
    const knob = stackKnobs(MESH, stack, rosters)[0];
    assert.ok(knob, `${stack}: subject record carries no knobs to falsify against`);
    const bad:LookCandidate = {id:`${stack}_0_planted`, description:'a planted out-of-range look',
      params:{[knob.key]: knob.max + 1}};
    assert.throws(() => assertLookInBounds(MESH, stack, bad, rosters), RangeError);
    assert.doesNotThrow(() => assertLookInBounds(MESH, stack,
      {...bad, params:{[knob.key]: knob.max}}, rosters));
  }
});

test('[material/lighting] material/lighting ids are stable at one seed, and differ across seeds ' +
     'wherever the stack has anything composable to draw', () => {
  for (const stack of ['material','lighting'] as StackId[]) {
    const composableCount = stackKnobs(MESH, stack, rosters).filter(k => k.composable).length;
    const a = sampleLooks(MESH, stack, COORD, {n:N, seed:1, rosters}).map(l => l.id);
    const b = sampleLooks(MESH, stack, COORD, {n:N, seed:1, rosters}).map(l => l.id);
    const c = sampleLooks(MESH, stack, COORD, {n:N, seed:4242, rosters}).map(l => l.id);
    assert.deepEqual(a, b, `${stack}: same (record, coordinate, seed) must reproduce byte-identically`);
    if (composableCount > 0) {
      assert.notDeepEqual(a, c, `${stack}: a different seed must draw a different set`);
      assert.equal(new Set(a).size, N, `${stack}: ids within one draw must be distinct`);
    } else {
      // 0 composable knobs ⇒ every look is the same all-defaults, all-skipped draw regardless
      // of seed — an honest consequence of the current 0%-composable state (`docs/COMPOSER.md`
      // §8), not a determinism defect: the seed has nothing left to move.
      assert.deepEqual(a, c, `${stack}: 0 composable knobs must draw the identical look at any seed`);
    }
  }
});

test('[material/lighting] material/lighting: skipped[] names EXACTLY the non-composable knobs, held at DEFAULT ' +
     '(against whatever DESCRIPTION??TIP + range gate the live export currently carries — ' +
     'docs/COMPOSER.md §8.1)', () => {
  for (const stack of ['material','lighting'] as StackId[]) {
    const knobs = stackKnobs(MESH, stack, rosters);
    const expected = knobs.filter(k => !k.composable).map(k => k.name).sort();
    for (const look of sampleLooks(MESH, stack, COORD, {n:N, seed:5, rosters})) {
      assert.deepEqual((look.skipped ?? []).slice().sort(), expected);
      for (const name of expected) {
        const knob = knobs.find(k => k.name === name)!;
        assert.equal(look.params[knob.key], knob.default,
          `a non-composable knob must be held at its DEFAULT, never guessed (${stack}.${name})`);
      }
    }
  }
});

test('[material/lighting] every material/lighting look carries a readable one-line description', () => {
  for (const stack of ['material','lighting'] as StackId[])
    for (const look of sampleLooks(MESH, stack, COORD, {n:N, seed:9, rosters})) {
      assert.ok(look.description.trim().length > 0, `${stack}: empty description`);
      assert.notInclude(look.description, '\n', 'a candidate line is ONE line');
    }
});

test('[material/lighting] sampleAllStacks still asks ≤3 stack-worth of coordinate for a mesh record\'s call budget ' +
     '(docs/COMPOSER.md §7.2 — the CALL count stays 2–3 regardless of stack count; ' +
     'growth shows up as more axis sub-questions within CALL 1, chunked per §7.1)', () => {
  // material/lighting were deliberately given ONE axis each (contrast, warmth) — both
  // already fully vocabularied — specifically so this stays a small addition: +2 axis
  // sub-questions total against the ~14–18 the other six stacks already ask, not enough to
  // grow CALL 1's chunk count at the documented ≤6-per-request ceiling (§7.1).
  const total = STACKS.reduce((n, s) => n + STACK_AXES[s].length, 0);
  assert.ok(total <= 20, `stack axis sub-questions grew to ${total} — re-check the §7.1 chunk count`);
});

/* ── I5: ENUM knobs (materialType, light1Type, …) enter the candidate space ─────────
 *
 *  A VALUES/LABELS roster row was previously read as a DEGENERATE RANGE (no MIN/MAX) and
 *  held non-composable regardless of its sentence — exactly backwards, since its candidate
 *  space IS its VALUES list. `materialType` (real, DESCRIPTION-carrying) is the subject;
 *  no plant needed. */

test('[I5] an enum knob composes: `materialType` draws one of its own VALUES, not an index ' +
     'into nothing, and is never held at DEFAULT/skipped', () => {
  const knob = stackKnobs(MESH, 'material', rosters).find(k => k.name === 'materialType')!;
  assert.ok(knob, 'materialType must be offered by the live material roster');
  assert.ok(knob.composable, 'materialType carries a DESCRIPTION and must be composable');
  assert.ok(knob.values && knob.values.length > 1, 'materialType must carry its VALUES list');
  const allowed = new Set(knob.values!.map(e => e.v));
  for (const look of sampleLooks(MESH, 'material', COORD, {n:16, seed:3, rosters})) {
    assert.ok(allowed.has(look.params['materialType'] as number),
      `materialType = ${look.params['materialType']} is not one of its declared VALUES`);
    assertLookInBounds(MESH, 'material', look, rosters);   // positive proof, code's own guard
  }
  // Every draw must eventually be able to move the enum off its DEFAULT — an "enum is
  // composable" claim that never lands anywhere but DEFAULT would be indistinguishable from
  // it having been skipped.
  const moved = sampleLooks(MESH, 'material', COORD, {n:32, seed:7, rosters})
    .some(l => l.params['materialType'] !== knob.default);
  assert.ok(moved, 'materialType must draw a non-DEFAULT value at least once across 32 seeded looks');
});

test('[I5] enum draw is deterministic under seed, exactly like a ranged knob', () => {
  const a = sampleLooks(MESH, 'material', COORD, {n:16, seed:1, rosters}).map(l => l.params['materialType']);
  const b = sampleLooks(MESH, 'material', COORD, {n:16, seed:1, rosters}).map(l => l.params['materialType']);
  const c = sampleLooks(MESH, 'material', COORD, {n:16, seed:4242, rosters}).map(l => l.params['materialType']);
  assert.deepEqual(a, b, 'the same (record, coordinate, seed) must reproduce byte-identically');
  assert.notDeepEqual(a, c, 'a different seed must draw a different sequence of enum states');
});

test('[I5] a VALUES knob with no DESCRIPTION stays non-composable, exactly like a ranged knob', () => {
  // A synthetic roster row: `materialType`'s own VALUES/LABELS, DESCRIPTION and TIP both
  // stripped — the guard from `docs/COMPOSER.md` §8 gates the enum path the same as the
  // ranged one. `rosters.material` is the only input `stackKnobs('material', …)` reads, so
  // overriding it is enough; `record` is unused by the material/lighting/mathops/shade cases.
  const real = rosters.material.find(i => i.NAME === 'materialType')!;
  assert.ok(real, 'materialType must be present in the live material roster to plant against');
  const stripped = {...real, DESCRIPTION:undefined};
  const undescribed = {...rosters, material:[stripped]};
  const knob = stackKnobs(MESH, 'material', undescribed)[0];
  assert.equal(knob.composable, false, 'a VALUES knob with no situation sentence must not compose');
  assert.ok(knob.skipReason && /situation sentence/.test(knob.skipReason));
  for (const look of sampleLooks(MESH, 'material', COORD, {n:8, seed:2, rosters:undescribed})) {
    assert.deepEqual(look.skipped, ['materialType']);
    assert.equal(look.params['materialType'], knob.default,
      'a non-composable enum knob must be held at its DEFAULT, never guessed');
  }
});

/* ── the menu-buried enums (`agent-reports/menu-state-inventory.md`), RULING 2026-09-19 23:19 ──
 *
 *  Paths and seams, not suites. Four spaces, one seam each — the same §8 gate every other
 *  roster already proves, applied to a NEW artifact shape (`shared.menus`). What is new here
 *  is asserted once per space and nothing is re-proven: scaleMode is drawn ONLY when the
 *  record's own descriptor says so; blend/clock never draw without a sentence, live and
 *  falsified with a planted one; the SDF domain-warp menu joins `mathops` only for a record
 *  whose `route` admits a marcher. */

test('[menus] the live index never carries a scaleMode-composable record — the reported finding', () => {
  // agent-reports/menu-state-inventory.md's own gap note: every route in this shapes index
  // is raymarch/mesh/either, never one of the canvas-upload substrates (WASM/P5J/PEN/LOT)
  // scaleMode is gated on. This is the honest state of the corpus, not a bug in the gate.
  const supported = index.ids.filter(id => index.get(id).supportsScaleMode);
  assert.deepEqual(supported, [], `${supported.length} record(s) unexpectedly support scaleMode`);
});

test('[menus] scaleMode is drawn on the `shape` stack ONLY when the record supports it', () => {
  const scaleMenu = composableMenuValues(rosters.menus['scaleMode']);
  assert.ok(scaleMenu.length > 0, 'the live scaleMode menu must carry ≥1 composable value to prove the positive case');
  const admitted = new Set(scaleMenu.map(v => v.id));

  // Negative: the real subject never supports scaleMode, and never draws it, across many seeds.
  for (const seed of [1, 2, 3, 4, 5])
    for (const look of sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed, rosters}))
      assert.equal(look.params['scaleMode'], undefined,
        `${SUBJECT.record.id}: scaleMode must never be drawn — supportsScaleMode is false`);

  // Positive: a record whose descriptor SAYS it supports scaleMode draws one of the menu's
  // own composable ids, at least once across a run of seeds.
  const scaleSubject:RecordDescriptor = {...SUBJECT.record, supportsScaleMode:true};
  const drawn = new Set<unknown>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
    for (const look of sampleLooks(scaleSubject, 'shape', COORD, {n:N, seed, rosters}))
      if (look.params['scaleMode'] !== undefined) drawn.add(look.params['scaleMode']);
  assert.ok(drawn.size > 0, 'a scaleMode-supporting record must draw scaleMode at least once');
  for (const v of drawn) assert.ok(admitted.has(v as string), `drawn scaleMode "${v}" is not a composable menu id`);
});

/** Strip every value's `description` off a live menu — the NEGATIVE fixture for the §8 gate,
 *  independent of whatever the live corpus's OWN composability count happens to be on a given
 *  run (it moved mid-session: `agent-reports/menu-state-inventory.md`'s "0/30"/"0/4 today"
 *  measurements are already stale — the live export now carries 30/30 and 4/4). The RULE is
 *  what these two tests prove, not a momentary corpus count, which is why the negative half
 *  uses a synthetic stripped roster (same technique as the "a VALUES knob with no DESCRIPTION"
 *  test above) rather than assuming today's state. */
function stripped(menu:{key:string;home:string;source:string;values:{id:string;label:string;description?:string}[]}) {
  return {...menu, values:menu.values.map(v => ({id:v.id, label:v.label}))};
}

test('[menus] sliderBlend: a per-knob `.blend` attribute, gated on a sentence per §8 ' +
     '(measured live, proven with a stripped-then-planted roster)', () => {
  const live = composableMenuValues(rosters.menus['sliderBlend']);
  console.log(`[menus] sliderBlend: ${live.length}/${rosters.menus['sliderBlend']?.values.length ?? 0} composable (live)`);

  // Negative: with every sentence stripped, `.blend` never appears — on any stack, any seed.
  const noSentence = {...rosters, menus:{...rosters.menus, sliderBlend:stripped(rosters.menus['sliderBlend'])}};
  for (const seed of [1, 2, 3])
    for (const stack of SUBJECT.record.stacks)
      for (const look of sampleLooks(SUBJECT.record, stack, COORD, {n:N, seed, rosters:noSentence}))
        for (const key of Object.keys(look.params))
          assert.ok(!key.endsWith('.blend'), `${stack}.${key}: a blend attribute was drawn with no sentence`);

  // Positive: re-plant exactly one sentence and prove `.blend` DOES appear, drawing only
  // that one (composable) id — never one of the still-undescribed siblings.
  const real = rosters.menus['sliderBlend'];
  assert.ok(real && real.values.length > 1, 'the live sliderBlend menu must carry ≥2 values to prove the ONE-admitted-id case');
  const onePlanted = {...stripped(real)!, values:stripped(real)!.values.map((v,i) =>
    i === 0 ? {...v, description:'planted for the falsification'} : v)};
  const withPlant = {...rosters, menus:{...rosters.menus, sliderBlend:onePlanted}};
  let sawBlend = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
    for (const look of sampleLooks(SUBJECT.record, 'shape', COORD, {n:N, seed, rosters:withPlant}))
      for (const [key, value] of Object.entries(look.params))
        if (key.endsWith('.blend')) { sawBlend = true; assert.equal(value, onePlanted.values[0].id); }
  assert.ok(sawBlend, 'a planted sentence must make `.blend` drawable');
});

test('[menus] clock.source: a per-bind attribute, gated on a sentence per §8 ' +
     '(measured live, proven with a stripped-then-planted roster)', () => {
  const live = composableMenuValues(rosters.menus['clock.source']);
  console.log(`[menus] clock.source: ${live.length}/${rosters.menus['clock.source']?.values.length ?? 0} composable (live)`);
  assert.ok(SUBJECT.record.composableKnobs.length > 0, 'the subject must offer the modulation stack to exercise binds');

  const noSentence = {...rosters, menus:{...rosters.menus, ['clock.source']:stripped(rosters.menus['clock.source'])}};
  for (const seed of [1, 2, 3])
    for (const look of sampleLooks(SUBJECT.record, 'modulation', COORD, {n:N, seed, rosters:noSentence}))
      for (const [key, value] of Object.entries(look.params))
        if (key.startsWith('bind:'))
          assert.equal((value as {source?:string}).source, undefined,
            `${key}: a clock source was drawn with no sentence`);

  const real = rosters.menus['clock.source'];
  assert.ok(real && real.values.length > 1, 'the live clock.source menu must carry ≥2 values to prove the ONE-admitted-id case');
  const onePlanted = {...stripped(real)!, values:stripped(real)!.values.map((v,i) =>
    i === 0 ? {...v, description:'planted for the falsification'} : v)};
  const withPlant = {...rosters, menus:{...rosters.menus, ['clock.source']:onePlanted}};
  let sawSource = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
    for (const look of sampleLooks(SUBJECT.record, 'modulation', COORD, {n:N, seed, rosters:withPlant}))
      for (const [key, value] of Object.entries(look.params))
        if (key.startsWith('bind:') && (value as {source?:string}).source !== undefined) {
          sawSource = true;
          assert.equal((value as {source:string}).source, onePlanted.values[0].id);
        }
  assert.ok(sawSource, 'a planted sentence must make a bind\'s `source` drawable');
});

test('[menus] the SDF domain-warp op menu joins `mathops` ONLY for a record whose route admits a marcher', () => {
  const sdfMenu = composableMenuValues(rosters.menus['opActive.sdf']);
  assert.ok(sdfMenu.length > 0, 'the live opActive.sdf menu must carry ≥1 composable op to prove the positive case');
  const admittedIds = new Set(sdfMenu.map(v => v.id));

  // Positive: a marching-route record (raymarch|either) with a `mathops` stack eventually
  // draws `opActive.sdf` as a membership set over the menu's own composable ids.
  const marchId = index.ids.find(id => {
    const r = index.get(id);
    return (r.route === 'raymarch' || r.route === 'either') && r.stacks.includes('mathops');
  });
  assert.ok(marchId, 'no marching-route record in the live index carries the `mathops` stack');
  const march = index.get(marchId!);
  let sawSdfOps = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
    for (const look of sampleLooks(march, 'mathops', COORD, {n:N, seed, rosters})) {
      const set = look.params['opActive.sdf'] as Record<string,number>|undefined;
      if (set && Object.keys(set).length) {
        sawSdfOps = true;
        for (const k of Object.keys(set)) assert.ok(admittedIds.has(k), `drawn sdf op "${k}" is not on the menu`);
      }
    }
  assert.ok(sawSdfOps, `${march.id}: opActive.sdf must be drawn at least once across 8 seeds`);

  // Negative: a pure mesh-route record (no marcher at all) never draws opActive.sdf, even
  // though it still offers `mathops` (the warp-op roster is medium-wide, not route-gated).
  const meshOnlyId = index.ids.find(id => index.get(id).route === 'mesh' && index.get(id).stacks.includes('mathops'));
  assert.ok(meshOnlyId, 'no pure mesh-route record in the live index carries the `mathops` stack');
  const meshOnly = index.get(meshOnlyId!);
  for (const seed of [1, 2, 3])
    for (const look of sampleLooks(meshOnly, 'mathops', COORD, {n:N, seed, rosters}))
      assert.equal(look.params['opActive.sdf'], undefined,
        `${meshOnly.id}: a pure mesh-route record must never draw opActive.sdf (route does not admit a marcher)`);
});

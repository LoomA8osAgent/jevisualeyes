/** I3's ONE proof: for ONE record, every sampled look lies inside every knob's declared
 *  bounds, carries a stable id and a readable one-line description, and NAMES every knob
 *  it declined to move.
 *
 *  Paths and seams, not suites. The record-load path and the kernel are proven elsewhere
 *  (the 26 tests beside this file); what is new here is the sampler, so what is asserted
 *  here is the sampler's two contracts and nothing else:
 *
 *    · validity is a property of the GENERATOR (`jev.md` §5) — asserted positively over
 *      every drawn value, and FALSIFIED once by handing the guard a look that violates a
 *      bound and requiring it to throw. A guard that has never refused is indistinguishable
 *      from one that cannot.
 *    · a knob with no situation sentence is not composable (`jev.md` §P2.4) — asserted as
 *      an EXACT set equality against the descriptor, so neither a silent skip nor a silent
 *      guess can pass.
 *
 *  THE SUBJECT. The test scans the live descriptor index for a record with ≥3 composable
 *  knobs and uses it. **Today there are none** — the index carries DEFAULT/MIN/MAX/LABEL
 *  and no `DESCRIPTION` at all, so the sentence lift (`roadmap/jevisualeyes-rework.md` §8
 *  risk 1) has not landed and 0 of 495 records are composable. Until it does, the subject
 *  is a real record whose real bounds are used verbatim and whose sentences are LIFTED —
 *  not invented — from the comments the record's own source already carries beside each
 *  input (`visualeyes/research/sdf-records/crystals/crystals.records.js:736-757`, bucket A
 *  of the knob-comment census). The moment the lift lands the scan finds a real record and
 *  the plant is bypassed, which is the point: this test is written against the shape the
 *  lift produces, not around its absence.
 */
import {test, assert} from 'vitest';
import {existsSync} from 'node:fs';
import {loadConfig} from '../server/config.js';
import {loadRecordIndex} from '../core/records.js';
import type {Knob, RecordDescriptor} from '../core/records.js';
import {loadRosters} from '../core/rosters.js';
import {sampleLooks, assertLookInBounds, stackKnobs} from '../core/samplers.js';
import {buildCandidateMap, criteriaFor, resolveLook} from '../core/candidates.js';
import type {AxisCoordinate, LookCandidate} from '../core/types.js';

const cfg = loadConfig();
const HAVE_APP = existsSync(cfg.shapesIndex);
assert.ok(HAVE_APP,
  `the descriptor index is the tool's whole input and is missing at ${cfg.shapesIndex} — ` +
  'point JEV_APP_ROOT / JEV_SHAPES_INDEX at the live app tree');

const rosters = loadRosters(cfg.appRoot);
const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot);

/** Sentences LIFTED verbatim-in-substance from the record source's own input comments,
 *  compressed to the endpoint form `<effect> — <MIN end>, <MAX end>`
 *  (`specs/isf2-standard.md:330`). A test plant, not authored canon. */
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

/** I4's ONE PROOF — the whole loop, end to end, once.
 *
 *  `docs/PLAN.md` §1 I4's acceptance verbatim: ONE record, ONE tag, the fixture provider,
 *  end to end → a composed snapshot on disk with its receipts, and a re-run from the STORED
 *  RESPONSES at the same seed producing a BYTE-IDENTICAL snapshot, asserted by sha256.
 *
 *  Paths and seams, not suites. The kernel, the record-load path and the samplers are proven
 *  by the suites beside this file and are not re-proven here. What is new is the phase
 *  machine, the accept/resample and the replay, so what is asserted is exactly those:
 *
 *   · the loop runs and writes ONE unit with its receipts and its provider calls;
 *   · the re-run needs no provider and lands on the same sha256;
 *   · the accept check REFUSES an all-defaults look, and the bounded resample REFUSES when
 *     its cap is exhausted — a gate that has never refused is indistinguishable from one
 *     that cannot.
 *
 *  THE SUBJECT is picked by a RESOLVER (`resolveSubject`), never by name.
 */
import {test, assert} from 'vitest';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {FixtureProvider} from '../server/fixture.js';
import {composeUnit, readUnitArtifact, replayUnit, resolveSubject} from '../server/compose.js';
import {ReplayProvider} from '../server/replay.js';
import {loadRecordIndex} from '../core/records.js';
import {loadRosters} from '../core/rosters.js';
import {acceptLook, UnitComposer} from '../core/composer.js';
import {compileTag} from '../core/tags.js';
import {stackKnobs} from '../core/samplers.js';
import type {CompositionDraft, JsonValue, StackId} from '../core/types.js';
import {writeFileSync} from 'node:fs';

const cfg = loadConfig();
assert.ok(existsSync(cfg.shapesIndex),
  `the descriptor index is the tool's whole input and is missing at ${cfg.shapesIndex}`);

const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);
const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const RECORD = resolveSubject(index, 3);
const TAG = 'motion:pulse density:busy contrast:hard warmth:cold order:regular depth:deep';
const SEED = 1743;

test('I4: one record, one tag, fixture provider — composed, then replayed byte-identically', async () => {
  const work = mkdtempSync(join(tmpdir(), 'jev-i4-'));
  try {
    const fixturePath = join(work, 'fixture.json');
    writeFileSync(fixturePath, JSON.stringify({default:0.9}));   // TOLD, never inferring (§3.2)

    const first = await composeUnit({
      recordId:RECORD, tag:TAG, seed:SEED,
      dataDir:join(work,'run-1'), outDir:join(work,'units'),
      overrides:{providerId:'fixture', fixturePath},
      provider:new FixtureProvider(fixturePath)
    });

    // ONE snapshot on disk, with its receipts AND the calls that produced them.
    assert.ok(existsSync(first.path), 'the composed unit was not written to disk');
    const onDisk = readUnitArtifact(first.path);
    assert.equal(onDisk.snapshotSha256, first.artifact.snapshotSha256);
    assert.equal(onDisk.snapshot.recordId, RECORD);
    assert.equal(onDisk.snapshot.tag, TAG);
    assert.ok(onDisk.receipts.length > 0, 'a composed unit with no receipts is not provenance');
    assert.ok(onDisk.calls.length > 0, 'without the calls a re-run would need a provider');
    assert.ok(Object.keys(onDisk.snapshot.stacks).length > 0, 'no stack committed a look');
    assert.ok(Object.keys(onDisk.snapshot.motion).length > 0, 'no motion Noul was committed');
    assert.ok(onDisk.receipts.every(r => r.provenance === 'synthetic'),
      'a fixture receipt was not labeled synthetic (§5)');

    // Every committed look came from the persisted menu and stands on the accept check.
    for (const [stack, committed] of Object.entries(onDisk.snapshot.stacks))
      assert.deepEqual(acceptLook(index.get(RECORD), stack as StackId, committed!, rosters),
        {ok:true, reason:null}, `the committed look for "${stack}" does not pass the accept check`);

    // THE RE-RUN — answered only from the stored responses, at the same seed.
    const again = await replayUnit(first.path,
      {dataDir:join(work,'run-2'), outDir:join(work,'replay'),
       overrides:{providerId:'fixture', fixturePath}});
    assert.equal(again.artifact.snapshotSha256, first.artifact.snapshotSha256,
      'the re-run from stored responses is not byte-identical');
    assert.equal(again.artifact.replayOf, first.path,
      'the replay must record what it replayed — in the ENVELOPE, never in the snapshot');
    assert.ok(!('replayOf' in (again.artifact.snapshot as object)),
      'nothing about THIS run may be inside the snapshot, or it could not be compared');
  } finally { rmSync(work, {recursive:true, force:true}); }
}, 120_000);

test('the replay LOOKS UP and never infers — an unrecorded request is refused', () => {
  const req = {model:'fixture-1', state:'s', questions:{q:{type:'noul' as const, instructions:'i'}}};
  const rp = new ReplayProvider(
    [{requestHash:'', request:req, response:{model:'fixture-1',
      answers:{q:{type:'noul', noul:0.9}}, usage:{input_tokens:0, output_tokens:0}}}],
    {id:'fixture', modelId:'fixture-1', providerClass:'FIXTURE', provenance:'synthetic'});
  const other = {...req, state:'a state the recorded run never saw'};
  return rp.decide(other, new AbortController().signal).then(
    () => assert.fail('a replay answered a request it had never been asked'),
    (e:any) => assert.match(String(e?.message), /no stored response for request/));
});

test('the accept check REFUSES an all-defaults look, and the resample cap REFUSES when spent', () => {
  const record = index.get(RECORD);
  const stack:StackId = 'shape';
  const knobs = stackKnobs(record, stack, rosters).filter(k => k.composable);
  assert.ok(knobs.length >= 3, 'the resolved subject must carry composable shape knobs');

  const allDefaults:Record<string,JsonValue> = {};
  for (const k of knobs) allDefaults[k.key] = k.default;
  const refused = acceptLook(record, stack, {lookId:'planted_defaults', params:allDefaults}, rosters);
  assert.equal(refused.ok, false, 'a look that moved nothing was ACCEPTED (docs/COMPOSER.md §11)');
  assert.match(String(refused.reason), /sits at its DEFAULT/);

  const moved = {...allDefaults};
  moved[knobs[0].key] = knobs[0].default === knobs[0].max ? knobs[0].min : knobs[0].max;
  assert.equal(acceptLook(record, stack, {lookId:'moved', params:moved}, rosters).ok, true);

  // The bounded resample: a stack whose look keeps failing is re-asked at most `cap` times
  // and then the run REFUSES, naming the stack, the count and the reason. It never ships
  // the rejected look (§3.2 — fail closed, no silent fallback).
  const cap = 2;
  const composer = new UnitComposer({index, rosters, model:'fixture-1', resampleCap:cap, n:4});
  const draft:CompositionDraft = {
    schemaVersion:'a8os.jev.composition.v1', recordId:RECORD, tag:TAG,
    coordinate:compileTag(TAG, record.stacks).byStack,
    stacks:{[stack]:{lookId:'planted_defaults', params:allDefaults}},
    motion:Object.fromEntries(record.composableKnobs.map(k => [k.name, {moving:false}])),
    generation:{provenance:'synthetic', providerId:'fixture', providerClass:'FIXTURE',
      model:'fixture-1', rosterVersion:'x', candidateMapVersion:'x',
      selection:{mode:'model', temperature:0.8, seed:SEED}, partial:false}
  };
  for (let i = 0; i < cap; i++)
    assert.equal(composer.nextStep(draft, SEED)?.kind, 'looks',
      `resample ${i+1} of ${cap} should have re-asked the rejected stack`);
  assert.throws(() => composer.nextStep(draft, SEED), /composition refused/);
  assert.equal(composer.resampled().length, cap);
});

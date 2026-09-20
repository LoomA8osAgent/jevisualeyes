/** THE EYE'S SEAM: the typed receipt loader and the coordinate-vs-measurement report.
 *
 *  Paths and seams, not suites (`feedback_paths_and_seams_not_suites`). This is new content —
 *  a new file consuming a receipt shape a sibling repo writes — so it gets the one seam proof
 *  this repo's own convention asks for: the loader accepts the real shape and refuses a
 *  pre-layer-1 one, and the report produces the finding kinds `docs/COMPOSER.md` §5.1 names on
 *  a planted mismatch. No falsify run, no bake, no whole-suite re-proof: this file touches no
 *  proven path (the spine, the samplers, the roster) and adds a report function nothing else
 *  calls yet.
 *
 *  The fixture (`fixtures/look-verdict.json`) is `design/watch-receipts/f17be16fa04d.json`'s
 *  OWN metrics for the `video.look-verdict-smoke` flow, wrapped in the `a8os.look-verdict.v1`
 *  shape `tools/judgment/look-verdict.js` writes, with the answers
 *  `agent-reports/video-pipeline-v1.md` §5 measured for that exact receipt (has_motion 0.7094,
 *  motion_feeling "steady" p 0.3355/conc 0.0710, something_wrong 0.2444) — both cited by path,
 *  not re-derived.
 */
import {test, assert} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertMotionKeys, judgeAgainstCoordinate, readLookReceipt, LookReceiptError}
  from '../core/look-verdict.js';
import {MOTION_FEELING} from '../core/axes.js';
import type {LookVerdictRecord} from '../core/look-verdict.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/look-verdict.json', import.meta.url));
const raw = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

/* ── the loader ──────────────────────────────────────────────────────────────────── */

test('readLookReceipt: accepts the real shape and returns it typed', () => {
  const r = readLookReceipt(raw(), FIXTURE);
  assert.equal(r.schema, 'a8os.look-verdict.v1');
  assert.equal(r.metrics.schema, 'a8os.frame-metrics.v1');
  assert.equal(r.answers.has_motion.value, 0.7094);
  assert.equal(r.answers.motion_feeling.word, 'steady');
  assert.equal(r.advisory, true);
});

test('readLookReceipt: FAIL CLOSED on a receipt with no metricsSchema (predates layer 1)', () => {
  const bad = raw(); delete bad.metricsSchema; delete bad.metrics.schema;
  assert.throws(() => readLookReceipt(bad, 'no-metrics.json'), LookReceiptError);
  assert.throws(() => readLookReceipt(bad, 'no-metrics.json'), /predates layer 1/);
});

test('readLookReceipt: refuses a wrong schema tag, not just a missing one', () => {
  const bad = raw(); bad.schema = 'a8os.watch-receipt.v1';
  assert.throws(() => readLookReceipt(bad, 'wrong-schema.json'), /not a look-verdict record/);
});

test('readLookReceipt: refuses a non-advisory claim', () => {
  const bad = raw(); bad.advisory = false;
  assert.throws(() => readLookReceipt(bad, 'not-advisory.json'), /advisory !== true/);
});

/* ── assertMotionKeys — both sides of the transcription ─────────────────────────────
 *
 *  `_look-roster.js`'s `MOTION_FEELING_KEYS` is a hand-copied transcription of this repo's own
 *  `MOTION_FEELING` (axes.ts). This is the check run from THIS side: it must accept the exact
 *  keys the OTHER file currently declares (copied here, cited, not re-derived) and it must
 *  throw, named, on any drift. */
test('assertMotionKeys: accepts the transcription _look-roster.js currently carries', () => {
  // ~/gits/visualeyes/app/tools/_look-roster.js:79 MOTION_FEELING_KEYS, 2026-09-20.
  const transcribed = ['held', 'drifting', 'easing', 'springy', 'bouncy', 'snappy', 'steady'];
  assert.deepEqual(transcribed.slice().sort(), Object.keys(MOTION_FEELING).slice().sort(),
    'sanity: the cited transcription equals this repo\'s own live keys today');
  assert.equal(assertMotionKeys(transcribed), true);
});

test('assertMotionKeys: throws NAMED on drift, in either direction', () => {
  assert.throws(() => assertMotionKeys(['held', 'drifting']), /motion vocabulary has drifted/);
  assert.throws(() => assertMotionKeys([...Object.keys(MOTION_FEELING), 'floaty']),
    /motion vocabulary has drifted/);
});

/* ── judgeAgainstCoordinate — the report, never an action ───────────────────────────── */

test('judge: motion-feeling finding is ALWAYS present and ALWAYS barred when answered', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {mathops: {motion: 'driving', order: 'regular', depth: 'flat'}},
    {stack: 'mathops'});
  const mf = report.findings.find(f => f.kind === 'motion-feeling-barred');
  assert.ok(mf, 'a motion_feeling answer always produces a finding');
  assert.equal(mf!.barred, true);
  assert.equal(mf!.p, 0.3355);
  assert.match(mf!.reason, /SENSITIVE and NOT CALIBRATED|not calibrated/i);
});

test('judge: coordinate says driving, receipt reads has_motion — no mismatch (both moving)', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {mathops: {motion: 'driving'}}, {stack: 'mathops'});
  assert.equal(report.findings.find(f => f.kind === 'motion-axis-mismatch'), undefined);
});

test('judge: PLANTED MISMATCH — coordinate says "still", receipt measures moving', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {mathops: {motion: 'still'}}, {stack: 'mathops', recordId: 'x', tag: 'y'});
  const m = report.findings.find(f => f.kind === 'motion-axis-mismatch');
  assert.ok(m, 'a "still" coordinate against a measurably-moving flow must produce a finding');
  assert.equal(m!.barred, false);
  assert.equal(m!.p, 0.7094);
  assert.equal(report.recordId, 'x'); assert.equal(report.tag, 'y');
});

test('judge: motion coordinate "any" never produces a motion-axis-mismatch finding', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {mathops: {motion: 'any'}}, {stack: 'mathops'});
  assert.equal(report.findings.find(f => f.kind === 'motion-axis-mismatch'), undefined);
});

test('judge: something_wrong is reported verbatim, unflagged here', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {});
  const sw = report.findings.find(f => f.kind === 'something-wrong-reported');
  assert.ok(sw); assert.equal(sw!.p, 0.2444);
  assert.match(sw!.reason, /did not flag/);
});

test('judge: bind-bracket check fires when measured motion.max exceeds the declared bracket', () => {
  const r = readLookReceipt(raw()); // metrics.motion.max = 7.4371
  const report = judgeAgainstCoordinate(r, {}, {modulationHint: {waveformMax: 5}});
  const b = report.findings.find(f => f.kind === 'bind-bracket-suspect');
  assert.ok(b, 'motion.max 7.4371 > declared bracket max 5 must be flagged');
});

test('judge: bind-bracket check is silent when the measurement sits inside the bracket', () => {
  const r = readLookReceipt(raw());
  const report = judgeAgainstCoordinate(r, {}, {modulationHint: {waveformMax: 100}});
  assert.equal(report.findings.find(f => f.kind === 'bind-bracket-suspect'), undefined);
});

test('judge: the A/B leg reads look_changed off either receipt and reports it', () => {
  const a = readLookReceipt(raw());
  const b:LookVerdictRecord = {
    ...readLookReceipt(raw()),
    provenance: {...a.provenance, receipt: 'other.json'},
    answers: {...a.answers, look_changed: {value: 0.821, flagged: false, answered: true, findingAt: 'low', word: 'ok'}},
  };
  const report = judgeAgainstCoordinate(a, {}, {vs: b});
  const lc = report.findings.find(f => f.kind === 'look-changed');
  assert.ok(lc); assert.equal(lc!.p, 0.821);
  assert.match(lc!.reason, /YES/);
  assert.deepEqual(report.compared, {a: a.provenance.receipt, b: 'other.json'});
});

test('judge: never mutates its inputs (a report is not an edit)', () => {
  const r = readLookReceipt(raw());
  const before = JSON.stringify(r);
  judgeAgainstCoordinate(r, {mathops: {motion: 'still'}}, {stack: 'mathops', modulationHint: {waveformMax: 1}});
  assert.equal(JSON.stringify(r), before);
});

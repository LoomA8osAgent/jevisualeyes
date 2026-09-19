/** THE I1+I2 SMOKE — one Noul, one Choice and one Score through the whole seam:
 *  fixture provider -> provider contract -> §10.1 validation -> selection -> ONE durable
 *  transaction -> a receipt persisted in SQLite, then read back.
 *
 *  ZERO network, zero model. It is the ONE comparison this increment owes: the kernel
 *  still behaves with the upstream domain removed, and the strict validator REFUSES a
 *  planted-bad answer with its reasons printed — because a validator that has never
 *  refused is indistinguishable from one that cannot (plan §5, I2 acceptance).
 *
 *  The composer here is TEST MATERIAL, not a shipped stub: the real one (samplers +
 *  phase machine) is I3/I4. It exists so the spine can be driven before it exists.
 *
 *    node --run smoke:fixture      (or: npx tsx scripts/smoke-fixture.mjs)
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runUnit} from '../server/index.js';
import {FixtureProvider} from '../server/fixture.js';
import {validateResponse} from '../core/validate.js';
import {buildAxisRequest, buildLookRequest, buildMotionRequest} from '../core/requests.js';

const dir = mkdtempSync(join(tmpdir(), 'jevisualeyes-smoke-'));
const fixturePath = join(dir, 'fixture.json');
const record = {recordId:'waves/ocean', situation:'an open sea surface', family:'waves',
  tag:'motion:driving density:busy contrast:hard'};

// THE PLANTED MAP (§9): the fixture is TOLD what to answer.
writeFileSync(fixturePath, JSON.stringify({
  default: 0.9,
  answers: {
    axis_shape_density:'busy', axis_shape_contrast:'hard', axis_shape_order:'regular',
    look_shape:'look_2',
    moving_twist: 0.96, moving_gain: 0.05,
    waveform_twist:'sine', rate_twist: 3
  }
}, null, 2));
// Configuration is passed EXPLICITLY, never through process.env: `config.ts` snapshots
// the environment at module load, so a mutation after the static import would arrive too
// late — and silently, by running against whatever provider the environment named. That
// is how this script first ran against a live local server instead of the fixture.
const overrides = {providerId:'fixture', fixturePath, dataDir:dir};

const LOOKS = [
  {id:'look_1', description:'sparse loose field, soft edges, one fold, warm palette', params:{sharp:1.2, folds:1}},
  {id:'look_2', description:'dense regular field, hard edges, two folds, cool palette', params:{sharp:4.4, folds:2}},
  {id:'look_3', description:'dense chaotic field, hard edges, four folds, cool palette', params:{sharp:5.8, folds:4}}
];
const PARAMS = [{name:'twist', situation:'the fold angle'}, {name:'gain', situation:'the amplitude'}];
const WAVEFORMS = [{id:'sine', label:'Sine — a smooth swell'}, {id:'ramp', label:'Ramp — a saw sweep'}];

/** Three steps, one per decision kind — the smallest path that exercises all three
 *  primitives and all three commit arms. */
const composer = {
  id:'smoke', version:'smoke.v1', candidateMapVersion:'smoke-candidates.v1',
  movingBand: 0.5,
  nextStep(draft) {
    if (!draft.coordinate.shape)
      return {kind:'axes', request: buildAxisRequest('fixture-1', record, ['shape']), candidates:{}};
    if (!draft.stacks.shape)
      return {kind:'looks',
        request: buildLookRequest('fixture-1', record, draft.coordinate, {shape: LOOKS}),
        candidates: {look_shape: LOOKS}};
    if (!Object.keys(draft.motion).length)
      return {kind:'motion',
        request: buildMotionRequest('fixture-1', record, draft.coordinate, PARAMS),
        candidates:{}};
    if (draft.motion.twist?.moving && draft.motion.twist.rateLevel === undefined)
      return {kind:'motion',
        request: buildMotionRequest('fixture-1', record, draft.coordinate, PARAMS,
          {forParams:['twist'], waveforms: WAVEFORMS}),
        candidates:{}};
    return null;  // the unit is complete
  }
};

const fail = (m) => { console.error('SMOKE FAILED: ' + m); rmSync(dir,{recursive:true,force:true}); process.exit(1); };

const r = await runUnit(composer, record.recordId, record.tag, {seed: 12345, overrides});
if (r.status !== 'completed') fail(`job ended ${r.status}: ${r.snapshot.errorCode} ${r.snapshot.errorMessage}`);

const {snapshot, receipts} = r.composition ?? {};
if (!snapshot) fail('no composition row was written');

// The three commit arms landed their effects.
if (snapshot.coordinate.shape?.density !== 'busy') fail('axes arm did not commit the coordinate');
if (snapshot.stacks.shape?.lookId !== 'look_2') fail('looks arm did not commit the planted look');
if (snapshot.stacks.shape?.params.sharp !== 4.4) fail('the candidate map lookup did not apply the recorded effect');
if (snapshot.motion.twist?.moving !== true) fail('motion arm: the moving noul did not cross the band');
if (snapshot.motion.gain?.moving !== false) fail('motion arm: a low noul was read as moving');
if (snapshot.motion.twist?.waveform !== 'sine') fail('motion arm: waveform not committed');
if (snapshot.motion.twist?.rateLevel !== 3) fail('motion arm: rate ordinal not committed');

// The receipts persisted, one per question, each labeled synthetic and carrying its class.
const byType = receipts.reduce((a,x)=>(a[x.answerType]=(a[x.answerType]||0)+1,a),{});
for (const t of ['noul','choice','score']) if (!byType[t]) fail(`no ${t} receipt persisted`);
if (!receipts.every(x => x.provenance === 'synthetic')) fail('a fixture receipt was not labeled synthetic');
if (!receipts.every(x => x.providerClass === 'FIXTURE')) fail('a receipt lost its provider class');
if (!receipts.every(x => x.rosterVersion && x.promptTemplateVersion && x.candidateMapVersion))
  fail('a receipt is missing a version pin');

// The journal is a journal: the rows are there to resume and to report from.
const rows = r.db.prepare('SELECT COUNT(*) c FROM attempts').get().c;
const events = r.bus.replay(r.jobId).map(e=>e.type);
if (!rows) fail('no attempt rows persisted');
if (!events.includes('job.completed')) fail('the run log has no completion event');

/* ── THE REFUSAL LEG: a validator that has never refused cannot be told from one that
      cannot refuse. Two planted-bad answers, both reasons printed. ───────────────── */
const fixture = new FixtureProvider(fixturePath);
const req = buildLookRequest('fixture-1', record, {}, {shape: LOOKS});
const good = await fixture.decide(req, new AbortController().signal);
const refusals = [];

const sumBad = structuredClone(good.response);
sumBad.answers.look_shape.probabilities = {look_1: 0.6, look_2: 0.6, look_3: 0.6};   // sums to 1.8
try { validateResponse(sumBad, req); fail('a distribution summing to 1.8 was ACCEPTED'); }
catch (e) { refusals.push(e.message); }

const outOfSet = structuredClone(good.response);
outOfSet.answers.look_shape.choice = 'look_invented';
try { validateResponse(outOfSet, req); fail('a choice outside the submitted set was ACCEPTED'); }
catch (e) { refusals.push(e.message); }

console.log(JSON.stringify({
  smoke:'fixture', provider:r.provider.id, providerClass:r.provider.providerClass,
  jobId:r.jobId, status:r.status, decisions:r.snapshot.decisionIndex,
  receipts:{total:receipts.length, ...byType},
  snapshotHash:r.composition.hash,
  committed:{coordinate:snapshot.coordinate.shape, look:snapshot.stacks.shape.lookId,
    motion:snapshot.motion},
  events, attempts:rows,
  refusedAsRequired: refusals
}, null, 2));

r.db.close();
rmSync(dir, {recursive:true, force:true});

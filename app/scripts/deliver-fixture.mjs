/** THE I5 RUN — compose one unit (fixture provider), then WRITE it into the consuming app's
 *  own source-keyed preset bank through the app's own endpoint, and read it back.
 *
 *  `docs/PLAN.md` §1 I5, executable:
 *
 *    compose  →  a unit artifact (the I4 path, unchanged)
 *    render   →  one preset slot in the app's card-snapshot shape, carrying
 *                `generation.provenance` (receipts + provider identity + roster provenance
 *                + unit sha + the one chain entry)
 *    deliver  →  GET the bank · GET it again (the live-card compare-and-swap) · POST ·
 *                GET once more and assert the stored slot is byte-identical to what was sent
 *
 *  ZERO network beyond the app's own loopback dev-server; zero model. The record is picked
 *  by the RESOLVER, never by name.
 *
 *  ⚠ `--key` IS REQUIRED, AND IT COMES FROM THE APP. A record's card source is composed at
 *  LOAD time against live app state (the user palette store rides the shader's palette
 *  roster), so the sha its preset bank is keyed by cannot be derived offline — measured
 *  2026-09-20, `server/deliver.ts` §2. The runbook is three commands, in the app's repo and
 *  this one:
 *
 *    node tools/run-macros.js --json jev.composed-preset-key      # publishes card._srcPresetKey
 *    npm run deliver:fixture -- --url <that server> --key <key>
 *    node tools/run-macros.js jev.composed-preset-loads           # the proof
 *
 *  Options: --url <base>  --key <src_…>  --slot <id>  --tag "<axis:word …>"  --seed <n>
 *           --record <id>  --keep
 */
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {composeUnit} from '../server/compose.js';
import {deliverUnit, DeliverRefusal} from '../server/deliver.js';
import {loadConfig} from '../server/config.js';
import {loadRecordIndex} from '../core/records.js';
import {FixtureProvider} from '../server/fixture.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i+1] : d; };
const flag = (n) => argv.includes('--' + n);

const cfg = loadConfig();
const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);

/** THE SUBJECT IS THE ACCEPTANCE MACRO'S, NOT THIS SCRIPT'S.
 *
 *  `server/compose.ts resolveSubject` picks by what a record CARRIES and is the right
 *  resolver for a compose-only run. It is the wrong one here, because the slot this run
 *  writes is keyed to ONE record's composed source, and the macro that has to recall it
 *  resolves its own subject through the app's `resolve_subject` verb — a different index
 *  order. Two resolvers, one slot, and the macro would look for it on a record that has
 *  none.
 *
 *  So this mirrors the app's rule exactly: filter, sort by `id` ASCENDING, take `pick`
 *  (`app/js/macro-engine.js` mcResolveSubject). It is a mirror and it is named as one —
 *  AND THE LOOP IS CLOSED IN THE APP: the macro asserts the loaded card's live
 *  `_srcPresetKey` equals the key this run printed, so a divergence between the two
 *  resolvers REDs there and names both, rather than reading as an empty preset slot.
 *  `--record` overrides both, for a run that wants a named subject.
 */
const NEEDS = {route:'raymarch', hasFormula:true, minInputs:3};
function subjectLikeTheMacro() {
  // The RAW index, not the descriptor: `hasFormula` is a clause over the record FILE, and
  // `RecordDescriptor` deliberately does not carry the formula (the model is never shown
  // GLSL — docs/COMPOSER.md §8 L6). The app's clause reads the same raw field.
  const raw = JSON.parse(readFileSync(cfg.shapesIndex, 'utf8'));
  const ids = (raw.records || [])
    .filter(r => r && r.route === NEEDS.route && !!r.formula &&
                 Object.keys(r.inputs || {}).length >= NEEDS.minInputs)
    .map(r => String(r.id))
    .sort();
  if (!ids.length) throw new Error('no record satisfies ' + JSON.stringify(NEEDS));
  return ids[0];
}
const recordId = arg('record', null) ?? subjectLikeTheMacro();
const tag = arg('tag', 'motion:pulse density:busy contrast:hard warmth:cold order:regular depth:deep');
const seed = parseInt(arg('seed', '1743'), 10);
const slot = arg('slot', '1');
const baseUrl = arg('url', process.env.JEV_APP_URL || 'http://127.0.0.1:8080');
const key = arg('key', process.env.JEV_BANK_KEY || null);
if (!key) {
  console.error('DELIVER FAILED: --key is required and is READ OFF A LOADED CARD — run\n' +
    '  node tools/run-macros.js --json jev.composed-preset-key\n' +
    'in the app repo against the SAME server and pass the `key` it publishes. It is not\n' +
    'derived here: a record composes at LOAD time against live app state, so a guessed key\n' +
    'writes a bank no card will ever open (server/deliver.ts §2).');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'jevisualeyes-deliver-'));
const fixturePath = join(work, 'fixture.json');
writeFileSync(fixturePath, JSON.stringify({default: 0.9}, null, 2));

const fail = (m) => { console.error('DELIVER FAILED: ' + m);
  if (!flag('keep')) rmSync(work, {recursive:true, force:true}); process.exit(1); };

try {
  const composed = await composeUnit({
    recordId, tag, seed, dataDir: join(work,'run'), outDir: join(work,'units'),
    overrides: {providerId:'fixture', fixturePath},
    provider: new FixtureProvider(fixturePath)
  });

  const {report, slot:written} = await deliverUnit({artifactPath: composed.path, key, slot, baseUrl});

  // ── THE LIVE-CARD REFUSAL, EXERCISED (docs/PLAN.md §1 I2's rule, applied to this gate):
  // a refusal that has never been made to fire is indistinguishable from one that cannot.
  // An in-memory transport mutates the bank BETWEEN the two reads — exactly what a live
  // card saving into the same source does — and the write must never be attempted.
  let refusal = null;
  {
    let reads = 0, posted = false;
    const bank = {presets:{}};
    const racing = {
      async get() {
        reads++;
        if (reads === 2) bank.presets = {...bank.presets, 7:{name:'the operator\'s own save'}};
        return {presets:{...bank.presets}};
      },
      async post() { posted = true; }
    };
    try {
      await deliverUnit({artifactPath: composed.path, key, slot, baseUrl, transport: racing});
      fail('the live-bank refusal did NOT fire on a bank that moved between reads');
    } catch (e) {
      if (!(e instanceof DeliverRefusal)) fail('the racing leg threw something other than a ' +
        'DeliverRefusal: ' + (e?.message ?? e));
      if (posted) fail('the live-bank refusal fired but the POST had already gone out');
      refusal = e.message.split('\n')[0];
    }
  }

  console.log(JSON.stringify({
    run:'deliver:fixture',
    ...report,
    slotName: written.name,
    nParams: Object.keys(written.params).length,
    nRanges: Object.keys(written.ranges).length,
    nSliderBlend: Object.keys(written.sliderBlend ?? {}).length,
    opActiveScopes: Object.keys(written.opActive ?? {}),
    nPostPass: (written.postPassChain ?? []).length,
    nReceivers: (written.bindings?.receivers ?? []).length,
    provenanceMode: written.generation.provenance.mode,
    readBackIdentical: report.sentSha256 === report.readBackSha256,
    liveCardRefusalExercised: refusal
  }, null, 2));
  if (!flag('keep')) rmSync(work, {recursive:true, force:true});
  else console.log('kept: ' + work);
} catch (e) {
  fail((e?.detail ? JSON.stringify(e.detail) + ' — ' : '') + (e?.stack || e?.message || String(e)));
}

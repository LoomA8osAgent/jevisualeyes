/** THE I4 RUN — one record, one tag, fixture provider, end to end, then the re-run.
 *
 *  `docs/PLAN.md` §1 I4's acceptance, executable:
 *
 *    compose  →  a composed snapshot on disk with its receipts
 *    re-run   →  the SAME seed, answered only from the stored responses, byte-identical
 *                (asserted by sha256 over the canonical snapshot, never by inspection)
 *
 *  ZERO network, zero model. The record is picked by a RESOLVER — the first record in the
 *  descriptor index carrying ≥3 composable knobs — never by name, so this run does not
 *  quietly become a test of one hand-chosen file.
 *
 *    node --run compose:fixture        (or: npx tsx scripts/compose-fixture.mjs)
 *
 *  Options: --tag "<axis:word …>"  --seed <n>  --out <dir>  --record <id>  --keep
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {composeUnit, replayUnit, resolveSubject} from '../server/compose.js';
import {loadConfig} from '../server/config.js';
import {loadRecordIndex} from '../core/records.js';
import {FixtureProvider} from '../server/fixture.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i+1] : dflt; };
const flag = (name) => argv.includes('--' + name);

const cfg = loadConfig();
const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);
const recordId = arg('record', null) ?? resolveSubject(index, 3);
const tag = arg('tag', 'motion:pulse density:busy contrast:hard warmth:cold order:regular depth:deep');
const seed = parseInt(arg('seed', '1743'), 10);

const work = mkdtempSync(join(tmpdir(), 'jevisualeyes-compose-'));
const outDir = arg('out', join(work, 'units'));
const fixturePath = join(work, 'fixture.json');

// THE PLANTED MAP (`docs/COMPOSER.md` §3.2): the fixture is TOLD what to answer and never
// infers one from the state. `default` answers every question the map does not name — a
// noul as that probability, a choice/score as its FIRST submitted candidate. The look ids
// are seed-derived, so planting them by name would be planting a hash; the index form is
// how a menu-shaped answer is planted here.
writeFileSync(fixturePath, JSON.stringify({default: 0.9}, null, 2));

const fail = (m) => { console.error('COMPOSE FAILED: ' + m);
  if (!flag('keep')) rmSync(work, {recursive:true, force:true}); process.exit(1); };

try {
  const first = await composeUnit({
    recordId, tag, seed, dataDir: join(work, 'run-1'), outDir,
    overrides: {providerId:'fixture', fixturePath},
    provider: new FixtureProvider(fixturePath)
  });

  if (!first.artifact.receipts.length) fail('the unit carries no receipts');
  if (!first.artifact.calls.length) fail('the unit carries no provider calls — a re-run would need a provider');
  if (!Object.keys(first.artifact.snapshot.stacks).length) fail('no stack committed a look');
  if (!first.artifact.receipts.every(x => x.provenance === 'synthetic'))
    fail('a fixture receipt was not labeled synthetic');

  const again = await replayUnit(first.path, {
    dataDir: join(work, 'run-2'), outDir: join(work, 'units-replay'),
    // The replay answers from the artifact; the configured provider is never reached. The
    // fixture path is still named so a mis-wiring FAILS rather than silently inferring.
    overrides: {providerId:'fixture', fixturePath}
  });

  if (again.artifact.snapshotSha256 !== first.artifact.snapshotSha256)
    fail(`the re-run is not byte-identical: ${first.artifact.snapshotSha256} vs ${again.artifact.snapshotSha256}`);

  console.log(JSON.stringify({
    run:'compose:fixture',
    record:recordId, tag, seed,
    provider:first.artifact.provider,
    composableKnobs:index.get(recordId).composableKnobs.length,
    stacks:Object.fromEntries(Object.entries(first.artifact.snapshot.stacks).map(([k,v]) => [k, v.lookId])),
    motion:Object.fromEntries(Object.entries(first.artifact.snapshot.motion).map(([k,v]) => [k, v.moving])),
    calls:first.artifact.calls.map(c => `${c.decisionIndex}:${c.kind}`),
    receipts:first.artifact.receipts.length,
    notAsked:first.artifact.notAsked,
    resampled:first.artifact.resampled,
    snapshotSha256:first.artifact.snapshotSha256,
    replaySha256:again.artifact.snapshotSha256,
    byteIdentical:true,
    artifact:first.path
  }, null, 2));
  if (!flag('keep')) rmSync(work, {recursive:true, force:true});
  else console.log('kept: ' + work);
} catch (e) {
  fail(e?.stack || e?.message || String(e));
}

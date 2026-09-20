/** I5's PROOF — the render and the two refusals.
 *
 *  `docs/PLAN.md` §1 I5. Paths and seams, not suites: the compose loop is I4's and is not
 *  re-proven here, and the APP's own save/recall path is a known-good path proven by its own
 *  gate (`jev.composed-preset-loads`). What is new is (a) the render from a composed unit to
 *  the app's card-snapshot shape, (b) `generation.provenance`, and (c) the two refusals the
 *  write is guarded by — so those, and nothing else, are what is asserted.
 *
 *  THE REFUSALS ARE EXERCISED, NOT DESCRIBED. A gate that has never refused is
 *  indistinguishable from one that cannot (`docs/PLAN.md` §1 I2's own rule): a transport
 *  that moves the bank between the two reads must be refused WITHOUT a POST, and a transport
 *  that stores something other than what was sent must be refused after the read-back.
 *
 *  THE SUBJECT is picked by a resolver, never by name.
 */
import {test, assert} from 'vitest';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {FixtureProvider} from '../server/fixture.js';
import {composeUnit, resolveSubject, readUnitArtifact} from '../server/compose.js';
import {loadRecordIndex} from '../core/records.js';
import {loadRosters} from '../core/rosters.js';
import {renderSlot, blendOrderFrom, curveIdFor, rateForLevel} from '../core/slot.js';
import {deliverUnit, DeliverRefusal} from '../server/deliver.js';
import type {BankTransport, PresetBank} from '../server/deliver.js';

const cfg = loadConfig();
const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);
const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const RECORD = resolveSubject(index, 3);
const TAG = 'motion:pulse density:busy contrast:hard warmth:cold order:regular depth:deep';
const SEED = 1743;
/** A key of the app's own shape. It is HANDED IN, never derived (`server/deliver.ts` §2), so
 *  a test supplies a literal exactly as the runbook supplies the one a loaded card published. */
const KEY = 'src_0000000000000000000000000000test';

async function composeOne(work:string) {
  const fixturePath = join(work, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify({default:0.9}));
  const {path} = await composeUnit({
    recordId:RECORD, tag:TAG, seed:SEED,
    dataDir:join(work,'run'), outDir:join(work,'units'),
    overrides:{providerId:'fixture', fixturePath},
    provider:new FixtureProvider(fixturePath)
  });
  return readUnitArtifact(path);
}

/** The thing must REFUSE, as a `DeliverRefusal`, for the stated reason — and it must not
 *  quietly succeed. Written out rather than taken from the runner so the failure message
 *  names which half went wrong (succeeded / wrong class / wrong reason). */
async function refuses(run:() => Promise<unknown>, reason:RegExp):Promise<void> {
  let thrown:unknown = null;
  try { await run(); } catch (e) { thrown = e; }
  assert.ok(thrown, `expected a refusal matching ${reason} — the call SUCCEEDED`);
  assert.ok(thrown instanceof DeliverRefusal,
    `expected a DeliverRefusal, got ${(thrown as any)?.name}: ${(thrown as any)?.message}`);
  assert.ok(reason.test((thrown as Error).message),
    `the refusal fired for a different reason: ${(thrown as Error).message}`);
}

/** A bank that behaves like the app's endpoint: last-write-wins over the whole body. */
function memoryBank(seed:PresetBank = {presets:{}}) {
  let body:PresetBank = JSON.parse(JSON.stringify(seed));
  const calls = {get:0, post:0};
  const tx:BankTransport = {
    async get() { calls.get++; return JSON.parse(JSON.stringify(body)); },
    async post(_k, b) { calls.post++; body = JSON.parse(JSON.stringify(b)); }
  };
  return {tx, calls, read:() => body};
}

test('I5: a composed unit renders into the app\'s snapshot shape, carrying generation.provenance', async () => {
  const work = mkdtempSync(join(tmpdir(), 'jev-i5-render-'));
  try {
    const unit = await composeOne(work);
    const blendOrder = blendOrderFrom(rosters);
    const {slot, refused} = renderSlot(unit, {rosters, blendOrder, now:'2026-01-01T00:00:00.000Z'});

    // The key forms the samplers wrote are ROUTED, not copied into `params` wholesale.
    assert.ok(Object.keys(slot.params).length > 0, 'no param reached the slot');
    for (const k of Object.keys(slot.params)) {
      assert.ok(!k.endsWith('.blend') && !k.startsWith('bind:') && !k.startsWith('opActive.') &&
                k !== 'postPassChain',
        `"${k}" is a routed key form and must never land in params`);
    }
    // A blend name became an INTEGER index into the app's own 30-mode roster.
    for (const [name, b] of Object.entries(slot.sliderBlend ?? {})) {
      assert.ok(Number.isInteger(b.mode) && b.mode >= 0 && b.mode < blendOrder.length,
        `sliderBlend[${name}].mode ${b.mode} is not an index into the app's roster`);
      assert.equal(b.against, 'default');
    }
    // Every bind that landed is an OSCILLATOR receiver with a real curve and a bracket that
    // agrees with `ranges` — the app applies the bracket before the bind, so a receiver
    // whose window disagreed with the slot's would move the slider somewhere else.
    const easingIds = new Set(rosters.easings.map(e => e.id));
    for (const r of (slot.bindings?.receivers ?? []) as any[]) {
      const osc = r.transform.oscillator;
      assert.ok(easingIds.has(osc.curveId), `curve "${osc.curveId}" is not in the app's easing library`);
      assert.deepEqual(slot.ranges[r.targetParam], [osc.base, osc.base + osc.depth]);
      assert.equal(r.active, true);
    }
    // Every refusal NAMES itself; none is an empty-by-omission.
    for (const r of refused) assert.ok(r.key && r.reason && r.reason.length > 20, JSON.stringify(r));

    // §generation.provenance — the identity, the receipts, and the ONE chain entry.
    const p = slot.generation.provenance;
    assert.equal(p.mode, 'synthetic', 'a fixture run must never launder its provenance');
    assert.equal(p.providerClass, 'FIXTURE');
    assert.equal(p.recordId, unit.recordId);
    assert.equal(p.unitSha256, unit.snapshotSha256);
    assert.equal(p.receipts.length, unit.receipts.length);
    assert.ok(p.receipts.length > 0, 'a composed slot with no receipts is untraceable');
    assert.ok(p.rosters && (p.rosters as any).sources.length > 0,
      'the roster export it composed against is not named');
    assert.equal(p.chain.length, 1, 'exactly one chain entry — not a second chain');
    assert.deepEqual(Object.keys(p.chain[0]).sort(),
      ['action','by','contentHash','description','timestamp'],
      'the entry must be in the app\'s own prvAppend shape, with no field of our own');
    assert.equal(p.chain[0].action, 'preset-save');
    assert.equal(p.chain[0].contentHash, 'sha256:' + unit.snapshotSha256);
  } finally { rmSync(work, {recursive:true, force:true}); }
});

test('I5: the write reads back identical, and a moved bank is REFUSED before the POST', async () => {
  const work = mkdtempSync(join(tmpdir(), 'jev-i5-write-'));
  try {
    const unit = await composeOne(work);
    const artifactPath = join(work,'units', (await (async () => {
      const {readdirSync} = await import('node:fs');
      return readdirSync(join(work,'units'))[0];
    })()));

    // ── the happy path: GET · GET · POST · GET, and the stored slot is what was sent.
    const bank = memoryBank();
    const {report} = await deliverUnit({artifactPath, key:KEY, slot:'3', transport:bank.tx});
    assert.equal(report.sentSha256, report.readBackSha256);
    assert.equal(bank.calls.post, 1, 'exactly one write');
    assert.equal(bank.calls.get, 3, 'read · read-again (the compare-and-swap) · read-back');
    assert.deepEqual(report.slotsAfter, ['3']);
    assert.equal(report.recordId, unit.recordId);

    // ── REFUSAL 1 — the bank moved between the two reads (a live card saving into it).
    let posted = false, reads = 0;
    const racing:BankTransport = {
      async get() {
        reads++;
        return {presets: reads >= 2 ? {9:{name:'the operator\'s own save'}} : {}};
      },
      async post() { posted = true; }
    };
    await refuses(() => deliverUnit({artifactPath, key:KEY, slot:'3', transport:racing}),
      /changed between two reads/);
    assert.equal(posted, false, 'the refusal fired but the POST had already gone out');

    // ── REFUSAL 2 — the endpoint accepted the write and stored something else. Only the
    // read-back can see this; a 200 is not evidence.
    const lying:BankTransport = {
      async get() { return {presets:{}}; },      // always empty — the write never lands
      async post() { /* accepted, stored nowhere */ }
    };
    await refuses(() => deliverUnit({artifactPath, key:KEY, slot:'3', transport:lying}), /absent from/);

    // ── a key that is not the app's shape is refused BEFORE anything is read: a guessed
    // key writes a bank no card will ever open, and that failure is silent by nature.
    await refuses(() => deliverUnit({artifactPath, key:'assay-knot-tube', slot:'3',
      transport:memoryBank().tx}), /is not an app preset-bank key/);

    // ── and slot D is refused outright: it is the card's own first-compile face.
    await refuses(() => deliverUnit({artifactPath, key:KEY, slot:'D', transport:memoryBank().tx}), /slot D/);
  } finally { rmSync(work, {recursive:true, force:true}); }
});

test('I5: a movement the app\'s easing library cannot express is REFUSED, never defaulted', () => {
  const easingIds = new Set(rosters.easings.map(e => e.id));
  assert.equal(curveIdFor('ease:spring', easingIds), 'spring');
  assert.equal(curveIdFor('sine', easingIds), 'sine');
  // An LFO-bank waveform the easing library does not carry has no curve id and no router
  // source a preset alone can name (`core/slot.ts` §the bind).
  assert.equal(curveIdFor('s&h', easingIds), null);
  assert.equal(curveIdFor('ease:no-such-curve', easingIds), null);
  // The ordinal → cycles-per-turn map is arithmetic, in code, and never below one cycle.
  assert.equal(rateForLevel(0), 1);
  assert.equal(rateForLevel(2), 3);
  assert.equal(rateForLevel(-5), 1);
});

/** THE I5.5 RUN — one composed look set for the SHARED SHADING ACCORDION, asked of the
 *  LOCAL decision model (`docs/PLAN.md` §1.0b, `specs/ai/decision-models.md` §P2.10).
 *
 *  For each of the ten SHADING children: sample N candidate looks per slot (1..11), bundle
 *  them into ≤6-question Choice requests, ask the configured provider (default `local` —
 *  Laya via `von serve` on loopback), and accept the model's pick. Diversity across a bank's
 *  11 slots is enforced IN CODE (a redraw + re-ask on a fresh pool), never by re-asking the
 *  model over the SAME pool.
 *
 *  `surface`'s eleven looks are COMPOSED, not diagonally copied (audit fix, 2026-09-20): each
 *  of the 11 looks targets a DISTINCT axis coordinate across the four shading axes
 *  (contrast/warmth/density/depth — `spreadShadingCoordinates`), and for each look, EVERY
 *  child bank gets its OWN Choice — "which of this bank's eleven already-built slots best
 *  fits this target" — so `childSlots` is eleven real per-child decisions, never the same
 *  slot index copied down every bank. A vector that duplicates an already-accepted one is
 *  rejected in code and re-asked against the next unused coordinate (never silently kept).
 *
 *    node --run compose:shading           (writes data/shading-compose-<ts>.json)
 *
 *  Options: --candidates <n=3>  --seed <n>  --provider local|fixture|jev  --out <dir>
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig, effectiveProvider, effectiveKey} from '../server/config.js';
import {providerFor} from '../server/provider.js';
import {loadRosters} from '../core/rosters.js';
import {shadingBankIds, shadingChildren, bankKnobs, bankExclusions, shadingGroup} from '../core/shading.js';
import {sampleSlotCandidates, bankDistance, diverseEnough, cleanLabel,
  spreadShadingCoordinates, coordinateLabel, coordinateLine} from '../core/shading-samplers.js';
import {buildShadingRequest, slotQuestionId, chunkSlots,
  buildChildPickRequest, childPickQuestionId} from '../core/shading-requests.js';
import {validateResponse} from '../core/validate.js';
import {selectChoice} from '../core/selection.js';
import {hashJSON} from '../core/hash.js';

const argv = process.argv.slice(2);
const arg = (n,d) => { const i = argv.indexOf('--'+n); return i>=0 ? argv[i+1] : d; };
const N_CANDIDATES = parseInt(arg('candidates','3'),10);
const SLOTS = 11;
const SEED = parseInt(arg('seed','7331'),10) >>> 0;
const MAX_RETRY = 2;
const MAX_VECTOR_RETRIES = 8; // total collisions this run will resolve before refusing loudly

const cfg = loadConfig();
const providerId = arg('provider', null) ?? effectiveProvider(cfg);
const key = providerId === 'jev' ? effectiveKey(cfg) : undefined;
const provider = providerFor(cfg, providerId, key);
const model = providerId === 'jev' ? cfg.jevModel : providerId === 'local' ? cfg.localModel : 'fixture';

const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
const allBanks = shadingBankIds(rosters);
const children = shadingChildren(rosters);
if (!allBanks.includes('surface')) throw new Error('the roster carries no "surface" bank — the shading tree moved');
if (children.length !== 10) throw new Error(`expected 10 shading children, roster carries ${children.length}: ${children.join(',')}`);

let callCount = 0;
const receipts = [];
const banksOut = {};
const childLooks = {}; // gid -> {slot -> ShadingLook}, kept for the child-pick criteria
const report = [];

async function decide(request) {
  callCount++;
  const controller = new AbortController();
  const receipt = await provider.decide(request, controller.signal);
  const answers = validateResponse(receipt.response, request);
  return {answers, receipt};
}

function recordReceipt(gid, slot, qid, request, candidates, ans, sel, receipt) {
  receipts.push({
    schemaVersion:'a8os.jev.shading-receipt.v1',
    bank:gid, slot, questionId:qid,
    providerId:provider.id, providerClass:provider.providerClass, model:receipt.response.model,
    requestHash:hashJSON(request), candidateHash:hashJSON(candidates),
    providerChoice: ans.type==='choice' ? ans.choice : null,
    selectedChoice: sel.selected, confidence: ans.confidence,
    usage: receipt.response.usage, latencyMs: receipt.latencyMs,
    provenance: provider.provenance
  });
}

/** Ask for every slot of one bank, in ≤6-question batches. Returns slot -> chosen look. */
async function askBank(gid, label) {
  const pending = [];
  for (let slot = 1; slot <= SLOTS; slot++)
    pending.push({slot, candidates: sampleSlotCandidates(gid, slot, 0, SEED, N_CANDIDATES, rosters)});
  const chosen = {};
  for (const batch of chunkSlots(pending)) {
    const request = buildShadingRequest(model, gid, label, batch);
    if (!Object.keys(request.questions).length) continue;
    const {answers, receipt} = await decide(request);
    for (const {slot, candidates} of batch) {
      const qid = slotQuestionId(gid, slot);
      const ans = answers[qid];
      if (!ans) continue;
      const sel = selectChoice(ans, {mode:'model'});
      const look = candidates.find(c => c.id === sel.selected);
      chosen[slot] = look;
      recordReceipt(gid, slot, qid, request, candidates, ans, sel, receipt);
    }
  }
  return chosen;
}

/** Diversity pass: redraw+re-ask a slot that lands too close to an already-accepted slot
 *  in the SAME bank, up to MAX_RETRY, then accept regardless (noted in the report). */
async function diversify(gid, label, chosen) {
  const slots = Object.keys(chosen).map(Number).sort((a,b) => a - b);
  const acceptedParams = [];
  const final = {};
  let forcedAccepts = 0;
  for (const slot of slots) {
    let look = chosen[slot];
    let attempt = 0;
    while (!diverseEnough(gid, look.params, acceptedParams, rosters) && attempt < MAX_RETRY) {
      attempt++;
      const candidates = sampleSlotCandidates(gid, slot, attempt, SEED, N_CANDIDATES, rosters);
      const request = buildShadingRequest(model, gid, label, [{slot, candidates}]);
      const {answers, receipt} = await decide(request);
      const qid = slotQuestionId(gid, slot);
      const ans = answers[qid];
      const sel = selectChoice(ans, {mode:'model'});
      look = candidates.find(c => c.id === sel.selected);
      recordReceipt(gid, slot, qid, request, candidates, ans, sel, receipt);
    }
    if (!diverseEnough(gid, look.params, acceptedParams, rosters)) forcedAccepts++;
    acceptedParams.push(look.params);
    final[slot] = look;
  }
  const minPair = acceptedParams.length > 1
    ? Math.min(...acceptedParams.flatMap((p,i) => acceptedParams.slice(i+1).map(q => bankDistance(gid,p,q,rosters))))
    : 1;
  return {final, minPairDistance: minPair, forcedAccepts};
}

async function fillOrdinaryBank(gid) {
  const g = shadingGroup(gid, rosters);
  const knobs = bankKnobs(gid, rosters);
  if (!knobs.length) {
    banksOut[gid] = {presets:{}};
    childLooks[gid] = {};
    report.push({bank:gid, label:g.label, knobs:0, slots:0, minPairDistance:null, forcedAccepts:0});
    return;
  }
  const chosen = await askBank(gid, g.label);
  const {final, minPairDistance, forcedAccepts} = await diversify(gid, g.label, chosen);
  childLooks[gid] = final;
  banksOut[gid] = {presets: Object.fromEntries(Object.entries(final).map(([slot, look]) => [
    slot, {name: cleanLabel(look.label), values: {params: look.params, bindings:{receivers:[],senders:[]}}}
  ]))};
  report.push({bank:gid, label:g.label, knobs:knobs.length, slots:Object.keys(final).length,
    minPairDistance, forcedAccepts, exclusions: bankExclusions(gid, rosters).length});
}

/** ONE surface look's childSlots vector: a real per-child Choice against a distinct target
 *  coordinate, bundled ≤6 questions/request (10 children → 2 requests per look). */
async function pickChildSlotsFor(surfaceSlot, coordinate) {
  const banks = children.map(cgid => ({
    gid:cgid, label:shadingGroup(cgid, rosters).label,
    slots:Object.entries(childLooks[cgid]).map(([slot, look]) => ({slot:Number(slot), look}))
  })).filter(b => b.slots.length >= 2);
  const vector = {};
  for (const batch of chunkSlots(banks)) {
    const request = buildChildPickRequest(model, coordinate, batch);
    if (!Object.keys(request.questions).length) continue;
    const {answers, receipt} = await decide(request);
    for (const {gid} of batch) {
      const qid = childPickQuestionId(gid);
      const ans = answers[qid];
      if (!ans) continue;
      const sel = selectChoice(ans, {mode:'model'});
      vector[gid] = sel.selected; // the choice key IS the slot number (buildChildPickRequest)
      receipts.push({
        schemaVersion:'a8os.jev.shading-receipt.v1',
        bank:gid, slot:`surface:${surfaceSlot}`, questionId:qid,
        providerId:provider.id, providerClass:provider.providerClass, model:receipt.response.model,
        requestHash:hashJSON(request), candidateHash:hashJSON(batch.find(b=>b.gid===gid).slots),
        providerChoice: ans.choice, selectedChoice: sel.selected, confidence: ans.confidence,
        usage: receipt.response.usage, latencyMs: receipt.latencyMs, provenance: provider.provenance
      });
    }
  }
  // Any child bank with < 2 slots (should not happen at 11 slots each, but never silently
  // drop a childSlots entry) still needs an entry — falls back to its only/first slot.
  for (const cgid of children) if (!(cgid in vector)) {
    const only = Object.keys(childLooks[cgid])[0];
    if (only) vector[cgid] = only;
  }
  return vector;
}

const vectorSignature = (v) => children.map(c => `${c}=${v[c]}`).join('|');

async function fillSurfaceBank() {
  const gid = 'surface';
  const g = shadingGroup(gid, rosters);
  const knobs = bankKnobs(gid, rosters);
  // The surface's OWN 12-ish knobs still ride the same candidate-pool decision every other
  // bank does — this part of the audit's fix (item 1) is about childSlots, not this half.
  const chosen = await askBank(gid, g.label);
  const {final: ownFinal, minPairDistance, forcedAccepts} = await diversify(gid, g.label, chosen);

  const coords = spreadShadingCoordinates(SLOTS + MAX_VECTOR_RETRIES, SEED);
  const usedSignatures = [];
  const presets = {};
  let retriesSpent = 0;
  let coordCursor = SLOTS; // index of the next unused RESERVE coordinate

  for (let slot = 1; slot <= SLOTS; slot++) {
    let coordinate = coords[slot - 1];
    let vector = await pickChildSlotsFor(slot, coordinate);
    while (usedSignatures.includes(vectorSignature(vector))) {
      if (retriesSpent >= MAX_VECTOR_RETRIES || coordCursor >= coords.length)
        throw new Error(`surface slot ${slot}: childSlots vector collided with an earlier slot ` +
          `and the ${MAX_VECTOR_RETRIES}-retry reserve is exhausted — refusing to ship a ` +
          `duplicate childSlots vector rather than hide it`);
      retriesSpent++;
      coordinate = coords[coordCursor++];
      vector = await pickChildSlotsFor(slot, coordinate);
    }
    usedSignatures.push(vectorSignature(vector));

    const params = {...ownFinal[slot].params};
    const childSlots = {};
    for (const cgid of children) {
      const chosenSlot = vector[cgid];
      const childPreset = banksOut[cgid]?.presets?.[chosenSlot];
      if (!childPreset) continue;
      Object.assign(params, childPreset.values.params);
      childSlots[cgid] = chosenSlot;
    }
    presets[slot] = {
      name: coordinateLabel(coordinate),
      values:{params, bindings:{receivers:[],senders:[]}, childSlots},
      // carried in the compose ARTIFACT only (stripped by deliver-shading.mjs's target shape
      // check — the app's own bank schema is {name,values}); kept here for the return brief.
      _coordinate: coordinate, _coordinateLine: coordinateLine(coordinate)
    };
  }
  banksOut[gid] = {presets: Object.fromEntries(Object.entries(presets).map(([slot, p]) => [
    slot, {name:p.name, values:p.values}
  ]))};
  report.push({bank:gid, label:g.label, knobs:knobs.length, slots:Object.keys(presets).length,
    minPairDistance, forcedAccepts, exclusions: bankExclusions(gid, rosters).length,
    coordinateRetries: retriesSpent});
  return presets; // WITH _coordinate, for the console summary + artifact-level report
}

const started = Date.now();
for (const gid of children) await fillOrdinaryBank(gid);
const surfacePresets = await fillSurfaceBank();
const elapsedMs = Date.now() - started;

const outDir = arg('out', join(cfg.dataDir));
mkdirSync(outDir, {recursive:true});
const ts = new Date().toISOString().replace(/[:.]/g,'-');
const outPath = join(outDir, `shading-compose-${ts}.json`);

const surfaceSummary = Object.entries(surfacePresets).map(([slot, p]) => ({
  slot, label:p.name, coordinate:p._coordinateLine, childSlots:p.values.childSlots
}));

const artifact = {
  run:'compose:shading',
  provider:{id:provider.id, modelId:provider.modelId, providerClass:provider.providerClass},
  respondedModel: receipts[0]?.model ?? null,
  rosterProvenance: rosters.provenance,
  candidatesPerSlot: N_CANDIDATES, seed: SEED,
  calls: callCount, elapsedMs, receipts: receipts.length,
  report,
  surfaceSummary,
  banksUnitSha256: hashJSON(banksOut),
  banks: banksOut
};
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
writeFileSync(join(outDir, 'shading-compose-latest.json'), JSON.stringify(artifact, null, 2));

console.log(JSON.stringify({
  run:'compose:shading', out:outPath,
  provider: artifact.provider, respondedModel: artifact.respondedModel,
  calls: callCount, elapsedMs, receipts: receipts.length,
  banks: report.map(r => ({bank:r.bank, slots:r.slots, minPairDistance:r.minPairDistance,
    forcedAccepts:r.forcedAccepts, coordinateRetries:r.coordinateRetries})),
  surfaceSummary,
  banksUnitSha256: artifact.banksUnitSha256
}, null, 2));

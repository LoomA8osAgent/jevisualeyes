/** THE I5.5 RUN — one composed look set for the SHARED SHADING ACCORDION, asked of the
 *  LOCAL decision model (`docs/PLAN.md` §1.0b, `specs/ai/decision-models.md` §P2.10).
 *
 *  THE PURPOSE (operator, 2026-09-20 13:57, verbatim): "this is EXACTLY to expose as many
 *  DIFFERENT looks as possible so I do not have to discover them all." Three mechanisms
 *  serve it, in order of what they guarantee:
 *
 *   1. SPREAD, inside each bank's own 11 slots — CODE-ONLY, no network. `stratifiedBankSlots`
 *      over-samples a candidate pool and greedily covers every menu row's every option
 *      (where 11 slots allow it), then fills any remainder by farthest-point distance. A
 *      bank whose own state space is smaller than 11 (`sub:lighting`'s 3 bools ⇒ 8 states)
 *      takes every distinct state and PADS with reported duplicates — never a forced-accept
 *      floor pretending 8 states are 11 different ones.
 *   2. PARTITION, across the 11 surface looks — each child bank's 11 slots map BIJECTIVELY
 *      onto the 11 looks: the menu offered for look k is the slots NOT YET used by looks
 *      1..k-1 (`shading-samplers.ts` `availableSlots`/`forcedSlot`/`commitPick`). A menu of
 *      one remaining slot is FORCED, never asked. This replaced an earlier `vectorSignature`
 *      distinctness-by-retry design that could (and did) still let a bank repeat a slot
 *      across looks — the partition makes repetition structurally impossible instead.
 *   3. COHERENCE — a light rig that varies how many lights are on (not mostly-all-on), lit
 *      lights that differ in TYPE from each other within one look, and (once the constraints
 *      lane lands) no offer that would complete a shader-incompatible material↔lighting
 *      combination. Laya's role is exactly this: given 1 and 2 already guarantee spread and
 *      non-repetition, which of the remaining code-valid slots best fits ONE look's target
 *      coordinate, in the CONSTRAINING order (lighting rig → material → the three lights →
 *      everything else).
 *
 *    node --run compose:shading           (writes data/shading-compose-<ts>.json)
 *
 *  Options: --seed <n>  --provider local|fixture|jev  --out <dir>  --oversample <n=500>
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig, effectiveProvider, effectiveKey} from '../server/config.js';
import {providerFor} from '../server/provider.js';
import {loadRosters} from '../core/rosters.js';
import {shadingBankIds, shadingChildren, bankKnobs, bankExclusions, shadingGroup} from '../core/shading.js';
import {stratifiedBankSlots, disambiguateLabels, spreadShadingCoordinates, coordinateLabel, coordinateLine,
  newPartitionState, availableSlots, forcedSlot, commitPick, violatesConstraint, isDarkened} from '../core/shading-samplers.js';
import {buildChildPickRequest, childPickQuestionId} from '../core/shading-requests.js';
import {validateResponse} from '../core/validate.js';
import {selectChoice} from '../core/selection.js';
import {hashJSON} from '../core/hash.js';

const argv = process.argv.slice(2);
const arg = (n,d) => { const i = argv.indexOf('--'+n); return i>=0 ? argv[i+1] : d; };
const SLOTS = 11;
const ALL_SLOTS = Array.from({length:SLOTS}, (_,i) => i+1);
const SEED = parseInt(arg('seed','7331'),10) >>> 0;
const OVERSAMPLE = parseInt(arg('oversample','500'),10);

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

// `shared.shading.constraints` is an OBJECT (`method`/`axes`/`baseDrivers`/`entries`/
// `glslNotes`/`combinations`) — `entries` is the per-combination verdict list this repo
// filters offers against; everything else is the derivation's own bookkeeping, read but
// not interpreted here (2026-09-20, read verbatim off the live bundle — never transcribed).
const constraints = Array.isArray(rosters.shading.constraints?.entries) ? rosters.shading.constraints.entries : [];
const constraintsPresent = constraints.length > 0;
const constraintsMeta = constraintsPresent ? {
  method: rosters.shading.constraints.method, combinations: rosters.shading.constraints.combinations
} : null;

// THE CONSTRAINING-FIRST ORDER (operator, 2026-09-20 14:00): the light rig (sub:lighting)
// and the material bank are asked before the three individually-typed lights, which are
// asked before everything else. Any child not named here follows in the roster's own order.
const PRIORITY_ORDER = ['sub:lighting', 'sub:material', 'sub:light1', 'sub:light2', 'sub:light3'];
const askOrder = [...PRIORITY_ORDER.filter(g => children.includes(g)),
  ...children.filter(g => !PRIORITY_ORDER.includes(g))];

let callCount = 0;
const receipts = [];
const banksOut = {};
const childLooks = {};     // gid -> {slot(string) -> ShadingLook}
const bankReport = [];     // per-bank stratification evidence
const notAskedLog = [];
const constraintRemovals = []; // {surfaceSlot, bank, removedSlots:[...]}

async function decide(request) {
  callCount++;
  const controller = new AbortController();
  const receipt = await provider.decide(request, controller.signal);
  const answers = validateResponse(receipt.response, request);
  return {answers, receipt};
}

function recordReceipt(bank, surfaceSlot, qid, request, options, ans, sel, receipt) {
  receipts.push({
    schemaVersion:'a8os.jev.shading-receipt.v1',
    bank, slot:`surface:${surfaceSlot}`, questionId:qid,
    providerId:provider.id, providerClass:provider.providerClass, model:receipt.response.model,
    requestHash:hashJSON(request), candidateHash:hashJSON(options),
    providerChoice: ans.choice, selectedChoice: sel.selected, confidence: ans.confidence,
    usage: receipt.response.usage, latencyMs: receipt.latencyMs, provenance: provider.provenance
  });
}

/* ── Phase 1: stratify every child bank's own 11 slots — code only, zero network. ──── */
for (const gid of children) {
  const g = shadingGroup(gid, rosters);
  const knobs = bankKnobs(gid, rosters);
  if (!knobs.length) {
    banksOut[gid] = {presets:{}};
    childLooks[gid] = {};
    bankReport.push({bank:gid, label:g.label, knobs:0, coverage:[], minPairwiseDistance:null, duplicates:[]});
    continue;
  }
  const {looks, coverage, minPairwiseDistance, duplicates} =
    stratifiedBankSlots(gid, rosters, SEED, SLOTS, OVERSAMPLE);
  childLooks[gid] = Object.fromEntries(looks.map((l, i) => [String(i+1), l]));
  const names = disambiguateLabels(looks); // UNIQUE per bank — never the raw (possibly-colliding) l.label
  banksOut[gid] = {presets: Object.fromEntries(looks.map((l, i) => [
    String(i+1), {name: names[i], values:{params:l.params, bindings:{receivers:[],senders:[]}}}
  ]))};
  bankReport.push({bank:gid, label:g.label, knobs:knobs.length, coverage, minPairwiseDistance, duplicates,
    exclusions: bankExclusions(gid, rosters).length});
}

/* ── Phase 1b: surface's OWN ~12 knobs — also stratified, one set per look directly (no
 *  partition needed: these are not reused across looks the way a child slot is). ────── */
const surfaceGroup = shadingGroup('surface', rosters);
const surfaceOwnKnobs = bankKnobs('surface', rosters);
const surfaceOwn = stratifiedBankSlots('surface', rosters, SEED, SLOTS, OVERSAMPLE);
bankReport.push({bank:'surface', label:surfaceGroup.label, knobs:surfaceOwnKnobs.length,
  coverage:surfaceOwn.coverage, minPairwiseDistance:surfaceOwn.minPairwiseDistance,
  duplicates:surfaceOwn.duplicates, exclusions: bankExclusions('surface', rosters).length});

/* ── HARD GATE (operator, 2026-09-20 13:59): refuse to deliver if any COVERABLE menu row
 *  (option count ≤ 11) is missing an option anywhere in the delivered set. The same check
 *  runs as a pure test (`tests/shading-coverage.test.ts`) with no network involved. ───── */
function assertFullCoverage(report) {
  const bad = [];
  for (const r of report) for (const c of r.coverage)
    if (c.coverable && c.missing.length) bad.push(`${r.bank}.${c.name}: missing ${JSON.stringify(c.missing)} of ${c.total}`);
  if (bad.length) throw new Error('coverage gate failed — refusing to deliver:\n  ' + bad.join('\n  '));
}
assertFullCoverage(bankReport);

/* ── Phase 2: the 11 surface looks — distinct coordinates, per-child partitioned picks,
 *  constraining-first order, light-rig variety + type-uniqueness, constraint filtering. ── */
const coords = spreadShadingCoordinates(SLOTS, SEED);
const state = newPartitionState(children);
const presets = {};
const surfaceLightSummary = [];

function bankLabelOf(gid) { return shadingGroup(gid, rosters).label; }

/** ONE child pick for ONE look — forced when the menu is a singleton, constraint-filtered
 *  otherwise (falling back to the unfiltered menu if filtering would empty it — a filter
 *  that deadlocks the run is a worse failure than an unfiltered offer), and further
 *  light-type-filtered via `extraExclude`. */
async function pickOneChild(surfaceSlot, coordinate, gid, chosenSoFar, extraExclude) {
  const avail = availableSlots(state, gid, ALL_SLOTS);
  if (!avail.length) throw new Error(`surface slot ${surfaceSlot}: bank "${gid}" has no slots left`);

  // A group with NO LIVE ROW at all under what's already chosen (e.g. materialType=matcap
  // darkens sub:light2/sub:light3 entirely, `darkGroups`) — every remaining slot is equally
  // inert, so skip Laya and force-pick rather than offer a dead choice.
  if (constraintsPresent && isDarkened(constraints,
      chosenSoFar.map(c => ({gid:c.gid, params:c.look.params})), gid)) {
    const chosenSlot = avail[0];
    notAskedLog.push({surfaceSlot, bank:gid, slot:chosenSlot,
      reason:'group darkened (no live row) by an already-chosen material/lighting option'});
    commitPick(state, gid, chosenSlot, avail);
    return chosenSlot;
  }

  let menu = avail;
  if (constraintsPresent) {
    const filtered = menu.filter(s => !violatesConstraint(constraints,
      chosenSoFar.map(c => ({gid:c.gid, params:c.look.params})), gid, childLooks[gid][String(s)].params));
    if (filtered.length) {
      if (filtered.length < menu.length) constraintRemovals.push({surfaceSlot, bank:gid,
        removedSlots: menu.filter(s => !filtered.includes(s))});
      menu = filtered;
    }
  }
  if (extraExclude) {
    const filtered = menu.filter(s => !extraExclude(childLooks[gid][String(s)].params));
    if (filtered.length) menu = filtered;
  }
  let chosenSlot;
  if (menu.length <= 1) {
    chosenSlot = menu[0] ?? avail[0];
    notAskedLog.push({surfaceSlot, bank:gid, slot:chosenSlot, reason: avail.length === 1
      ? 'only one unused slot remained' : 'constraint/type filtering left exactly one option'});
  } else {
    const options = menu.map(s => ({slot:s, look:childLooks[gid][String(s)]}));
    const request = buildChildPickRequest(model, coordinate,
      [{gid, label:bankLabelOf(gid), slots:options}],
      chosenSoFar.map(c => ({gid:c.gid, label:bankLabelOf(c.gid), description:c.look.description})));
    const {answers, receipt} = await decide(request);
    const qid = childPickQuestionId(gid);
    const ans = answers[qid];
    const sel = selectChoice(ans, {mode:'model'});
    chosenSlot = Number(sel.selected);
    recordReceipt(gid, surfaceSlot, qid, request, options, ans, sel, receipt);
  }
  commitPick(state, gid, chosenSlot, avail);
  return chosenSlot;
}

const usedSurfaceLabels = new Set();
for (let slotIdx = 1; slotIdx <= SLOTS; slotIdx++) {
  const coordinate = coords[slotIdx - 1];
  // Surface's own knobs for THIS look (already stratified, no partition/pick) seed
  // `chosenSoFar` first — a constraint row naming group:'surface' (e.g. `lightingEnable`)
  // must resolve against what this look already carries, not just the child picks.
  const chosenSoFar = [{gid:'surface', look:surfaceOwn.looks[slotIdx-1]}];
  const vector = {};
  const lightTypeByN = {}; // {1:type,2:type,3:type} for lights ON in this look

  for (const gid of askOrder) {
    let extraExclude = null;

    if (gid === 'sub:light1' || gid === 'sub:light2' || gid === 'sub:light3') {
      const n = Number(gid.slice(-1));
      const lightingLook = chosenSoFar.find(c => c.gid === 'sub:lighting')?.look;
      const enabled = lightingLook ? !!lightingLook.params[`light${n}Enabled`] : true;
      if (enabled) {
        const usedTypes = Object.values(lightTypeByN);
        if (usedTypes.length)
          extraExclude = (params) => usedTypes.includes(params[`light${n}Type`]);
      }
    }

    const slot = await pickOneChild(slotIdx, coordinate, gid, chosenSoFar, extraExclude);
    const look = childLooks[gid][String(slot)];
    chosenSoFar.push({gid, look});
    vector[gid] = String(slot);

    if (gid === 'sub:light1' || gid === 'sub:light2' || gid === 'sub:light3') {
      const n = Number(gid.slice(-1));
      const lightingLook = chosenSoFar.find(c => c.gid === 'sub:lighting')?.look;
      const enabled = lightingLook ? !!lightingLook.params[`light${n}Enabled`] : true;
      if (enabled) lightTypeByN[n] = look.params[`light${n}Type`];
    }
  }

  const params = {...surfaceOwn.looks[slotIdx-1].params};
  for (const {gid, look} of chosenSoFar) Object.assign(params, look.params);
  const surfaceLabel = coordinateLabel(coordinate, usedSurfaceLabels);
  usedSurfaceLabels.add(surfaceLabel);
  presets[slotIdx] = {
    name: surfaceLabel,
    values:{params, bindings:{receivers:[],senders:[]}, childSlots:vector},
    _coordinate: coordinate, _coordinateLine: coordinateLine(coordinate)
  };

  const lightingLook = chosenSoFar.find(c => c.gid === 'sub:lighting')?.look;
  const lightsOn = [1,2,3].filter(n => lightingLook && lightingLook.params[`light${n}Enabled`]);
  surfaceLightSummary.push({
    slot:slotIdx, lightsOnCount: lightsOn.length,
    lights: lightsOn.map(n => ({n, type: lightTypeByN[n], slot: vector[`sub:light${n}`]}))
  });
}

// ── partition invariant: every child bank's used set is exactly {1..11} ─────────────
const partitionCheck = children.map(gid => {
  const used = [...state.used[gid]].sort((a,b) => a-b);
  const ok = used.length === SLOTS && used.every((v,i) => v === i+1);
  return {bank:gid, used, ok};
});
if (partitionCheck.some(p => !p.ok))
  throw new Error('partition invariant violated: ' + JSON.stringify(partitionCheck.filter(p=>!p.ok)));

banksOut.surface = {presets: Object.fromEntries(Object.entries(presets).map(([slot, p]) => [
  slot, {name:p.name, values:p.values}
]))};

const outDir = arg('out', join(cfg.dataDir));
mkdirSync(outDir, {recursive:true});
const ts = new Date().toISOString().replace(/[:.]/g,'-');
const outPath = join(outDir, `shading-compose-${ts}.json`);

const surfaceSummary = Object.entries(presets).map(([slot, p]) => ({
  slot, label:p.name, coordinate:p._coordinateLine, childSlots:p.values.childSlots,
  lighting: surfaceLightSummary.find(s => String(s.slot) === slot)
}));

// per-bank enum coverage table, flattened for the return brief
const coverageTable = bankReport.map(r => ({
  bank:r.bank, rows:r.coverage.map(c => ({row:c.name, used:c.used, total:c.total, coverable:c.coverable}))
}));

const artifact = {
  run:'compose:shading',
  provider:{id:provider.id, modelId:provider.modelId, providerClass:provider.providerClass},
  respondedModel: receipts[0]?.model ?? null,
  rosterProvenance: rosters.provenance,
  seed: SEED, oversample: OVERSAMPLE,
  constraintsPresent, constraintsCount: constraints.length, constraintRemovals,
  calls: callCount, receipts: receipts.length,
  bankReport, coverageTable, notAsked: notAskedLog, partitionCheck,
  surfaceSummary,
  banksUnitSha256: hashJSON(banksOut),
  banks: banksOut
};
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
writeFileSync(join(outDir, 'shading-compose-latest.json'), JSON.stringify(artifact, null, 2));

console.log(JSON.stringify({
  run:'compose:shading', out:outPath,
  provider: artifact.provider, respondedModel: artifact.respondedModel,
  constraintsPresent, calls: callCount, receipts: receipts.length,
  partitionOk: partitionCheck.every(p => p.ok),
  coverageTable,
  surfaceSummary,
  banksUnitSha256: artifact.banksUnitSha256
}, null, 2));

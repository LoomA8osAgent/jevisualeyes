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
 *   2b. VISIBILITY — THE RENDER GATE (decision-models.md §P2.10.6, added 2026-09-20 after
 *      the operator's "only TWO render on the object, everything else is black"). Spread,
 *      partition and the constraint export are all statements about the STATE; none of
 *      them is a statement about the PICTURE, and a look whose shading opacity sampled to
 *      0.27 with dim lamps is black by arithmetic with every enum in it legal. So every
 *      candidate is RENDERED headless on the resolver-picked subject (the A8os tool
 *      `app/tools/render-shading-look.js`, driven through `core/render-gate.ts`) and an
 *      invisible one is dropped from the POOL before stratification and from the MENU
 *      before Laya is asked — validity as the generator's property, per COMPOSER §1.
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
 *           --no-render-gate   run WITHOUT the eye (a pure-code run; every artifact says
 *                              `renderGate.present:false` so it can never be mistaken for
 *                              a gated one — GATE-FAILS-OPEN)
 *           --render-port <n>  the isolated dev-server port the gate renders on (never 8080)
 *           --look-retries <n=3>  re-assemblies allowed when a COMPLETED look renders black
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig, effectiveProvider, effectiveKey} from '../server/config.js';
import {providerFor} from '../server/provider.js';
import {loadRosters} from '../core/rosters.js';
import {shadingBankIds, shadingChildren, bankKnobs, bankExclusions, shadingGroup} from '../core/shading.js';
import {stratifiedBankSlots, disambiguateLabels, spreadShadingCoordinates, coordinateLabel, coordinateLine,
  newPartitionState, availableSlots, forcedSlot, commitPick, violatesConstraint, isDarkened,
  menuRows} from '../core/shading-samplers.js';
import {buildChildPickRequest, childPickQuestionId} from '../core/shading-requests.js';
import {validateResponse} from '../core/validate.js';
import {selectChoice} from '../core/selection.js';
import {hashJSON} from '../core/hash.js';
import {RenderGate, knobRejectionTable} from '../core/render-gate.js';

const argv = process.argv.slice(2);
const arg = (n,d) => { const i = argv.indexOf('--'+n); return i>=0 ? argv[i+1] : d; };
const SLOTS = 11;
const ALL_SLOTS = Array.from({length:SLOTS}, (_,i) => i+1);
const SEED = parseInt(arg('seed','7331'),10) >>> 0;
const OVERSAMPLE = parseInt(arg('oversample','500'),10);
const RENDER_PORT = parseInt(arg('render-port','8097'),10);
// Re-assemblies allowed per BASE before the look tries a different surface-own base.
// The ban cycles the CONSTRAINING-FIRST order, so the first retry bans the light rig's
// slot rather than the edge layer's. (The first cut banned the LAST bank asked — always
// a low-impact one like sub:edge — and three retries changed nothing that could make
// light. Measured: look 9 stayed black through three tries.)
const LOOK_RETRIES = parseInt(arg('look-retries','2'),10);
const NO_GATE = argv.includes('--no-render-gate');
const BANK_ROUNDS = 4;   // stratify -> render -> exclude the black -> restratify

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

/* ── THE EYE ────────────────────────────────────────────────────────────────────────
 *  Opened ONCE for the whole run, so every verdict in it is measured against ONE
 *  subject and ONE default render — a threshold that moved mid-run would make two
 *  rejections in the same artifact incomparable. */
const gate = NO_GATE ? RenderGate.off()
  : await RenderGate.open(cfg.appRoot, {port: RENDER_PORT});
if (gate.present) {
  console.error(`render gate: subject ${gate.subject.label} (${gate.subject.file})`);
  console.error(`render gate: default avgLuma ${gate.defaultMetrics.avgLuma} darkFrac ${gate.defaultMetrics.darkFrac}`);
  console.error(`render gate: visible iff darkFrac<=${gate.thresholds.darkCeil} && nonDark>=${gate.thresholds.coverFloor} && avgLuma>=${gate.thresholds.lumaFloor}`);
} else {
  console.error('render gate: OFF (--no-render-gate) — nothing in this run was seen');
}
const gateRejections = [];   // {stage, bank, slot|id, reason, avgLuma, darkFrac}

let callCount = 0;
const receipts = [];
const banksOut = {};
const childLooks = {};     // gid -> {slot(string) -> ShadingLook}
const bankReport = [];     // per-bank stratification evidence
const notAskedLog = [];
const constraintRemovals = []; // {surfaceSlot, bank, removedSlots:[...]}
const renderRemovals = [];     // {surfaceSlot, bank, removedSlots:[...]} — dropped by the EYE
const renderDeadEnds = [];     // a menu the eye emptied; reported by name, never silently black
const lookRetries = [];        // {surfaceSlot, attempt, reason, bannedBank, bannedSlot}
const blackLookParams = {};    // gid -> [params of every candidate the eye rejected]

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

/* ── Phase 1 + 1b: stratify every bank's own 11 slots, with the eye on the pool. ─────
 *
 *  THE CONTEXT A CANDIDATE IS JUDGED IN IS THE POINT, and the first cut got it wrong.
 *  Judging a candidate OVER THE RECORD'S DEFAULTS asks "is this slot visible next to a
 *  bright default look" — and a default look supplies lit material, a full palette and
 *  a live lamp rig, so almost nothing fails. But by surface look 11 the partition has
 *  FORCED every child bank to its last remaining slot and the surface base to its last
 *  remaining set: the union is fully determined and nothing can be swapped. Measured:
 *  looks 1-10 composed and look 11 was black with no freedom left anywhere.
 *
 *  Pass 1 judges over the record's defaults and removes the outright-dead candidates —
 *  15 of 186 on the first run, cheap and uncontroversial.
 *
 *  ⚠ A SECOND PASS IN A MEASURED WORST-CASE UNION WAS BUILT AND IS OFF BY DEFAULT
 *  (`--stress-pass`), because it was MEASURED TO MAKE THINGS WORSE, and that measurement
 *  is worth more than the idea. Judging each candidate against the DIMMEST surviving slot
 *  of every other bank simultaneously rejected 986 of 1896 candidates: the pools ran dry,
 *  banks started shipping black candidates for want of any alternative, and assembly
 *  failed EARLIER (look 8 rather than look 11). The compounding of eleven independently
 *  dim layers is a worse case than the partition can actually force, so the check was
 *  answering a harder question than the one that matters.
 *
 *  THE UNION IS INSTEAD JUDGED WHERE IT IS REAL — at the menu, in `pickOneChild`, against
 *  what THIS look has already chosen. That is the same check in the context that exists. */
const surfaceGroup = shadingGroup('surface', rosters);
const surfaceOwnKnobs = bankKnobs('surface', rosters);

async function stratifyAll(stress, passLabel) {
  const out = {childLooks:{}, banksOut:{}, bankReport:[], surfaceOwn:null, dim:{}};
  const allGids = [...children, 'surface'];
  for (const gid of allGids) {
    const isSurface = gid === 'surface';
    const g = isSurface ? surfaceGroup : shadingGroup(gid, rosters);
    const knobs = isSurface ? surfaceOwnKnobs : bankKnobs(gid, rosters);
    if (!knobs.length) {
      out.banksOut[gid] = {presets:{}};
      out.childLooks[gid] = {};
      out.bankReport.push({bank:gid, label:g.label, knobs:0, coverage:[], minPairwiseDistance:null, duplicates:[]});
      continue;
    }
    // The stress context a candidate of THIS bank is judged in never contains this
    // bank's own contribution — it would simply be overwritten, and the check would
    // silently become a check of the stress slot instead of the candidate.
    const ctx = {};
    for (const [og, params] of Object.entries(stress)) if (og !== gid) Object.assign(ctx, params);

    const blackSigs = new Set();
    let looks, coverage, minPairwiseDistance, duplicates;
    const luma = {};
    for (let round = 1; round <= BANK_ROUNDS; round++) {
      ({looks, coverage, minPairwiseDistance, duplicates} =
        stratifiedBankSlots(gid, rosters, SEED, SLOTS, OVERSAMPLE,
          {exclude: (l) => blackSigs.has(hashJSON({params:l.params}))}));
      if (!gate.present) break;
      let found = 0;
      for (let i = 0; i < looks.length; i++) {
        const sig = hashJSON({params:looks[i].params});
        if (blackSigs.has(sig)) continue;
        const v = await gate.check(`bank:${gid}:${i+1}:${passLabel}r${round}`, {...ctx, ...looks[i].params});
        if (v.visible) { luma[i] = v.metrics ? v.metrics.avgLuma : null; continue; }
        blackSigs.add(sig); found++;
        (blackLookParams[gid] = blackLookParams[gid] || []).push(looks[i].params);
        gateRejections.push({stage:'bank', pass:passLabel, bank:gid, slot:i+1, round, reason:v.reason,
          avgLuma:v.metrics?.avgLuma ?? null, darkFrac:v.metrics?.darkFrac ?? null});
      }
      if (!found) break;
      if (round === BANK_ROUNDS)
        console.error(`render gate: bank ${gid} still offered black candidates after ${BANK_ROUNDS} rounds (${passLabel}) — the survivors ship and every rejection is in the artifact`);
    }
    // the DIMMEST survivor — this bank's contribution to the next pass's stress context
    let dimIdx = 0, dimVal = Infinity;
    for (const [i, l] of Object.entries(luma)) if (l !== null && l < dimVal) { dimVal = l; dimIdx = Number(i); }
    out.dim[gid] = looks[dimIdx] ? looks[dimIdx].params : {};

    const names = disambiguateLabels(looks);   // UNIQUE per bank — never the raw label
    out.childLooks[gid] = Object.fromEntries(looks.map((l, i) => [String(i+1), l]));
    out.banksOut[gid] = {presets: Object.fromEntries(looks.map((l, i) => [
      String(i+1), {name: names[i], values:{params:l.params, bindings:{receivers:[],senders:[]}}}
    ]))};
    out.bankReport.push({bank:gid, label:g.label, knobs:knobs.length, coverage, minPairwiseDistance,
      duplicates, exclusions: bankExclusions(gid, rosters).length, renderRejected: blackSigs.size,
      pass: passLabel});
    if (isSurface) out.surfaceOwn = {looks, coverage, minPairwiseDistance, duplicates};
  }
  return out;
}

let pass = await stratifyAll({}, 'p1');
if (gate.present && argv.includes('--stress-pass')) {
  console.error('render gate: pass 1 done (' + gate.rejected + '/' + gate.requests +
    ' rejected) — --stress-pass: re-judging every candidate in the measured worst-case union');
  pass = await stratifyAll(pass.dim, 'p2');
}
for (const gid of children) { childLooks[gid] = pass.childLooks[gid]; banksOut[gid] = pass.banksOut[gid]; }
const surfaceOwn = pass.surfaceOwn;
bankReport.push(...pass.bankReport);

/* ── HARD GATE (operator, 2026-09-20 13:59): refuse to deliver if any COVERABLE menu row
 *  (option count ≤ 11) is missing an option anywhere in the delivered set. The same check
 *  runs as a pure test (`tests/shading-coverage.test.ts`) with no network involved. ───── */
//  ⚠ WHEN THE TWO GATES DISAGREE, SAY WHICH OPTION AND WHY (brief §3, 2026-09-20). The
//  eye can make an option UNREACHABLE — if every candidate carrying `materialType = 4`
//  rendered black, coverage cannot be met without shipping a black slot, and those are
//  the only two choices there are. The run still REFUSES, but it refuses BY NAME: the
//  missing option, and how many of its candidates the eye rejected. An unreachable option
//  is a finding about the shader or the sampler's range, never a licence to deliver black.
function assertFullCoverage(report) {
  const bad = [];
  for (const r of report) for (const c of r.coverage) {
    if (!c.coverable || !c.missing.length) continue;
    const rejected = blackLookParams[r.bank] || [];
    const notes = c.missing.map(opt => {
      const n = rejected.filter(p => JSON.stringify(p[c.name]) === JSON.stringify(opt)).length;
      return n ? `${JSON.stringify(opt)} (the render gate rejected ${n} candidate(s) carrying it — it may be UNREACHABLE, not merely unsampled)`
               : `${JSON.stringify(opt)}`;
    });
    bad.push(`${r.bank}.${c.name}: missing ${notes.join(', ')} of ${c.total}`);
  }
  if (bad.length) throw new Error('coverage gate failed — refusing to deliver:\n  ' + bad.join('\n  '));
}
assertFullCoverage(bankReport.filter(r => r.bank !== 'surface'));

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
async function pickOneChild(surfaceSlot, coordinate, gid, chosenSoFar, extraExclude, banned) {
  let avail = availableSlots(state, gid, ALL_SLOTS);
  if (banned && banned.size) {
    const kept = avail.filter(s => !banned.has(s));
    if (kept.length) avail = kept;   // a ban that empties the menu is dropped, never deadlocked
  }
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

  // ── THE EYE, AT THE MENU (decision-models.md §P2.10.6) ───────────────────────────
  // Each remaining slot is rendered AS THIS LOOK WOULD CARRY IT — the union of what the
  // look has already chosen plus this candidate — so the verdict is about the look and
  // not about the bank in isolation (a palette at opacity 0.01 is harmless over a lit
  // default and fatal over a look whose lamps are already down). An invisible candidate
  // is removed BEFORE Laya sees the menu: it is never a choice, which is what "validity
  // is the generator's property" means. A filter that would empty the menu is dropped —
  // a deadlocked run is a worse failure than an unfiltered offer, and it is LOGGED.
  if (gate.present && menu.length) {
    const base = {}; for (const c of chosenSoFar) Object.assign(base, c.look.params);
    const lit = [];
    for (const sl of menu) {
      const v = await gate.check(`look:${surfaceSlot}:${gid}:${sl}`,
        {...base, ...childLooks[gid][String(sl)].params});
      if (v.visible) lit.push(sl);
      else gateRejections.push({stage:'menu', surfaceSlot, bank:gid, slot:sl, reason:v.reason,
        avgLuma:v.metrics?.avgLuma ?? null, darkFrac:v.metrics?.darkFrac ?? null});
    }
    if (lit.length) {
      if (lit.length < menu.length) renderRemovals.push({surfaceSlot, bank:gid,
        removedSlots: menu.filter(s => !lit.includes(s))});
      menu = lit;
    } else {
      renderDeadEnds.push({surfaceSlot, bank:gid, offered: menu.slice(),
        note:'every remaining slot rendered black in this look — offering the unfiltered menu rather than deadlocking'});
    }
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
/* THE SURFACE-OWN BASES ARE MATCHED TO LOOKS, NOT INDEXED INTO THEM (2026-09-20).
 *  §P2.10.4 reading A: surface's own eleven knob sets are stratified and are NOT
 *  partitioned against anything — nothing ties base k to look k. But a base carrying
 *  objectOpacity 0.21 with a dark palette is black whatever the ten children do, and
 *  indexing pinned exactly one look onto it with no way out: measured, look 10 stayed
 *  black through ten bank-level re-assemblies because the base, not the children, was
 *  the cause. So each look takes the FIRST REMAINING base that produces a picture, and
 *  each base is still used exactly once — coverage of surface's own menu rows is
 *  preserved by construction, which is why this is a matching and not a resample. */
/*  AND THE BASE POOL CARRIES RESERVES. Eleven bases for eleven looks is zero freedom at
 *  the last look — by then the partition has forced every child bank to its one remaining
 *  slot AND there is exactly one base left, so a black union has no move available. The
 *  pool is therefore stratified THREE DEEP: `stratifiedBankSlots`' first phase is
 *  coverage-greedy, so the coverage-bearing sets come first and are taken first; the rest
 *  are reserves a look may fall back to. ⚠ COVERAGE IS THEN ASSERTED OVER THE BASES
 *  ACTUALLY USED (below), not over the first eleven — using a reserve can cost an option,
 *  and the coverage gate must be told the truth about what shipped. */
const surfaceBaseBlack = new Set((blackLookParams['surface'] || []).map(pp => hashJSON({params:pp})));
const surfaceBasePool = stratifiedBankSlots('surface', rosters, SEED, SLOTS * 3, OVERSAMPLE,
  {exclude: (l) => surfaceBaseBlack.has(hashJSON({params:l.params}))});
const baseRemaining = surfaceBasePool.looks.map((_, i) => i);
const baseAssign = [];         // surface slot -> base index actually used
const baseSkips = [];          // {surfaceSlot, baseIndex, reason} — every base a look refused

for (let slotIdx = 1; slotIdx <= SLOTS; slotIdx++) {
  const coordinate = coords[slotIdx - 1];
  // A BANNED SLOT PER BANK, carried across this look's re-assemblies. The menu-level eye
  // already checks the running union at every step, so a COMPLETED look that still renders
  // black was broken by the LAST bank added — that slot is banned and the look is rebuilt,
  // which is why the retry needs no blame heuristic.
  let bannedByBank = Object.fromEntries(children.map(c => [c, new Set()]));
  let chosenSoFar, vector, params, attempt = 0, lastBank = null;
  let lightTypeByN = {};   // {1:type,2:type,3:type} for lights ON in this look
  let baseCursor = 0;      // index into baseRemaining
  let baseIndex = baseRemaining[0];
  let settled = false;

  for (;;) {
    // ROLLBACK before every attempt — `commitPick` mutates the partition, and a retry
    // that kept the previous attempt's commits would burn slots the bank still owes to
    // the ten other looks (the bijection is the whole no-duplicates guarantee).
    if (vector) for (const g of children) if (vector[g] !== undefined) state.used[g].delete(Number(vector[g]));
    // Surface's own knobs for THIS look (already stratified, no partition/pick) seed
    // `chosenSoFar` first — a constraint row naming group:'surface' (e.g. `lightingEnable`)
    // must resolve against what this look already carries, not just the child picks.
    baseIndex = baseRemaining[baseCursor];
    chosenSoFar = [{gid:'surface', look:surfaceBasePool.looks[baseIndex]}];
    vector = {};
    lightTypeByN = {};

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

      const slot = await pickOneChild(slotIdx, coordinate, gid, chosenSoFar, extraExclude, bannedByBank[gid]);
      const look = childLooks[gid][String(slot)];
      chosenSoFar.push({gid, look});
      vector[gid] = String(slot);
      lastBank = gid;

      if (gid === 'sub:light1' || gid === 'sub:light2' || gid === 'sub:light3') {
        const n = Number(gid.slice(-1));
        const lightingLook = chosenSoFar.find(c => c.gid === 'sub:lighting')?.look;
        const enabled = lightingLook ? !!lightingLook.params[`light${n}Enabled`] : true;
        if (enabled) lightTypeByN[n] = look.params[`light${n}Type`];
      }
    }

    params = {...surfaceBasePool.looks[baseIndex].params};
    for (const {gid, look} of chosenSoFar) Object.assign(params, look.params);

    // THE FINAL VERDICT ON THE WHOLE LOOK — what the operator will actually see.
    if (!gate.present) { settled = true; break; }
    const v = await gate.check(`surface:${slotIdx}:b${baseIndex}:a${attempt}`, params);
    if (v.visible) { settled = true; break; }
    // WHICH SLOT TO BAN. Not the last one asked — that is whichever bank happens to sit
    // at the end of askOrder (sub:edge), and banning it cannot change whether the object
    // is lit. The ban walks the CONSTRAINING-FIRST order instead (lighting, material, the
    // three lamps, then the rest), which is the same order the picks were made in and the
    // same order in which a look's darkness is actually decided.
    const banBank = askOrder[attempt % askOrder.length];
    attempt++;
    const banSlot = Number(vector[banBank]);
    lookRetries.push({surfaceSlot:slotIdx, attempt, reason:v.reason,
      bannedBank:banBank, bannedSlot:banSlot,
      avgLuma:v.metrics?.avgLuma ?? null, darkFrac:v.metrics?.darkFrac ?? null});
    if (attempt > LOOK_RETRIES) {
      // This BASE cannot be saved by swapping children — move to the next one.
      baseSkips.push({surfaceSlot:slotIdx, baseIndex, reason:v.reason});
      baseCursor++; attempt = 0;
      bannedByBank = Object.fromEntries(children.map(c => [c, new Set()]));
      if (baseCursor >= baseRemaining.length) {
        // NEVER SHIP IT SILENTLY. The run fails here: a black look reaching the bank is
        // exactly the defect this gate exists to end, and a warning is not a gate.
        if (vector) for (const g of children) if (vector[g] !== undefined) state.used[g].delete(Number(vector[g]));
        await gate.close();
        throw new Error(`surface look ${slotIdx}: EVERY remaining surface-own base renders BLACK ` +
          `(${baseRemaining.length} tried, last reason ${v.reason}) — refusing to deliver. ` +
          `Rejections so far: ${gate.rejected}/${gate.requests}.`);
      }
      continue;
    }
    bannedByBank[banBank].add(banSlot);
  }
  if (settled) baseRemaining.splice(baseCursor, 1);
  baseAssign.push({surfaceSlot:slotIdx, baseIndex, triedBases: baseSkips.filter(b => b.surfaceSlot === slotIdx).length + 1});
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

// ── surface-own coverage, over the bases THAT SHIPPED ───────────────────────────────
// Not over the first eleven candidates: a look that fell back to a reserve base changed
// what is in the delivered set, and a coverage claim computed off the pre-assembly
// stratification would be describing a set that was never delivered.
{
  const rows = menuRows('surface', rosters);
  const used = baseAssign.map(b => surfaceBasePool.looks[b.baseIndex]);
  const coverage = rows.map(r => {
    const seen = new Set(used.map(l => l.params[r.name]));
    const missing = r.options.filter(o => !seen.has(o));
    return {name:r.name, label:r.label, total:r.options.length, coverable:r.options.length <= SLOTS,
      used:r.options.length - missing.length, missing};
  });
  const i = bankReport.findIndex(r => r.bank === 'surface');
  const row = {bank:'surface', label:surfaceGroup.label, knobs:surfaceOwnKnobs.length, coverage,
    minPairwiseDistance:surfaceBasePool.minPairwiseDistance, duplicates:surfaceBasePool.duplicates,
    exclusions: bankExclusions('surface', rosters).length,
    renderRejected: surfaceBaseBlack.size, basePoolSize: surfaceBasePool.looks.length,
    basesUsed: baseAssign.map(b => b.baseIndex), note:'coverage measured over the bases that shipped'};
  if (i >= 0) bankReport[i] = row; else bankReport.push(row);
  assertFullCoverage([row]);
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
  // THE EYE'S OWN RECORD. `present:false` is stated rather than implied, so a run that
  // never looked can never be read as a run that looked and found nothing.
  renderGate: {
    present: gate.present,
    tool: 'app/tools/render-shading-look.js --stdio',
    subject: gate.subject, thresholds: gate.thresholds, defaultMetrics: gate.defaultMetrics,
    requests: gate.requests, rejected: gate.rejected,
    rejectionRate: gate.requests ? Math.round((gate.rejected / gate.requests) * 1e4) / 1e4 : 0,
    removals: renderRemovals, deadEnds: renderDeadEnds, lookRetries,
    baseAssign, baseSkips,
    rejections: gateRejections,
    // The hostile RANGES, measured rather than named: every knob split at the midpoint of
    // its own observed span, rejection rate per half, sorted by the gap between them.
    knobRejectionTable: knobRejectionTable(gate.log).filter(r => r.separation !== null && r.separation > 0).slice(0, 40)
  },
  calls: callCount, receipts: receipts.length,
  bankReport, coverageTable, notAsked: notAskedLog, partitionCheck,
  surfaceSummary,
  banksUnitSha256: hashJSON(banksOut),
  banks: banksOut
};
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
writeFileSync(join(outDir, 'shading-compose-latest.json'), JSON.stringify(artifact, null, 2));

await gate.close();

console.log(JSON.stringify({
  run:'compose:shading', out:outPath,
  renderGate: {present: gate.present, requests: gate.requests, rejected: gate.rejected,
    lookRetries: lookRetries.length, deadEnds: renderDeadEnds.length,
    subject: gate.subject ? gate.subject.label : null,
    thresholds: gate.thresholds,
    topHostileKnobs: artifact.renderGate.knobRejectionTable.slice(0, 12)},
  provider: artifact.provider, respondedModel: artifact.respondedModel,
  constraintsPresent, calls: callCount, receipts: receipts.length,
  partitionOk: partitionCheck.every(p => p.ok),
  coverageTable,
  surfaceSummary,
  banksUnitSha256: artifact.banksUnitSha256
}, null, 2));

/** THE SHADING SAMPLER — code enumerates COMPLETE looks per bank; the model only ever
 *  picks an id, exactly as `samplers.ts` does for the record+tag stacks
 *  (`docs/COMPOSER.md` §1). This file is the bank-shaped twin: a "look" here is one complete
 *  draw of ONE bank's knobs (`shading.ts bankKnobs`), not one stack of one record.
 *
 *  DISTINCT LOOKS ARE ENFORCED IN CODE, NOT BY RE-ASKING (operator ruling, §P2.10 handoff:
 *  "enforce a minimum distance in code (sampler-side diversity), not by re-asking"):
 *  `bankDistance` measures how different two chosen slots are and `diverseEnough` gates
 *  acceptance; the caller (the compose script) redraws a fresh candidate pool on a rejection
 *  rather than asking the model a second time over the SAME pool.
 *
 *  DETERMINISM mirrors `samplers.ts`: every draw runs off `selection.ts`'s xorshift32, seeded
 *  from `hash.ts` over the canonical JSON of (bank, slot, attempt, seed).
 */
import {hashJSON} from './hash.js';
import {nextRandom} from './selection.js';
import type {JsonValue} from './types.js';
import type {Rosters, ShadingInput} from './rosters.js';
import {bankKnobs} from './shading.js';
import {AXES, AXIS_POSITION} from './axes.js';

export interface ShadingLook {
  id:string;
  /** the full sentence a Choice question shows the model — effect names included. */
  description:string;
  /** a SHORT, state-only label ("phong", "off") for a preset-bank slot name — the SINGLE
   *  strongest mover only, never a joined list: a joined list truncates mid-item and leaves
   *  a dangling separator ("color layer: off," measured, audit item 2), and a bank's slots
   *  already differ on their own knobs, so one word is enough to tell them apart. THIS ALONE
   *  IS NOT GUARANTEED UNIQUE within a bank (two slots can share the same strongest mover,
   *  e.g. both landing "base color: set") — `disambiguateLabels` is the uniqueness pass. */
  label:string;
  /** up to 3 knob-LABEL-prefixed state words, strongest mover first — the same data
   *  `label` was built from, kept so a collision can be resolved by adding the NEXT
   *  strongest word instead of re-deriving anything. */
  topWords:string[];
  params:Record<string,JsonValue>;
}

/** ≤24 chars, human-readable, no trailing separator — the ONE place a label is truncated,
 *  so `sampleBankLook`'s single-mover label and a surface look's coordinate-derived label
 *  (`coordinateLabel`, below) are cut the same way. */
export function cleanLabel(s:string, max = 24):string {
  const t = s.replace(/\s+/g,' ').trim();
  const cut = t.length <= max ? t : (() => {
    const c = t.slice(0, max);
    const sp = c.lastIndexOf(' ');
    return (sp > 8 ? c.slice(0, sp) : c).trim();
  })();
  return cut.replace(/[:,;.\-–—\s]+$/,'').trim() || 'look';
}

const seedFrom = (v:unknown):number => parseInt(hashJSON(v).slice(0,8),16) >>> 0;
function rngFrom(seed:number) {
  let s = seed >>> 0;
  return () => { const r = nextRandom(s); s = r.seed; return r.value; };
}
const round4 = (v:number) => Math.round(v * 1e4) / 1e4;

/* ── ONE value, by the roster's own TYPE (`shared.shading` carries float/long/bool/color;
 *  long+VALUES is an enum — the same "VALUES list IS the candidate space" rule I5 already
 *  established for the record+tag samplers, `samplers.ts fromRoster`). ─────────────────── */
function drawValue(input:ShadingInput, rnd:()=>number):JsonValue {
  if (input.TYPE === 'bool') return rnd() < 0.5;
  if (input.TYPE === 'color') {
    const def = Array.isArray(input.DEFAULT) ? (input.DEFAULT as unknown[]) : [1,1,1,1];
    const a = typeof def[3] === 'number' ? (def[3] as number) : 1;
    return [round4(rnd()), round4(rnd()), round4(rnd()), a] as JsonValue;
  }
  if (Array.isArray(input.VALUES) && input.VALUES.length) {
    const vs = input.VALUES as number[];
    return vs[Math.min(vs.length - 1, Math.floor(rnd() * vs.length))];
  }
  const lo = typeof input.MIN === 'number' ? input.MIN : 0;
  const hi = typeof input.MAX === 'number' ? input.MAX : 1;
  if (hi <= lo) return typeof input.DEFAULT === 'number' ? input.DEFAULT : lo;
  return round4(lo + rnd() * (hi - lo));
}

const headOf = (s:string) => {
  const i = s.indexOf(' — ');
  const head = i > 0 ? s.slice(0, i) : s;
  const j = head.indexOf(';');
  return (j > 0 ? head.slice(0, j) : head).trim().replace(/[.;]$/, '');
};
const endsOf = (s:string):string[] => {
  const i = s.indexOf(' — ');
  return i > 0 ? s.slice(i + 3).split(',').map(x => x.trim()).filter(Boolean) : [];
};
const clamp01 = (v:number) => v < 0 ? 0 : v > 1 ? 1 : v;
const positionWord = (t:number) => t < 0.34 ? 'low' : t > 0.66 ? 'high' : 'mid';

/** The STATE token a draw landed on, with no effect-name prefix — "on"/"off", an enum's own
 *  LABEL, the author's own end-word, or a low/mid/high fallback. Shared by both the full
 *  sentence (`describeDraw`, effect-name prefixed) and the short slot label (`stateWord`,
 *  knob-LABEL prefixed) so the two never disagree about what a draw actually did. */
function stateOf(k:ShadingInput, v:JsonValue):string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return 'set';
  if (Array.isArray(k.VALUES) && k.VALUES.length) {
    const idx = (k.VALUES as number[]).indexOf(v as number);
    const label = idx >= 0 && Array.isArray(k.LABELS) ? k.LABELS[idx] : undefined;
    return typeof label === 'string' ? label : String(v);
  }
  const lo = typeof k.MIN === 'number' ? k.MIN : 0, hi = typeof k.MAX === 'number' ? k.MAX : 1;
  const t = hi > lo && typeof v === 'number' ? clamp01((v - lo) / (hi - lo)) : 0.5;
  const ends = endsOf(k.DESCRIPTION ?? '');
  const end = t < 0.34 ? ends[0] : t > 0.66 ? ends[ends.length - 1] : null;
  return end ?? positionWord(t);
}

/** ONE knob's contribution to a look's readable Choice-question line — names the STATE the
 *  draw landed on, never just the effect it controls (a look whose line reads the same for
 *  every slot is a look nobody can tell apart, which is exactly the flat-description bug
 *  this fixes). Effect-name prefixed, so the model reads WHAT changed and to WHAT. */
function describeDraw(k:ShadingInput, v:JsonValue):string {
  return `${headOf(k.DESCRIPTION ?? k.LABEL)}: ${stateOf(k, v)}`;
}

/** The same draw, as a SHORT slot label — the knob's own (short) LABEL rather than its full
 *  effect sentence, so the state word survives a 24-char truncation instead of being
 *  swallowed by a long effect-name prefix. */
function stateWord(k:ShadingInput, v:JsonValue):string {
  return `${k.LABEL}: ${stateOf(k, v)}`;
}

/** One complete draw of ONE bank's knobs. `attempt` folds into the seed so a diversity
 *  rejection can redraw a fresh pool without touching any other slot's determinism. */
export function sampleBankLook(gid:string, slot:number, attempt:number, seed:number,
                               rosters:Rosters):ShadingLook {
  const knobs = bankKnobs(gid, rosters);
  const base = seedFrom({gid, slot, attempt, seed: seed >>> 0});
  const rnd = rngFrom(base);
  const params:Record<string,JsonValue> = {};
  const moved:{k:ShadingInput; v:JsonValue; weight:number}[] = [];
  for (const k of knobs) {
    const v = drawValue(k, rnd);
    params[k.NAME] = v;
    if (v === k.DEFAULT) continue;
    // weight = how far the draw moved from default, normalized so a bool flip and a
    // ranged-knob swing are comparable — the strongest movers lead the line, same rule
    // `samplers.ts lineFor` uses for the record+tag stacks.
    let weight = 1;
    if (typeof v === 'number' && typeof k.MIN === 'number' && typeof k.MAX === 'number' && k.MAX > k.MIN)
      weight = Math.abs(v - (typeof k.DEFAULT === 'number' ? k.DEFAULT : k.MIN)) / (k.MAX - k.MIN);
    moved.push({k, v, weight});
  }
  moved.sort((a,b) => b.weight - a.weight);
  const top = moved.slice(0, 3);
  const short = hashJSON({params}).slice(0,8);
  const description = top.length
    ? top.map(({k,v}) => describeDraw(k, v)).join('; ')
    : `${gid} — held at the record's defaults`;
  const topWords = top.map(({k,v}) => stateWord(k, v));
  const label = topWords.length ? cleanLabel(topWords[0]) : 'defaults';
  return {id:`${gid.replace(/[^a-z0-9]/gi,'_')}_s${slot}_a${attempt}_${short}`, description, label, topWords, params};
}

/** Resolve a bank's 11 (or fewer) `ShadingLook`s to UNIQUE preset names, in order: try the
 *  single strongest mover first (`label`), then the two strongest joined, then three,
 *  falling back to an explicit "#N" suffix on the rare case even three still collide (a
 *  bank whose own state space is small enough to force exact-duplicate CONTENT, e.g.
 *  `sub:lighting`, will also force identically-worded top movers no amount of extra words
 *  fixes — the numeral suffix is the honest last resort, never a silent collision). */
export function disambiguateLabels(looks:ShadingLook[]):string[] {
  const used = new Set<string>();
  const out:string[] = [];
  looks.forEach((look, i) => {
    const tries = [
      look.topWords.length ? cleanLabel(look.topWords[0]) : 'defaults',
      look.topWords.length >= 2 ? cleanLabel(look.topWords.slice(0,2).join(', ')) : null,
      look.topWords.length >= 3 ? cleanLabel(look.topWords.slice(0,3).join(', ')) : null,
    ].filter((s):s is string => s !== null);
    let chosen = tries.find(t => !used.has(t));
    if (!chosen) {
      // Reserve room for " #N" BEFORE truncating the base — cleanLabel on the already-built
      // "base #N" string could re-truncate and strip the very suffix meant to disambiguate
      // (measured: `sub:color`/`sub:light1` still collided after this fallback pre-fix).
      const suffix = ` #${i+1}`;
      const base = cleanLabel(tries[tries.length-1] ?? 'look', Math.max(4, 24 - suffix.length));
      chosen = base + suffix;
    }
    used.add(chosen);
    out.push(chosen);
  });
  return out;
}

/* ── spread, measured/guaranteed IN CODE (operator ruling 2026-09-20 13:57, verbatim:
 *  "this is EXACTLY to expose as many DIFFERENT looks as possible so I do not have to
 *  discover them all"): every menu row's every option must appear across a bank's 11 slots
 *  where 11 slots allow it, and the ranged/continuous knobs must spread farthest-point
 *  rather than merely clear a distance FLOOR. This supersedes the earlier "ask Laya 3
 *  candidates, keep the diverse ones, force-accept past a retry cap" design entirely — the
 *  content of a bank's 11 slots is now a CODE-ONLY construction with no network call, and
 *  the model's role narrows to which of these code-guaranteed-diverse slots best fits a
 *  given look's TARGET (`shading-requests.ts buildChildPickRequest`). ───────────────────── */

function normalizedValue(input:ShadingInput, v:JsonValue):number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v)) {
    const nums = v.filter((x):x is number => typeof x === 'number');
    return nums.length ? nums.reduce((a,b)=>a+b,0) / nums.length : 0;
  }
  if (Array.isArray(input.VALUES) && input.VALUES.length) {
    const vs = input.VALUES as number[];
    const idx = vs.indexOf(v as number);
    return vs.length > 1 && idx >= 0 ? idx / (vs.length - 1) : 0;
  }
  const lo = typeof input.MIN === 'number' ? input.MIN : 0;
  const hi = typeof input.MAX === 'number' ? input.MAX : 1;
  return (hi > lo && typeof v === 'number') ? (v - lo) / (hi - lo) : 0;
}

/** Mean absolute normalized difference across a bank's own knobs. 0 = identical looks,
 *  ~1 = maximally different on every knob. */
export function bankDistance(gid:string, a:Record<string,JsonValue>, b:Record<string,JsonValue>,
                             rosters:Rosters):number {
  const knobs = bankKnobs(gid, rosters);
  if (!knobs.length) return 1;
  let sum = 0;
  for (const k of knobs) sum += Math.abs(normalizedValue(k, a[k.NAME]) - normalizedValue(k, b[k.NAME]));
  return sum / knobs.length;
}

/** Every MENU ROW (bool or enum `_menuOnly` knob) a bank offers — read off the live roster,
 *  never assumed (operator, 2026-09-20 13:58/13:59: "every light has multiple modes … do
 *  not assume one"). A bool row's option set is `[false, true]`; an enum row's is its own
 *  `VALUES` verbatim. These are the rows a stratified selection is obligated to COVER. */
export interface MenuRow { name:string; label:string; options:JsonValue[] }
export function menuRows(gid:string, rosters:Rosters):MenuRow[] {
  return bankKnobs(gid, rosters)
    .filter(k => k._menuOnly === true)
    .map(k => ({
      name:k.NAME, label:k.LABEL,
      options: (Array.isArray(k.VALUES) && k.VALUES.length ? k.VALUES.slice() : [false, true]) as JsonValue[]
    }));
}

export interface CoverageRow { name:string; label:string; total:number; used:number;
  coverable:boolean; missing:JsonValue[] }
export interface StratifiedBank {
  looks:ShadingLook[];
  coverage:CoverageRow[];
  minPairwiseDistance:number;
  /** slot index (1-based) → the earlier slot index it duplicates, only when the bank's own
   *  state space is smaller than `slots` (sub:lighting's 3 bools ⇒ 8 states < 11 — "take all
   *  8 and report 3 slots as duplicates by necessity rather than padding", operator ruling). */
   duplicates:{slot:number; duplicateOfSlot:number}[];
}

/** Fill a bank's `slots` (default 11) with CODE-ONLY content: over-sample a candidate pool,
 *  greedily cover every menu row's every option first (tie-broken by farthest-point distance
 *  from what's already chosen), then keep filling by pure farthest-point distance, and only
 *  pad with an exact duplicate of an already-chosen slot when the bank's own state space is
 *  smaller than `slots` (never a forced-accept floor — the whole point is to STOP discovering
 *  duplicates by construction, not to tolerate near-duplicates past a threshold). Zero network
 *  calls — deterministic in (gid, seed), so a vitest test can assert coverage directly. */
export function stratifiedBankSlots(gid:string, rosters:Rosters, seed:number,
                                    slots = 11, oversample = 500):StratifiedBank {
  const rows = menuRows(gid, rosters);
  const pool:ShadingLook[] = [];
  for (let i = 0; i < oversample; i++) pool.push(sampleBankLook(gid, 0, i, seed, rosters));

  const sigOf = (look:ShadingLook) => hashJSON({params:look.params});
  const rowKey = (name:string, v:JsonValue) => `${name}=${JSON.stringify(v)}`;
  const uncovered = new Set<string>();
  for (const r of rows) for (const opt of r.options) uncovered.add(rowKey(r.name, opt));

  const selected:ShadingLook[] = [];
  const selectedSig = new Set<string>();
  const minDistTo = (cand:ShadingLook) => selected.length
    ? Math.min(...selected.map(s => bankDistance(gid, cand.params, s.params, rosters))) : Infinity;
  const coverGain = (cand:ShadingLook) => {
    let n = 0;
    for (const r of rows) if (uncovered.has(rowKey(r.name, cand.params[r.name]))) n++;
    return n;
  };

  // Phase 1 — coverage-greedy: pick the candidate that closes the most still-open (row,
  // option) pairs; ties broken by farthest distance from what's already selected.
  while (selected.length < slots && uncovered.size > 0) {
    let best:ShadingLook|null = null, bestGain = -1, bestDist = -1;
    for (const cand of pool) {
      if (selectedSig.has(sigOf(cand))) continue;
      const gain = coverGain(cand);
      if (gain <= 0) continue;
      const dist = minDistTo(cand);
      if (gain > bestGain || (gain === bestGain && dist > bestDist)) { best = cand; bestGain = gain; bestDist = dist; }
    }
    if (!best) break; // no remaining unique candidate covers anything left — reported below
    selected.push(best); selectedSig.add(sigOf(best));
    for (const r of rows) uncovered.delete(rowKey(r.name, best.params[r.name]));
  }

  // Phase 2 — pure farthest-point fill from remaining UNIQUE candidates.
  while (selected.length < slots) {
    let best:ShadingLook|null = null, bestDist = -1;
    for (const cand of pool) {
      if (selectedSig.has(sigOf(cand))) continue;
      const dist = minDistTo(cand);
      if (dist > bestDist) { best = cand; bestDist = dist; }
    }
    if (!best) break; // the bank's own state space is smaller than `slots` — pad below
    selected.push(best); selectedSig.add(sigOf(best));
  }

  // Phase 3 — the ONLY place a duplicate is introduced, and it is REPORTED, never silent.
  const duplicates:{slot:number; duplicateOfSlot:number}[] = [];
  let cursor = 0;
  while (selected.length < slots) {
    const srcIdx = selected.length ? (cursor % selected.length) : 0;
    duplicates.push({slot: selected.length + 1, duplicateOfSlot: srcIdx + 1});
    selected.push(selected[srcIdx] ?? pool[0]);
    cursor++;
  }

  const coverage:CoverageRow[] = rows.map(r => {
    const used = new Set(selected.map(s => s.params[r.name]));
    const missing = r.options.filter(o => !used.has(o));
    return {name:r.name, label:r.label, total:r.options.length, coverable:r.options.length <= slots,
      used: r.options.length - missing.length, missing};
  });
  let minPD = 1;
  if (selected.length > 1) {
    let m = Infinity;
    for (let i = 0; i < selected.length; i++) for (let j = i+1; j < selected.length; j++)
      m = Math.min(m, bankDistance(gid, selected[i].params, selected[j].params, rosters));
    minPD = m;
  }
  return {looks:selected, coverage, minPairwiseDistance:minPD, duplicates};
}

/* ── the partition: EVERY child slot used in EXACTLY ONE surface look (operator ruling
 *  2026-09-20 13:56: "the whole point of this exercise is to NOT have duplicate looks" —
 *  a child bank's 11 slots must map bijectively onto the 11 surface looks, never the same
 *  slot diagonally repeated across every look). The menu offered for look k is the slots
 *  NOT YET USED by looks 1..k-1; a menu of exactly one remaining slot is FORCED, never
 *  asked (`docs/COMPOSER.md` "a single-option menu is not a decision"). Pure, synchronous,
 *  no network — the compose script drives it with a live Choice call per look, and
 *  `tests/shading-partition.test.ts` drives it with a deterministic stub to prove the
 *  invariant without one. ─────────────────────────────────────────────────────────────── */
export interface ChildPartitionState { used:Record<string, Set<number>> }
export function newPartitionState(children:string[]):ChildPartitionState {
  return {used: Object.fromEntries(children.map(c => [c, new Set<number>()]))};
}
export function availableSlots(state:ChildPartitionState, gid:string, allSlots:number[]):number[] {
  const used = state.used[gid] ?? new Set<number>();
  return allSlots.filter(s => !used.has(s)).sort((a,b) => a - b);
}
export function forcedSlot(available:number[]):number|null {
  return available.length === 1 ? available[0] : null;
}
export function commitPick(state:ChildPartitionState, gid:string, slot:number, available:number[]):void {
  if (!available.includes(slot))
    throw new Error(`commitPick: slot ${slot} was not in the offered menu for "${gid}" (${available.join(',')})`);
  (state.used[gid] ??= new Set<number>()).add(slot);
}

/* ── constraints — read, never transcribed (operator ruling 2026-09-20 14:00). A separate
 *  lane derives incompatible/inert (material, lighting) combinations from the shader and
 *  exports `shared.shading.constraints`; this file only excludes an offer that would
 *  COMPLETE a banned set, given what a look has already committed to. ─────────────────── */
export interface ConstraintEntry {
  rows:{group:string; row:string; option:unknown}[];
  verdict:'incompatible'|'inert';
  darkGroups?:string[];
}

export function violatesConstraint(
  constraints:ConstraintEntry[],
  chosenSoFar:{gid:string; params:Record<string,JsonValue>}[],
  candidateGid:string, candidateParams:Record<string,JsonValue>
):boolean {
  for (const c of constraints) {
    let allMatch = true;
    for (const r of c.rows) {
      const own = r.group === candidateGid ? candidateParams
        : chosenSoFar.find(x => x.gid === r.group)?.params;
      if (!own || JSON.stringify(own[r.row]) !== JSON.stringify(r.option)) { allMatch = false; break; }
    }
    // only a live constraint if the candidate itself is party to it — a rule about two
    // OTHER groups that happen to already match is not this candidate's to enforce.
    if (allMatch && c.rows.some(r => r.group === candidateGid)) return true;
  }
  return false;
}

/** A group with NO LIVE ROW AT ALL under what has already been chosen this look (an entry's
 *  `darkGroups`, e.g. `materialType=matcap` darkens `sub:light2`/`sub:light3` entirely). Every
 *  slot of a darkened group is EQUALLY inert — there is nothing to prefer among them, so the
 *  caller skips asking Laya (a dead look is never offered) and force-picks, rather than
 *  filtering a menu down to a "best" option that does not meaningfully exist. */
export function isDarkened(constraints:ConstraintEntry[],
                           chosenSoFar:{gid:string; params:Record<string,JsonValue>}[],
                           candidateGid:string):boolean {
  for (const c of constraints) {
    if (!c.darkGroups || !c.darkGroups.includes(candidateGid)) continue;
    const allMatch = c.rows.every(r => {
      const own = chosenSoFar.find(x => x.gid === r.group)?.params;
      return own && JSON.stringify(own[r.row]) === JSON.stringify(r.option);
    });
    if (allMatch) return true;
  }
  return false;
}

/* ── DISTINCT AXIS COORDINATES for the eleven `surface` looks (audit item 1) ────────────
 *
 *  The audit's fix: a surface look's childSlots must be a per-child DECISION, not the same
 *  slot number diagonally repeated. Giving Laya eleven genuinely different TARGETS (rather
 *  than the same unconstrained question eleven times) is what makes the eleven decisions
 *  differ by construction — `docs/COMPOSER.md` §6's own reason for coordinates existing at
 *  all, applied one level up from a record's own stacks. The four shading axes
 *  (`decision-models.md` §P2.10.5's `shading:['contrast','warmth','density','depth']`) are
 *  read from `axes.ts AXES`, never a second word list.
 */
const SHADING_AXES = ['contrast','warmth','density','depth'] as const;
export type ShadingCoordinate = Record<typeof SHADING_AXES[number], string>;

function allShadingCombos():ShadingCoordinate[] {
  const words = SHADING_AXES.map(a => AXES[a].options.filter(o => o.id !== 'any').map(o => o.id));
  const out:ShadingCoordinate[] = [];
  for (const c of words[0]) for (const w of words[1]) for (const d of words[2]) for (const p of words[3])
    out.push({contrast:c, warmth:w, density:d, depth:p} as ShadingCoordinate);
  return out;
}

/** `n` DISTINCT coordinates, seeded-shuffled out of the full combo set (81 for four 3-word
 *  axes) so a retry can draw the NEXT unused one rather than guessing at a perturbation. */
export function spreadShadingCoordinates(n:number, seed:number):ShadingCoordinate[] {
  const pool = allShadingCombos();
  let s = seed >>> 0;
  const rnd = () => { const r = nextRandom(s); s = r.seed; return r.value; };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  if (n > pool.length) throw new Error(
    `spreadShadingCoordinates: asked for ${n} distinct coordinates, only ${pool.length} exist`);
  return pool.slice(0, n);
}

export const coordinateLine = (c:ShadingCoordinate):string =>
  SHADING_AXES.map(a => `${a} ${c[a]}`).join(', ');

/** Inverse of `coordinateLine` — parses `"contrast hard, warmth warm, density medium, depth
 *  deep"` back into `{contrast:'hard', warmth:'warm', …}`. Exists so a STORED artifact's
 *  `surfaceSummary[].coordinate` string can be replayed (relabeled) without re-deriving the
 *  coordinate from anything else — never a second source of truth for the four words. */
export function parseCoordinateLine(line:string):ShadingCoordinate {
  const out:Partial<ShadingCoordinate> = {};
  for (const part of line.split(',').map(s => s.trim())) {
    const sp = part.indexOf(' ');
    if (sp < 0) continue;
    const axis = part.slice(0, sp), word = part.slice(sp+1);
    if ((SHADING_AXES as readonly string[]).includes(axis)) (out as Record<string,string>)[axis] = word;
  }
  for (const a of SHADING_AXES) if (!out[a]) throw new Error(`parseCoordinateLine: "${line}" is missing "${a}"`);
  return out as ShadingCoordinate;
}

/** The axis words ranked by how far their position deviates from the coordinate's own
 *  centre (0.5) — strongest first. `coordinateLabel` and its disambiguation both read this
 *  ranking so a collision extends with the NEXT-strongest word rather than a different rule. */
function rankedAxisWords(c:ShadingCoordinate):string[] {
  const withDev = SHADING_AXES.map(a => ({
    word:c[a], dev:Math.abs((AXIS_POSITION[a]?.[c[a]] ?? 0.5) - 0.5)
  }));
  withDev.sort((x,y) => y.dev - x.dev);
  return withDev.map(x => x.word);
}

/** A surface look's label: the TWO axis words whose position deviates most from the
 *  coordinate's own centre (0.5) — "hard, warm" rather than all four at once (unreadable)
 *  or a `moderate`/`neutral`/`medium` middle word (uninformative; deviation ≈ 0 for those).
 *  `avoid`, when given, extends to 3 (then all 4) words on collision — the coordinates
 *  themselves are already guaranteed distinct (`spreadShadingCoordinates`); a same-label
 *  collision only means two coordinates share their two STRONGEST words. */
export function coordinateLabel(c:ShadingCoordinate, avoid?:Set<string>):string {
  const ranked = rankedAxisWords(c);
  if (!avoid) return cleanLabel(ranked.slice(0,2).join(', '));
  for (let n = 2; n <= ranked.length; n++) {
    const candidate = cleanLabel(ranked.slice(0,n).join(', '));
    if (!avoid.has(candidate)) return candidate;
  }
  return cleanLabel(ranked.join(', '));
}

/** Sequentially resolve N coordinates to UNIQUE labels, in order — the same "extend on
 *  collision" rule `coordinateLabel` implements, applied across a whole surface bank. */
export function disambiguateCoordinateLabels(coords:ShadingCoordinate[]):string[] {
  const used = new Set<string>();
  return coords.map(c => { const l = coordinateLabel(c, used); used.add(l); return l; });
}

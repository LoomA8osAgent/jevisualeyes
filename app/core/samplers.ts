/** THE SAMPLERS — code enumerates COMPLETE looks; the model only ever picks an id.
 *
 *  `docs/COMPOSER.md` §7, the SAMPLE step: for each stack the sampler draws N
 *  coherent COMPLETE looks from the accepted coordinate, seeded: a full parameter vector
 *  inside every knob's [MIN, MAX], an op set drawn from the shared rosters, a layer state,
 *  an FX chain. Each candidate gets a stable id and a readable one-line description."
 *
 *  TWO RULES THIS FILE EXISTS TO ENFORCE, both from `docs/COMPOSER.md` §1:
 *
 *   1. **A candidate is valid BY CONSTRUCTION.** Every emitted value is drawn inside the
 *      knob's declared `[MIN, MAX]` and the whole look is re-checked before it is returned
 *      (`assertLookInBounds`). Validity is a property of the SAMPLER, never of the answer —
 *      so no downstream validator, and no model, is ever load-bearing for it.
 *   2. **Never decompose one artifact into independently-sampled parts.** A look is ONE
 *      draw of the whole stack. Twelve individually-plausible knob values are routinely an
 *      incoherent look, which is exactly why CALL 2 is an N-way pick over complete options
 *      rather than N sliders answered separately.
 *
 *  AND THE GATE FROM §8: a knob with no situation sentence is NOT composable — it is
 *  held at its DEFAULT and NAMED in the look's `skipped[]`. The sampler never guesses a
 *  meaning, and it never silently omits the fact that it declined to move something.
 *
 *  DETERMINISM: every draw runs off `selection.ts`'s xorshift32 (`nextRandom`) seeded from
 *  `hash.ts` over the canonical JSON of (record, stack, coordinate, seed, candidate index).
 *  So the same (record, coordinate, seed) triple reproduces byte-identically, which is what
 *  makes a resumed bake's re-run comparable to its first pass.
 */
import {hashJSON} from './hash.js';
import {canonicalJSON, ok} from './canon.js';
import {nextRandom} from './selection.js';
import {AXIS_POSITION, AXIS_SPREAD, ROLE_AXIS, STACK_LABELS, easingFamiliesForMotion} from './axes.js';
import type {AxisCoordinate, JsonValue, LookCandidate, StackId} from './types.js';
import type {Knob, RecordDescriptor} from './records.js';
import {curveShape, loadRosters} from './rosters.js';
import type {Easing, Rosters} from './rosters.js';

/** What a sampler actually walks: the record's own knobs, or a roster's. One shape, so a
 *  stack is a SOURCE of knobs and never a second sampling algorithm. */
export interface StackKnob extends Knob { /** the param key the value is written under. */ key:string }

export interface SampleOptions { n:number; seed:number; rosters?:Rosters; appRoot?:string }

/* ── the seeded draw ────────────────────────────────────────────────────────────── */

const seedFrom = (v:unknown):number => parseInt(hashJSON(v).slice(0,8),16) >>> 0;

function rngFrom(seed:number) {
  let s = seed >>> 0;
  return () => { const r = nextRandom(s); s = r.seed; return r.value; };
}
const round4 = (v:number) => Math.round(v * 1e4) / 1e4;
const clamp01 = (v:number) => v < 0 ? 0 : v > 1 ? 1 : v;

/** Where in [0,1] this knob should land, given the coordinate. `null` ⇒ unconstrained:
 *  draw across the whole range, which is what an `any` axis (or a role the roster does not
 *  place on an axis) actually MEANS. */
function targetFor(knob:Knob, coordinate:AxisCoordinate):number|null {
  if (!knob.role) return null;
  const placed = ROLE_AXIS[knob.role];
  if (!placed) return null;
  const word = coordinate[placed.axis];
  if (!word || word === 'any') return null;
  const pos = AXIS_POSITION[placed.axis]?.[word];
  if (pos === undefined) return null;
  return placed.sense === 1 ? pos : 1 - pos;
}

/** ONE value, always inside [MIN, MAX]. The coordinate biases WHERE in the range. */
function drawValue(knob:StackKnob, coordinate:AxisCoordinate, rnd:()=>number):number {
  const t = targetFor(knob, coordinate);
  const u = rnd();
  const at = t === null ? u : clamp01(t + (u - 0.5) * 2 * AXIS_SPREAD);
  return round4(knob.min + at * (knob.max - knob.min));
}

/* ── the knob sets, per stack, READ from the app ────────────────────────────────── */

const fromRoster = (
  key:string, label:string, min:number|undefined, max:number|undefined,
  def:unknown, description:string|undefined, role:string|null
):StackKnob => {
  const lo = typeof min === 'number' ? min : 0, hi = typeof max === 'number' ? max : 0;
  // A DEFAULT that is itself out of [lo, hi] — an enum knob's numeric index (`materialType`,
  // `light1Type`) declared with no MIN/MAX at all, so lo/hi fall back to the degenerate [0, 0]
  // above — is clamped exactly the way a non-numeric DEFAULT (a `color` roster entry's array)
  // already was: the knob is non-composable either way, and a look must still hold it at a
  // value `assertLookInBounds` accepts, never at the roster's raw, unclamped number (I4 — found
  // wiring `material`/`lighting`; a menu roster with no MIN/MAX is exactly what `mathops`/`shade`
  // have not yet needed to declare, not a case unique to those two).
  const raw = typeof def === 'number' ? def : lo;
  const d = raw < lo ? lo : raw > hi ? hi : raw;
  const sentence = (typeof description === 'string' && description.trim()) ? description.trim() : null;
  const bad = hi <= lo ? `degenerate range [${lo}, ${hi}]`
    : !sentence ? 'no situation sentence (docs/COMPOSER.md §8)' : null;
  return {key, name:key, label, min:lo, max:hi, default:d, bipolar:lo < 0 && hi > 0,
    description:sentence, descriptionOrigin:null, role, roleGloss:null,
    composable:bad === null, skipReason:bad};
};

/** The knobs a given stack offers for THIS record. The mapping table (which roster feeds
 *  which stack, under which group id) is `records.ts` §STACK_SOURCES — cited there once. */
export function stackKnobs(record:RecordDescriptor, stackId:StackId, rosters:Rosters):StackKnob[] {
  switch (stackId) {
    case 'shape':
      return record.knobs.map(k => ({...k, key:k.name}));
    case 'mathops':
      // `_ops-canon.js` OP_INPUTS ∩ INJECTED_OP_NAMES; a companion rides its parent and is
      // never offered on its own (`_glyOpCompanion`).
      return rosters.ops.injected
        .filter(o => !o._glyOpCompanion)
        .map(o => fromRoster(o.NAME, o.LABEL, o.MIN, o.MAX, o.DEFAULT, o.TIP, null));
    case 'shade':
      return rosters.raymarchInputs
        .map(i => fromRoster(i.NAME, i.LABEL, i.MIN, i.MAX, i.DEFAULT, i.DESCRIPTION, null));
    case 'material':
      return rosters.material
        .map(i => fromRoster(i.NAME, i.LABEL, i.MIN, i.MAX, i.DEFAULT, i.DESCRIPTION, null));
    case 'lighting':
      return rosters.lighting
        .map(i => fromRoster(i.NAME, i.LABEL, i.MIN, i.MAX, i.DEFAULT, i.DESCRIPTION, null));
    case 'layers':
    case 'fx':
    case 'modulation':
      return [];   // these three are SET stacks, not parameter vectors — see below.
    default:
      return [];
  }
}

/* ── one readable line ──────────────────────────────────────────────────────────── */

/** The endpoint form is `<what it does to the image> — <MIN end>, <MAX end>`
 *  (`docs/COMPOSER.md` §8). The HEAD (before the em-dash) is the effect; the tail
 *  names the two ends. A look's line reuses the head and says WHICH end this look sits
 *  toward — which is why both halves had to be authored: without the tail the position
 *  word has nothing to name. */
const headOf = (s:string) => {
  const i = s.indexOf(' — ');
  const head = i > 0 ? s.slice(0, i) : s;
  // A roster sentence that predates the endpoint form often carries its own tail after a
  // semicolon ("… ; 0 is off"). The head is still the effect, so cut there too.
  const j = head.indexOf(';');
  return (j > 0 ? head.slice(0, j) : head).trim().replace(/[.;]$/, '');
};
const endsOf = (s:string):string[] => {
  const i = s.indexOf(' — ');
  return i > 0 ? s.slice(i + 3).split(',').map(x => x.trim()).filter(Boolean) : [];
};
const positionWord = (t:number) => t < 0.34 ? 'low' : t > 0.66 ? 'high' : 'mid';

function lineFor(record:RecordDescriptor, stackId:StackId, coordinate:AxisCoordinate,
                 moved:{knob:StackKnob;value:number}[]):string {
  const parts = moved.slice(0, 3).map(({knob, value}) => {
    const span = knob.max - knob.min;
    const t = span > 0 ? clamp01((value - knob.min) / span) : 0;
    const ends = endsOf(knob.description ?? '');
    // Prefer the author's OWN word for this end; fall back to low/mid/high.
    const end = t < 0.34 ? ends[0] : t > 0.66 ? ends[ends.length - 1] : null;
    return `${headOf(knob.description ?? knob.label)}: ${end ?? positionWord(t)}`;
  });
  const coord = Object.entries(coordinate)
    .filter(([,v]) => v && v !== 'any').map(([k,v]) => `${k} ${v}`).join(', ');
  const body = parts.length ? parts.join('; ') : (coord || 'left at the record\'s defaults');
  return `${STACK_LABELS[stackId]} — ${body}`;
}

/* ── the SET stacks ─────────────────────────────────────────────────────────────── */

/** How many members a set draws, biased by the coordinate words the stack answers to.
 *  Bounded small on purpose: a stack whose every option is on is not a look, it is a pile. */
function setSize(rnd:()=>number, max:number, bias:number):number {
  const k = Math.floor(clamp01(bias + (rnd() - 0.5) * 0.5) * (max + 0.999));
  return Math.max(0, Math.min(max, k));
}
const biasOf = (coordinate:AxisCoordinate, axes:string[]):number => {
  const vals = axes.map(a => AXIS_POSITION[a]?.[coordinate[a] ?? ''])
                   .filter((v):v is number => typeof v === 'number');
  return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0.5;
};
/** Seeded, stable shuffle-and-take. */
function take<T>(items:T[], k:number, rnd:()=>number):T[] {
  const pool = items.map((v,i) => ({v, r:rnd(), i}));
  pool.sort((a,b) => a.r - b.r || a.i - b.i);
  return pool.slice(0, k).map(p => p.v);
}

/* ── the movement menu (waveforms AND easings) ───────────────────────────────────── */

/** THE MOVEMENT VOCABULARY IS ONE MENU. A waveform and an easing are both answers to "what
 *  shape does this parameter move in", so they are enumerated together and handed to
 *  `requests.ts buildMotionRequest` through its one `waveforms` channel — code enumerates,
 *  the model picks an id (`docs/COMPOSER.md` §1).
 *
 *  An easing id is PREFIXED `ease:` so the committed answer names which roster it came from
 *  without any code interpreting the string (§4.2): it is looked up, never parsed for meaning.
 *
 *  WHICH easings are offered is read two ways, and neither is a name:
 *   · the coordinate's `motion` word selects FAMILIES through the one feeling table
 *     (`axes.ts MOTION_FEELING`); an unconstrained axis selects none, and then every easing
 *     is admissible because the coordinate says nothing about movement shape;
 *   · the curve's own SAMPLES say whether it is a one-shot move, an overshoot or a cycle
 *     (`rosters.ts curveShape`). A one-shot ramp held forever is not `driving` movement, so
 *     a monotonic curve is withheld from that word — and an unresolvable curve, whose shape
 *     cannot be read at all, is withheld from every word rather than guessed at. */
export interface MovementOption { id:string; label:string }

export function movementOptions(rosters:Rosters, coordinate:AxisCoordinate):MovementOption[] {
  const word = coordinate.motion;
  const out:MovementOption[] = rosters.waveforms.map(w => ({id:w.id, label:w.label}));
  const families = easingFamiliesForMotion(word);
  for (const e of rosters.easings) {
    if (families.length && !families.includes(e.family)) continue;
    const shape = curveShape(e.curve);
    if (!shape) continue;
    if (word === 'driving' && shape === 'monotonic') continue;
    out.push({id:easingOptionId(e), label:`${e.label} — ${e.family}, ${shape}`});
  }
  return out;
}
export const easingOptionId = (e:Easing) => 'ease:' + e.id;

/* ── the sampler ────────────────────────────────────────────────────────────────── */

/** N complete looks for ONE stack at ONE coordinate. Deterministic in
 *  (record.id, stackId, coordinate, seed); ids are `<stack>_<seedIndex>_<short-hash>`. */
export function sampleLooks(record:RecordDescriptor, stackId:StackId,
                            coordinate:AxisCoordinate, opts:SampleOptions):LookCandidate[] {
  ok(Number.isInteger(opts.n) && opts.n > 0, 'sampleLooks: n must be a positive integer');
  const rosters = opts.rosters ?? loadRosters(opts.appRoot ?? '');
  const base = seedFrom({r:record.id, s:stackId, c:coordinate, seed:opts.seed >>> 0});
  const out:LookCandidate[] = [];

  for (let ci = 0; ci < opts.n; ci++) {
    const rnd = rngFrom(seedFrom({base, ci}));
    const params:Record<string,JsonValue> = {};
    const skipped:string[] = [];
    const moved:{knob:StackKnob;value:number}[] = [];

    if (stackId === 'layers')      sampleLayers(rosters, coordinate, rnd, params);
    else if (stackId === 'fx')     sampleFx(rosters, coordinate, rnd, params);
    else if (stackId === 'modulation') sampleModulation(record, rosters, coordinate, rnd, params, skipped);
    else {
      const knobs = stackKnobs(record, stackId, rosters);
      for (const k of knobs) {
        if (!k.composable) { params[k.key] = k.default; skipped.push(k.name); continue; }
        const v = drawValue(k, coordinate, rnd);
        params[k.key] = v;
        if (v !== k.default) moved.push({knob:k, value:v});
      }
      // The strongest movers lead the line — a look is described by what it CHANGED.
      moved.sort((a,b) => {
        const na = Math.abs(a.value - a.knob.default) / ((a.knob.max - a.knob.min) || 1);
        const nb = Math.abs(b.value - b.knob.default) / ((b.knob.max - b.knob.min) || 1);
        return nb - na || (a.knob.key < b.knob.key ? -1 : 1);
      });
    }

    skipped.sort();
    const description = stackId === 'layers' || stackId === 'fx' || stackId === 'modulation'
      ? setLineFor(stackId, coordinate, params, rosters)
      : lineFor(record, stackId, coordinate, moved);
    const short = hashJSON({params, skipped}).slice(0,8);
    const look:LookCandidate = {id:`${stackId}_${ci}_${short}`, description, params, skipped};
    assertLookInBounds(record, stackId, look, rosters);
    out.push(look);
  }
  return out;
}

function sampleLayers(rosters:Rosters, coordinate:AxisCoordinate, rnd:()=>number,
                      params:Record<string,JsonValue>):void {
  // The layer MODE is a per-role param (`u_bgMode` for bg, `u_L{i}_texMode` per fill
  // layer) and its value is the INDEX into the roster's own mode list (index 0 clears).
  // A mode is an enum whose options the roster itself
  // NAMES, so choosing one guesses no meaning — it picks a line the app already wrote.
  const bg = rosters.layers.bgModes;
  if (bg.length) params['u_bgMode'] = Math.min(bg.length - 1,
    Math.floor(biasOf(coordinate,['warmth','density']) * bg.length + (rnd() - 0.5)));
}

function sampleFx(rosters:Rosters, coordinate:AxisCoordinate, rnd:()=>number,
                  params:Record<string,JsonValue>):void {
  // The app's post-pass chain canon: the chain is a CARD-level list of
  // `{kind, spec, enabled}` entries and the ORDER is the seed graph.
  // The entries come from the FX library manifest — never a list this repo keeps.
  const k = setSize(rnd, 2, biasOf(coordinate, ['contrast','motion']));
  params['postPassChain'] = take(rosters.fx, k, rnd).map(e => ({
    kind:'fx-shader', spec:{shaderRef:e.path, params:{}}, enabled:true
  })) as unknown as JsonValue;
}

function sampleModulation(record:RecordDescriptor, rosters:Rosters, coordinate:AxisCoordinate,
                          rnd:()=>number, params:Record<string,JsonValue>, skipped:string[]):void {
  // CALL 3's shape, sampled: per moving param a waveform from the LFO roster, an ordinal
  // rate LEVEL (never a rate — turning an ordinal into Hz is arithmetic, done in code, L4),
  // and a CURATED BRACKET drawn strictly inside the knob's own domain
  // (`docs/COMPOSER.md` §9): the bracket is the performer's operating window, and the app
  // applies it BEFORE the bind, so it is never an affine output range.
  const movable = record.composableKnobs;
  for (const k of record.knobs) if (!k.composable) skipped.push(k.name);
  // ONE movement menu: the LFO waveforms plus the easings the coordinate admits. Drawing
  // from the same list the model will be offered is what keeps a sampled bind and a picked
  // bind the same kind of thing.
  const movement = movementOptions(rosters, coordinate);
  if (!movable.length || !movement.length) return;
  const k = setSize(rnd, Math.min(3, movable.length), biasOf(coordinate, ['motion']));
  for (const knob of take(movable, k, rnd)) {
    const wf = movement[Math.floor(rnd() * movement.length)];
    const a = drawValue({...knob, key:knob.name}, coordinate, rnd);
    const b = drawValue({...knob, key:knob.name}, coordinate, rnd);
    params['bind:' + knob.name] = {
      waveform:wf.id,
      rateLevel:Math.floor(clamp01(biasOf(coordinate,['motion']) + (rnd()-0.5)*0.3) * 5),
      min:Math.min(a,b), max:Math.max(a,b)
    };
  }
}

function setLineFor(stackId:StackId, coordinate:AxisCoordinate,
                    params:Record<string,JsonValue>, rosters:Rosters):string {
  const label = STACK_LABELS[stackId];
  if (stackId === 'fx') {
    const chain = (params['postPassChain'] ?? []) as {spec:{shaderRef:string}}[];
    const names = chain.map(e => rosters.fx.find(f => f.path === e.spec.shaderRef)?.name ?? e.spec.shaderRef);
    return `${label} — ${names.length ? names.join(' then ') : 'no effects'}`;
  }
  if (stackId === 'layers') {
    const i = params['u_bgMode'];
    const mode = typeof i === 'number' ? rosters.layers.bgModes[i]?.label : undefined;
    return `${label} — background ${mode ?? 'unchanged'}`;
  }
  const binds = Object.entries(params).filter(([k]) => k.startsWith('bind:'));
  const words = binds.map(([k,v]) => {
    const b = v as {waveform:string};
    return `${k.slice(5)} on ${b.waveform}`;
  });
  return `${label} — ${words.length ? words.join(', ') : 'nothing moves'}`;
}

/* ── the guard (falsifiable on its own) ─────────────────────────────────────────── */

/** Re-check a finished look against the knobs it claims to set. A value outside its
 *  knob's `[MIN, MAX]` is a SAMPLER defect and throws — it is never returned, never
 *  offered to a model, and never left for a downstream validator to catch
 *  (`docs/COMPOSER.md` §1). */
export function assertLookInBounds(record:RecordDescriptor, stackId:StackId,
                                   look:LookCandidate, rosters:Rosters):void {
  const byKey = new Map(stackKnobs(record, stackId, rosters).map(k => [k.key, k]));
  for (const [key, value] of Object.entries(look.params)) {
    const knob = byKey.get(key);
    if (!knob || typeof value !== 'number') continue;
    if (value < knob.min || value > knob.max)
      throw new RangeError(
        `sampled "${key}" = ${value} is outside its declared [${knob.min}, ${knob.max}] ` +
        `(record ${record.id}, stack ${stackId}, look ${look.id})`);
  }
}

/** The whole coordinate, every stack — what CALL 2's request is built over. */
export function sampleAllStacks(record:RecordDescriptor,
                                coordinate:Partial<Record<StackId,AxisCoordinate>>,
                                opts:SampleOptions):Partial<Record<StackId,LookCandidate[]>> {
  const out:Partial<Record<StackId,LookCandidate[]>> = {};
  for (const stack of record.stacks)
    out[stack] = sampleLooks(record, stack, coordinate[stack] ?? {}, opts);
  return out;
}

/** Exposed for the run report: the canonical JSON of what a sampler was asked, so a
 *  report line and a receipt's candidate hash are talking about the same draw. */
export const sampleSignature = (record:RecordDescriptor, stackId:StackId,
                                coordinate:AxisCoordinate, opts:{n:number;seed:number}) =>
  canonicalJSON({record:record.id, stack:stackId, coordinate, n:opts.n, seed:opts.seed >>> 0});

/** THE RENDER — a composed unit becomes ONE preset slot in the consuming app's own shape.
 *
 *  `docs/PLAN.md` §1 I5. The composer's output is a `CompositionDraft`: per-stack looks
 *  whose `params` are keyed the way the APP keys them, plus a motion map. What the app's
 *  source-keyed preset bank stores is a CARD SNAPSHOT — a different, named shape
 *  (`specs/preset-json.md` §What presets save in the consuming repo). This module is the
 *  one place the two meet, and it is PURE: no I/O, no provider, no clock beyond the caller's.
 *
 *  THE MAPPING IS A TRANSCRIPTION OF NOTHING. Every key form below already exists in the
 *  draft because the SAMPLERS wrote it that way against the app's own exported rosters
 *  (`docs/COMPOSER.md` §9) — `u_zoom`, `u_zoom.blend`, `opActive.sdf`, `postPassChain`,
 *  `bind:<knob>`. So this file does not decide what a stack means; it only routes each key
 *  form to the snapshot field the app reads it from:
 *
 *      <NAME>                →  params[NAME]
 *      <NAME>.blend          →  sliderBlend[NAME] = { mode:<int>, against:'default' }
 *      opActive.<scope>      →  opActive[scope]
 *      postPassChain         →  postPassChain
 *      bind:<NAME>           →  bindings.receivers[] + ranges[NAME]  (see §the bind, below)
 *
 *  ⚠ THE BLEND INDEX IS READ, NEVER COUNTED HERE. `sliderBlend.mode` is an INTEGER index
 *  into the app's 30-mode roster, and the sampler drew a NAME. The index is the name's
 *  position in the app's OWN exported `sliderBlend` menu (`rosters.shared.menus`), so a
 *  mode added or reordered upstream moves both halves together. A local list of 30 names
 *  would be the duplication the whole rosters export exists to prevent.
 *
 *  ── §the bind — ONE mechanism, and the one it refuses ─────────────────────────────────
 *
 *  A composed bind carries a WAVEFORM (or an easing), an ordinal RATE LEVEL, and a curated
 *  BRACKET inside the knob's own domain. The app expresses exactly that as the documented
 *  OSCILLATOR TRANSFORM (`specs/data-router.md` §Oscillator transform): a receiver on a
 *  clock source whose `transform.oscillator = {curveId, rate, depth, phase, bipolar, base}`
 *  maps the clock phase through a "Waveforms and Easings" curve into the slider's domain —
 *  "LFO math without the LFO module". The bracket rides `ranges[NAME]`, which is where the
 *  app applies it (it COMPRESSES the oscillation into the bracket, never clamps it).
 *
 *  So `ease:<id>` and every waveform id the easing library ALSO carries (`sine`, `cosine`,
 *  `triangle`, `square`, …) render as one oscillator receiver each.
 *
 *  AND THE REFUSAL, which is the honest half: an LFO-bank waveform the easing library does
 *  NOT carry (`sawtooth`, `ramp`, `random`, `s&h`, `noise`, `bezier`) has no curve id and no
 *  router source a PRESET ALONE can name — binding it would require an LFO module instance
 *  whose selected waveform is app state, not preset state. That bind is DROPPED AND NAMED
 *  in `refused[]`, never silently defaulted to a curve that happens to exist
 *  (`docs/COMPOSER.md` §3.2 is fail-closed, and a look nobody asked for is worse than a
 *  bind that is missing on the record). CALL 3 — the waveform Choice — is I6's, and when it
 *  lands it draws from a menu this refusal makes visible.
 */
import type {ComposedUnit} from '../server/compose.js';
import type {JsonValue, StackId} from './types.js';
import type {Rosters} from './rosters.js';

/** The app's card-snapshot shape, named only where this writer fills it. Every field is
 *  OPTIONAL on the app side and an absent one restores nothing — so a unit whose stacks
 *  touched no ops writes no `opActive`, rather than an empty object the app must tolerate. */
export interface PresetSlot {
  name:string;
  params:Record<string,JsonValue>;
  ranges:Record<string,[number,number]>;
  sliderBlend?:Record<string,{mode:number;against:'default'}>;
  opActive?:Record<string,JsonValue>;
  postPassChain?:JsonValue[];
  bindings?:{receivers:JsonValue[];senders:JsonValue[]};
  generation:DeliveredGeneration;
}

/** ⚠ `generation.provenance` IS THE IDENTITY OBJECT HERE, and that is deliberate.
 *
 *  `docs/COMPOSER.md` §5's sentence is "the receipts for one composition ride the composed
 *  artifact itself as `generation.provenance` … so they survive a save/recall round trip",
 *  and I5 is the increment that makes it true. On the DRAFT (`core/types.ts`)
 *  `generation.provenance` is still the `live|synthetic|mixed` string, unchanged and
 *  untouched — I4's byte-identity acceptance hashes that snapshot and must keep hashing the
 *  same bytes. The widening happens HERE, at the delivery boundary, where the identity is
 *  first knowable: the draft's string becomes `provenance.mode`, and nothing is laundered —
 *  a synthetic run reads `mode:'synthetic'` in the app exactly as it does in the journal.
 *
 *  `unitSha256` is the artifact's own `snapshotSha256` — the hash OF the draft, which is why
 *  it can only be carried by a field the draft does not contain. A unit sha nested inside
 *  the thing it hashes would be uncomputable, not merely awkward.
 *
 *  THE NAME. The consuming spec (`specs/preset-json.md`) named no generation field at all
 *  before this increment, so there was no name to defer to; the field is registered there
 *  in the same commit that writes it, which is what makes the `Preset-walk:` trailer honest.
 */
export interface DeliveredGeneration {
  provenance:{
    mode:'live'|'synthetic'|'mixed';
    providerId:string; providerClass:string; model:string;
    rosterVersion:string; candidateMapVersion:string;
    /** which roster EXPORT this was composed against, with its per-source hashes. */
    rosters:JsonValue|null;
    recordId:string; tag:string; seed:number;
    unitSha256:string;
    /** present only on a re-run, and never inside the hashed draft (`server/compose.ts`). */
    replayOf?:string;
    /** every decision, in order (`docs/COMPOSER.md` §5). */
    receipts:JsonValue[];
    /** ONE entry, in the consuming app's OWN chain shape (`js/provenance.js` prvAppend:
     *  `{action, timestamp, by, description, contentHash}`). It is not a second chain: a
     *  card's own provenance chain is NOT preset state in that app ("What presets do NOT
     *  save: Provenance chain") and is never touched by this writer. This records the one
     *  event the writer is responsible for — that this slot was composed, by what, from
     *  what — in the vocabulary the app already reads. */
    chain:{action:string;timestamp:string;by:string;description:string;contentHash:string|null}[];
  };
}

export interface RenderOptions {
  rosters:Rosters;
  /** the app's exported `sliderBlend` menu ids, IN ORDER — the index IS the position. */
  blendOrder:string[];
  /** the clock source a composed oscillator bind rides (`specs/data-router.md`). */
  clockSourceId?:string;
  now?:string;
}

export interface RenderedSlot {
  slot:PresetSlot;
  /** what the render declined to carry, and why. Never empty-by-omission. */
  refused:{key:string;reason:string}[];
}

/** rateLevel is an ORDINAL (`docs/COMPOSER.md` §2: the number is never a measurement), so
 *  turning it into the oscillator's cycles-per-clock-turn is arithmetic and lives in code
 *  (§11 — the model is never asked to count). Level 0 is one cycle per turn; each level up
 *  is one more. */
export const rateForLevel = (level:number):number =>
  Math.max(1, Math.round(Number.isFinite(level) ? level : 0) + 1);

/** The curve id an app oscillator would use for a composed movement option, or null when
 *  the app's easing library carries no such curve (see §the bind). */
export function curveIdFor(waveform:string, easingIds:Set<string>):string|null {
  const id = waveform.startsWith('ease:') ? waveform.slice(5) : waveform;
  return easingIds.has(id) ? id : null;
}

interface ComposedBind { waveform?:string; rateLevel?:number; min?:number; max?:number; source?:string }

export function renderSlot(unit:ComposedUnit, o:RenderOptions):RenderedSlot {
  const refused:{key:string;reason:string}[] = [];
  const easingIds = new Set(o.rosters.easings.map(e => e.id));
  const blendIndex = new Map(o.blendOrder.map((id, i) => [id, i] as const));

  const params:Record<string,JsonValue> = {};
  const ranges:Record<string,[number,number]> = {};
  const sliderBlend:Record<string,{mode:number;against:'default'}> = {};
  const opActive:Record<string,JsonValue> = {};
  const receivers:JsonValue[] = [];
  let postPassChain:JsonValue[]|undefined;

  const stacks = unit.snapshot.stacks as Record<string,{lookId:string;params:Record<string,JsonValue>}>;
  for (const stack of Object.keys(stacks).sort() as StackId[]) {
    const look = stacks[stack];
    if (!look) continue;
    for (const key of Object.keys(look.params).sort()) {
      const value = look.params[key];

      if (key === 'postPassChain') { postPassChain = value as JsonValue[]; continue; }

      if (key.startsWith('opActive.')) {
        const scope = key.slice('opActive.'.length);
        if (!scope) { refused.push({key, reason:'an opActive key with no scope names no op family'}); continue; }
        opActive[scope] = value;
        continue;
      }

      if (key.endsWith('.blend')) {
        const name = key.slice(0, -'.blend'.length);
        const mode = blendIndex.get(String(value));
        if (mode === undefined) {
          // The app stores an INTEGER index; a name the app's own exported roster does not
          // carry has no index, and guessing one would silently pick a different mode.
          refused.push({key, reason:`blend mode "${String(value)}" is not in the app's exported ` +
            `sliderBlend roster (${o.blendOrder.length} modes) — no index to write`});
          continue;
        }
        sliderBlend[name] = {mode, against:'default'};
        continue;
      }

      if (key.startsWith('bind:')) {
        const name = key.slice('bind:'.length);
        const b = (value ?? {}) as ComposedBind;
        const curveId = b.waveform ? curveIdFor(b.waveform, easingIds) : null;
        if (!curveId) {
          refused.push({key, reason:`movement "${String(b.waveform)}" has no curve in the app's ` +
            'easing library and no router source a preset alone can name — the bind is dropped, ' +
            'not defaulted (docs/PLAN.md §1 I6 owns the waveform Choice)'});
          continue;
        }
        const lo = Number(b.min), hi = Number(b.max);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
          refused.push({key, reason:`the bind bracket [${String(b.min)}, ${String(b.max)}] is not a ` +
            'finite ordered range — a receiver with no operating window is not written'});
          continue;
        }
        ranges[name] = [lo, hi];
        receivers.push({
          sourceId: o.clockSourceId ?? 'ck:phase',
          targetParam: name,
          transform: {
            srcRange:[0,1], dstRange:[lo,hi], invert:false, min:lo, max:hi,
            oscillator:{curveId, rate:rateForLevel(b.rateLevel ?? 0), depth:hi - lo, phase:0,
                        bipolar:false, base:lo}
          },
          active: true
        } as unknown as JsonValue);
        continue;
      }

      params[key] = value;
    }
  }

  const g = unit.snapshot.generation;
  const now = o.now ?? new Date().toISOString();
  const slot:PresetSlot = {
    name: `jev ${unit.tag}`,
    params, ranges,
    ...(Object.keys(sliderBlend).length ? {sliderBlend} : {}),
    ...(Object.keys(opActive).length ? {opActive} : {}),
    ...(postPassChain ? {postPassChain} : {}),
    ...(receivers.length ? {bindings:{receivers, senders:[]}} : {}),
    generation: {
      provenance: {
        mode: g.provenance,
        providerId: g.providerId, providerClass: g.providerClass, model: g.model,
        rosterVersion: g.rosterVersion, candidateMapVersion: g.candidateMapVersion,
        rosters: (unit.rosters ?? null) as unknown as JsonValue,
        recordId: unit.recordId, tag: unit.tag, seed: unit.seed,
        unitSha256: unit.snapshotSha256,
        ...(unit.replayOf ? {replayOf:unit.replayOf} : {}),
        receipts: unit.receipts as unknown as JsonValue[],
        chain: [{
          action: 'preset-save',
          timestamp: now,
          by: 'jevisualeyes',
          description: `composed for "${unit.recordId}" at ${unit.tag} (seed ${unit.seed}, ` +
                       `${unit.receipts.length} decision(s), provider ${g.providerId}/${g.providerClass})`,
          contentHash: 'sha256:' + unit.snapshotSha256
        }]
      }
    }
  };
  return {slot, refused};
}

/** The app's exported `sliderBlend` menu, in order. READ from the roster bundle the app
 *  itself writes — never a list held here (`docs/COMPOSER.md` §9).
 *
 *  ⚠ `menu.values` DELIBERATELY, not `composableMenuValues(menu)`. Everywhere else in this
 *  repo the composable subset is the right read, because a value with no sentence may not be
 *  OFFERED to a model (§8). Here the read is an INDEX LOOKUP, and the index is a position in
 *  the app's full roster — filtering it would shift every mode after the first gap and write
 *  a different blend than the one the sampler drew. The sampler already did the §8 filtering
 *  when it picked the name. */
export function blendOrderFrom(rosters:Rosters):string[] {
  const m = rosters.menus['sliderBlend'];
  const values = m && Array.isArray(m.values) ? m.values : null;
  if (!values || !values.length) throw new TypeError(
    'the roster bundle carries no sliderBlend menu — re-run the app\'s own ' +
    'tools/export-rosters.js; a blend name has no index without it');
  return values.map(v => String(v.id));
}

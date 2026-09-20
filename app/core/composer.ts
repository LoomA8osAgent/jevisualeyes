/** THE DOMAIN HALF of the runner's seam — what to ask next, given the draft so far.
 *
 *  `server/jobs.ts` declares `Composer` and owns persistence, retry, validation,
 *  selection, receipts and the transaction; it owns NO sampling. This is the other side:
 *  it samples and builds the step, and it owns no I/O and no policy. The two can never
 *  drift into each other because neither can see the other's half.
 *
 *  SCOPE — `docs/PLAN.md` §1 I4, the smallest end-to-end composer. The phase machine is:
 *
 *      given tag  →  motion Nouls  →  looks, with a bounded accept/resample per stack
 *                                  →  null (the spine assembles and finishes the unit)
 *
 *  The tag GIVES the coordinate (`tags.ts compileTag`), so CALL 1's axis Choices are not
 *  asked — that is I6, and it is deliberately absent rather than stubbed. What survives of
 *  CALL 1 here is its other half, the motion Noul per candidate moving param, chunked at
 *  ≤ 6 questions per request because the encoder re-emits the state into every row
 *  (`docs/COMPOSER.md` §7.1). CALL 3 (the waveform Choice and the rate Score for the params
 *  that moved) is I6 as well; a bind's movement shape is still SAMPLED into the
 *  `modulation` stack's own look, exactly as I3 drew it.
 *
 *  THE BOUNDED ACCEPT/RESAMPLE, and why it exists. A committed look is re-checked by CODE
 *  (`acceptLook` below) before the unit may finish; a rejected stack is re-sampled at a
 *  perturbed seed and re-asked, at most `resampleCap` times, and then the run REFUSES with
 *  the stack, the attempt count and the reason named. There is no silent fallback to the
 *  last rejected look and no "good enough" tier: `docs/COMPOSER.md` §3.2 is fail-closed, and
 *  a composer that quietly shipped a look its own check rejected would be the fail-open
 *  shape inside the thing built to prevent it.
 */
import type {Composer, ComposerStep} from '../server/jobs.js';
import type {AxisCoordinate, CompositionDraft, JsonValue, LookCandidate, StackId} from './types.js';
import {buildCandidateMap, CANDIDATE_MAP_VERSION} from './candidates.js';
import {buildLookRequest, buildMotionRequest} from './requests.js';
import type {RecordState} from './requests.js';
import {lookQuestionId} from './axes.js';
import {compileTag} from './tags.js';
import type {RecordIndex, RecordDescriptor} from './records.js';
import type {Rosters} from './rosters.js';
import {assertLookInBounds, stackKnobs} from './samplers.js';

/** §7.1 — above ~6 questions a bundle costs MORE than issuing them separately, because the
 *  encoder builds one row per question and re-encodes the state into every row. */
export const MOTION_CHUNK = 6;
/** How many times one stack may be re-sampled before the run refuses. Fixed, small, and
 *  recorded on the composer so a report can name it. */
export const DEFAULT_RESAMPLE_CAP = 3;

export interface UnitComposerOptions {
  index:RecordIndex;
  rosters:Rosters;
  model:string;
  /** how many complete looks per stack. A menu of 1 is not a decision and is never asked. */
  n?:number;
  /** the Noul band above which a param counts as MOVING — recorded, never inferred. */
  movingBand?:number;
  /** the bounded accept/resample cap, per stack. */
  resampleCap?:number;
}

/** Why a committed look was refused, or `null` when it stands. */
export interface LookVerdict { ok:boolean; reason:string|null }

/** THE ACCEPT CHECK — code re-reading what the model committed.
 *
 *  Two refusals, both from `docs/COMPOSER.md`, and nothing else — this is not a taste gate,
 *  which is the one thing neither code nor a model can be (§11):
 *
 *   1. **out of bounds** — `assertLookInBounds` re-run against the stack's own knobs. It
 *      cannot fire on a look this repo sampled (validity is the generator's property, §1),
 *      so what it actually catches is a candidate-map/receipt mismatch, which §4.2 says may
 *      never be papered over.
 *   2. **every knob at its default** — §11's own sentence: "A look whose every knob sits at
 *      its default is valid structurally and fails the eye." Applied ONLY to the stacks that
 *      are parameter vectors; a SET stack (`layers` / `fx` / `modulation`) legitimately
 *      draws the empty set — "no effects" is a look, and refusing it would be this gate
 *      inventing a preference the contract does not carry.
 */
export function acceptLook(record:RecordDescriptor, stack:StackId,
                           committed:{lookId:string; params:Record<string,JsonValue>},
                           rosters:Rosters):LookVerdict {
  const look:LookCandidate = {id:committed.lookId, description:'', params:committed.params};
  try { assertLookInBounds(record, stack, look, rosters); }
  catch (e:any) { return {ok:false, reason:String(e?.message ?? e)}; }

  const knobs = stackKnobs(record, stack, rosters).filter(k => k.composable);
  if (!knobs.length) return {ok:true, reason:null};      // a SET stack, or nothing composable
  const moved = knobs.some(k => committed.params[k.key] !== undefined &&
                                committed.params[k.key] !== k.default);
  return moved ? {ok:true, reason:null}
    : {ok:false, reason:`every composable knob of "${stack}" sits at its DEFAULT — ` +
        'structurally valid and no look at all (docs/COMPOSER.md §11)'};
}

/** A resample must DRAW SOMETHING ELSE, and in `model` selection mode the spine's PRNG does
 *  not advance (a provider's argmax is committed verbatim, `selection.ts`), so the seed the
 *  composer is handed is the same on every attempt. The round is mixed in here. */
const seedForRound = (seed:number, round:number):number =>
  round === 0 ? seed >>> 0 : (Math.imul(seed >>> 0, 16777619) ^ Math.imul(round, 0x9e3779b9)) >>> 0;

export class UnitComposer implements Composer {
  readonly id = 'a8os.jev.composer.unit';
  readonly version = 'unit.v1';
  readonly candidateMapVersion = CANDIDATE_MAP_VERSION;
  readonly movingBand:number;
  readonly resampleCap:number;
  private lastNotAsked:{stack:StackId;reason:string}[] = [];
  /** per stack, how many times its look has been REJECTED and re-asked. */
  private rounds = new Map<StackId,number>();
  /** every refusal the accept check has issued this run, in order — the report's own copy. */
  private rejections:{stack:StackId;round:number;reason:string}[] = [];

  constructor(private opts:UnitComposerOptions) {
    this.movingBand = opts.movingBand ?? 0.5;
    this.resampleCap = opts.resampleCap ?? DEFAULT_RESAMPLE_CAP;
  }

  /** What the last step declined to ask, and why — read by the run report. */
  notAsked():{stack:StackId;reason:string}[] { return this.lastNotAsked; }
  /** Every accepted-then-rejected look, with its reason — never swallowed. */
  resampled():{stack:StackId;round:number;reason:string}[] { return this.rejections.slice(); }

  private coordinateFor(record:RecordDescriptor, tag:string):Partial<Record<StackId,AxisCoordinate>> {
    return compileTag(tag, record.stacks).byStack;
  }

  private stateFor(record:RecordDescriptor, tag:string):RecordState {
    return {
      recordId:record.id, family:record.family, tag,
      // §8: the record's own situation sentence, NAMED as absent rather than faked when the
      // descriptor lift has not reached this record.
      situation:record.situation ?? `${record.label} (no situation sentence yet — descriptor lift pending)`
    };
  }

  nextStep(draft:CompositionDraft, seed:number):ComposerStep|null {
    const record = this.opts.index.get(draft.recordId);
    const coordinate = this.coordinateFor(record, draft.tag);
    const state = this.stateFor(record, draft.tag);

    /* ── phase 1: the motion Nouls, chunked at ≤ MOTION_CHUNK (§7.1) ──────────── */
    const unanswered = record.composableKnobs.filter(k => !(k.name in draft.motion));
    if (unanswered.length) {
      const chunk = unanswered.slice(0, MOTION_CHUNK).map(k => ({
        name:k.name, situation:k.description ?? k.label
      }));
      return {
        kind:'motion',
        request:buildMotionRequest(this.opts.model, state, coordinate, chunk),
        candidates:{},
        extra:{coordinate, params:chunk.map(c => c.name)} as unknown as ComposerStep['extra']
      };
    }

    /* ── phase 2: the looks, with the bounded accept/resample ─────────────────── */
    const pending:StackId[] = [];
    const rejected:StackId[] = [];
    let round = 0;
    for (const stack of record.stacks) {
      const committed = draft.stacks[stack];
      if (!committed) { pending.push(stack); continue; }
      const verdict = acceptLook(record, stack, committed, this.opts.rosters);
      if (verdict.ok) continue;
      const done = this.rounds.get(stack) ?? 0;
      if (done >= this.resampleCap) throw new Error(
        `composition refused: "${stack}" was re-sampled ${done} time(s) at the ` +
        `cap of ${this.resampleCap} and every look was rejected — last reason: ${verdict.reason}`);
      this.rounds.set(stack, done + 1);
      this.rejections.push({stack, round:done + 1, reason:verdict.reason!});
      rejected.push(stack); pending.push(stack);
    }
    if (!pending.length) return null;                     // the unit is done
    for (const s of pending) round = Math.max(round, this.rounds.get(s) ?? 0);

    const map = buildCandidateMap(record, coordinate,
      {n:this.opts.n ?? 6, seed:seedForRound(seed, round), rosters:this.opts.rosters});
    this.lastNotAsked = map.notAsked;

    // Ask ONLY the pending stacks: a stack whose look already stands is not re-decided, and
    // the persisted candidate map must be exactly the menu the request carried (§4.2).
    const candidates:Record<string,LookCandidate[]> = {};
    const byStack:Partial<Record<StackId,LookCandidate[]>> = {};
    for (const stack of pending) {
      const qid = lookQuestionId(stack);
      if (!map.candidates[qid]) continue;                 // fewer than 2 distinct — reported, not asked
      candidates[qid] = map.candidates[qid];
      byStack[stack] = map.candidates[qid];
    }
    if (!Object.keys(candidates).length) {
      // A stack whose look was REJECTED and whose resample offers no menu may not simply be
      // left standing: that is the rejected look shipping anyway, which is the fail-open
      // shape this whole check exists to prevent (§3.2). A stack that was never committed
      // and has no menu is the ordinary `notAsked` case and is reported, not refused (§1).
      const stuck = rejected.filter(s => !candidates[lookQuestionId(s)]);
      if (stuck.length) throw new Error(
        `composition refused: ${stuck.map(s => `"${s}"`).join(', ')} had a look rejected and ` +
        'the resample offered no menu to re-decide it — the rejected look is not shipped');
      return null;                                        // nothing composable — §8, in notAsked
    }

    return {
      kind:'looks',
      request:buildLookRequest(this.opts.model, state, coordinate, byStack),
      candidates,
      extra:{coordinate, notAsked:map.notAsked, round} as unknown as ComposerStep['extra']
    };
  }
}

/** THE DOMAIN HALF of the runner's seam — what to ask next, given the draft so far.
 *
 *  `server/jobs.ts` declares `Composer` and owns persistence, retry, validation,
 *  selection, receipts and the transaction; it owns NO sampling. This is the other side:
 *  it samples and builds the step, and it owns no I/O and no policy. The two can never
 *  drift into each other because neither can see the other's half.
 *
 *  SCOPE, stated plainly: this composer runs the **`looks` arm only**. The axis coordinate
 *  is GIVEN (a tag, compiled in code), not asked; CALL 1's axis Choices and CALL 3's motion
 *  questions are `docs/PLAN.md` §1 I4/I6 and are deliberately absent rather than stubbed.
 *  `nextStep` therefore returns exactly one step and then `null`, which is the spine's own
 *  signal that the unit is done.
 */
import type {Composer, ComposerStep} from '../server/jobs.js';
import type {AxisCoordinate, CompositionDraft, StackId} from './types.js';
import {buildCandidateMap, CANDIDATE_MAP_VERSION} from './candidates.js';
import {buildLookRequest} from './requests.js';
import type {RecordState} from './requests.js';
import type {RecordIndex} from './records.js';
import type {Rosters} from './rosters.js';

export interface LooksComposerOptions {
  index:RecordIndex;
  rosters:Rosters;
  model:string;
  /** tag → the per-stack axis coordinate it compiles to (the tag compiler,
   *  `docs/COMPOSER.md` §6). A tag this map does not carry is a refusal, not an empty
   *  coordinate. */
  tags:Record<string,Partial<Record<StackId,AxisCoordinate>>>;
  /** how many complete looks per stack. A menu of 1 is not a decision and is never asked. */
  n?:number;
  /** the Noul band above which a param counts as MOVING — recorded, never inferred.
   *  Unused by the `looks` arm; carried because the seam requires it. */
  movingBand?:number;
}

export class LooksComposer implements Composer {
  readonly id = 'a8os.jev.composer.looks';
  readonly version = 'looks.v1';
  readonly candidateMapVersion = CANDIDATE_MAP_VERSION;
  readonly movingBand:number;
  private lastNotAsked:{stack:StackId;reason:string}[] = [];

  constructor(private opts:LooksComposerOptions) {
    this.movingBand = opts.movingBand ?? 0.5;
  }

  /** What the last step declined to ask, and why — read by the run report. */
  notAsked():{stack:StackId;reason:string}[] { return this.lastNotAsked; }

  nextStep(draft:CompositionDraft, seed:number):ComposerStep|null {
    // Every stack already committed ⇒ nothing left to ask. The spine calls `finish`.
    if (Object.keys(draft.stacks).length > 0) return null;

    const record = this.opts.index.get(draft.recordId);
    const coordinate = this.opts.tags[draft.tag];
    if (!coordinate) throw new Error(
      `no coordinate compiled for tag "${draft.tag}" — a tag is a coordinate ` +
      'and an unknown tag is refused rather than composed at the origin');

    const map = buildCandidateMap(record, coordinate, {n:this.opts.n ?? 6, seed, rosters:this.opts.rosters});
    this.lastNotAsked = map.notAsked;
    if (!Object.keys(map.candidates).length) return null;   // nothing composable — §8

    const state:RecordState = {
      recordId:record.id, family:record.family, tag:draft.tag,
      // §8: the record's own situation sentence. Absent today for every record — the
      // descriptor lift precedes a real bake — and NAMED as absent rather than faked.
      situation:record.situation ?? `${record.label} (no situation sentence yet — descriptor lift pending)`
    };
    const byStack:Partial<Record<StackId,typeof map.candidates[string]>> = {};
    for (const stack of record.stacks) {
      const qid = 'look_' + stack;
      if (map.candidates[qid]) byStack[stack] = map.candidates[qid];
    }
    return {
      kind:'looks',
      request:buildLookRequest(this.opts.model, state, coordinate, byStack),
      candidates:map.candidates,
      extra:{coordinate, notAsked:map.notAsked} as unknown as ComposerStep['extra']
    };
  }
}

/** THE CANDIDATE MAP — what is persisted before the call, and what a chosen id resolves
 *  against afterwards.
 *
 *  Upstream's loop (restated at `roadmap/jevisualeyes-rework.md` §1.4 steps 5–7, and
 *  enforced structurally in `server/jobs.ts`): enumerate 2–255 candidates ALL of which are
 *  valid, **persist the exact pending payload BEFORE the network call**, then call,
 *  validate, and select by the recorded policy. This module is the generalised middle of
 *  that: sampled looks in, the string-valued criteria map out, and the same candidate
 *  array kept beside it so the returned key can be LOOKED UP rather than interpreted.
 *
 *  `specs/ai/jev.md` §10.2 is the rule this exists to make structural: **the model's
 *  returned key is looked up in the persisted candidate map and its recorded effect
 *  applied.** A model-supplied string is never parsed as a param name, a path, or
 *  anything else. `resolveLook` is that lookup and it is the only way in.
 *
 *  VERSIONING: `CANDIDATE_MAP_VERSION` travels on every receipt (`DecisionReceipt
 *  .candidateMapVersion`). It moves whenever the SAMPLED SHAPE moves — a new stack, a new
 *  roster source, a changed role→axis placement, a changed id form — because a receipt
 *  whose candidate map cannot be regenerated is a receipt that cannot be audited.
 *  `ROSTER_VERSION` (`axes.ts`) is the twin for the QUESTION text and menus; the two move
 *  independently on purpose, and the I3 sampler tables are covered by THIS one.
 */
import {ok} from './canon.js';
import {hashJSON} from './hash.js';
import {lookQuestionId, STACK_LABELS} from './axes.js';
import type {AxisCoordinate, LookCandidate, StackId} from './types.js';
import type {RecordDescriptor} from './records.js';
import type {Rosters} from './rosters.js';
import {sampleAllStacks} from './samplers.js';

export const CANDIDATE_MAP_VERSION = 'a8os.jev.candidates.v1';

/** id → the one readable line. This IS a Choice question's `criteria` (`types.ts`
 *  `ChoiceQuestion`): string-valued throughout, never a nested object, because the menu the
 *  model reads must be the menu a human can read back off the receipt. */
export function criteriaFor(looks:LookCandidate[]):Record<string,string> {
  const out:Record<string,string> = {};
  for (const l of looks) {
    ok(!!l.id && !!l.description, 'a candidate with no id or no description is not offerable');
    ok(out[l.id] === undefined, `duplicate candidate id "${l.id}"`);
    out[l.id] = l.description;
  }
  return out;
}

export interface CandidateMap {
  /** question id → its candidates, in the order they were drawn. Persisted verbatim. */
  candidates:Record<string,LookCandidate[]>;
  /** question id → (candidate id → description) — the criteria the request carries. */
  criteria:Record<string,Record<string,string>>;
  /** stacks that produced fewer than 2 options, with why. A single-option menu is not a
   *  decision and is never asked (`requests.ts buildLookRequest` drops it) — but it is
   *  REPORTED here, because a stack silently missing from a bundle is how a capability
   *  disappears without anyone noticing (`GATE-FAILS-OPEN`). */
  notAsked:{stack:StackId;reason:string}[];
  version:string;
  /** hash of the persisted map — the receipt's `candidateHash` is taken over this shape. */
  hash:string;
}

/** Sample every stack this record offers and turn the draw into a persistable map. */
export function buildCandidateMap(record:RecordDescriptor,
                                  coordinate:Partial<Record<StackId,AxisCoordinate>>,
                                  opts:{n:number; seed:number; rosters:Rosters}):CandidateMap {
  const sampled = sampleAllStacks(record, coordinate, opts);
  const candidates:Record<string,LookCandidate[]> = {};
  const criteria:Record<string,Record<string,string>> = {};
  const notAsked:{stack:StackId;reason:string}[] = [];

  for (const stack of record.stacks) {
    const looks = sampled[stack] ?? [];
    const distinct = new Map(looks.map(l => [l.id, l])).size;
    if (distinct < 2) {
      notAsked.push({stack, reason: looks.length
        ? `only ${distinct} distinct look for ${STACK_LABELS[stack]} at this coordinate`
        : `no candidates for ${STACK_LABELS[stack]} — no composable knobs or no roster`});
      continue;
    }
    const qid = lookQuestionId(stack);
    candidates[qid] = looks;
    criteria[qid] = criteriaFor(looks);
  }
  return {candidates, criteria, notAsked, version:CANDIDATE_MAP_VERSION,
          hash:hashJSON(candidates)};
}

/** §10.2 — THE lookup. A key the map does not carry is refused, loudly: it is either a
 *  provider returning something outside the submitted set (which the validator should have
 *  caught) or a map/receipt mismatch, and neither may be papered over. */
export function resolveLook(map:{candidates:Record<string,LookCandidate[]>},
                            questionId:string, chosenId:string):LookCandidate {
  const list = map.candidates[questionId];
  ok(Array.isArray(list) && list.length > 0, `no candidates persisted for "${questionId}"`);
  const hit = list.find(c => c.id === chosenId);
  ok(!!hit, `chosen id "${chosenId}" is not in the persisted candidate map for "${questionId}"`);
  return hit!;
}

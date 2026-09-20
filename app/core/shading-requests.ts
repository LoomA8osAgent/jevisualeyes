/** Request builders for the SHADING compose program — the bank-shaped twin of
 *  `requests.ts buildLookRequest`. Nothing here samples anything; candidates arrive as
 *  arguments and code renders the state (`docs/COMPOSER.md` §1).
 *
 *  CHUNKING: ≤6 questions per request, per `docs/COMPOSER.md` §7.1 — above that the encoder
 *  re-emits the state into every row and a bundle costs MORE than separate calls.
 */
import type {DecisionQuestion, DecisionRequest} from './types.js';
import type {ShadingLook, ShadingCoordinate} from './shading-samplers.js';
import {coordinateLine} from './shading-samplers.js';

export const MAX_QUESTIONS_PER_REQUEST = 6;

/** Split a bank's per-slot candidate lists into ≤6-question request batches. */
export function chunkSlots<T>(items:T[], size = MAX_QUESTIONS_PER_REQUEST):T[][] {
  const out:T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ── CHILD-SLOT PICK — audit item 1: a surface look must CHOOSE, per child bank, which
 *  of that bank's own eleven already-composed slots it uses. One Choice per child bank,
 *  criteria keyed by the SLOT NUMBER itself (so the model's own `choice` IS the chosen
 *  slot — no id-to-slot lookup, nothing to misresolve), described by that slot's own
 *  readable line. ─────────────────────────────────────────────────────────────────── */
export function childPickQuestionId(childGid:string):string {
  return `pick_${childGid.replace(/[^a-z0-9]/gi,'_')}`;
}

export interface ChildBankOption {gid:string; label:string; slots:{slot:number; look:ShadingLook}[]}

/** `alreadyChosen`, when given, names what earlier (constraining) banks already picked FOR
 *  THIS SAME LOOK — so Laya reasons about a coherent combination, not an isolated pick
 *  (operator, 2026-09-20 14:00: order the constraining banks before the constrained ones). */
export function buildChildPickRequest(model:string, coordinate:ShadingCoordinate,
                                      banks:ChildBankOption[],
                                      alreadyChosen:{gid:string; label:string; description:string}[] = []
                                     ):DecisionRequest {
  const questions:Record<string,DecisionQuestion> = {};
  const line = coordinateLine(coordinate);
  for (const {gid, label, slots} of banks) {
    if (slots.length < 2) continue;
    questions[childPickQuestionId(gid)] = {
      type:'choice',
      instructions:`This shading look targets ${line}. Choose which of this part's remaining ` +
        `preset slots (${label}) best realizes that target here, coherent with what has already ` +
        `been chosen for this same look — read each slot's own description and choose one; the ` +
        `slot number you choose is what gets used. Every option offered is already valid — a ` +
        `slot that would form a broken combination with an earlier choice has been removed.`,
      criteria:Object.fromEntries(slots.map(s => [String(s.slot), s.look.description]))
    };
  }
  return {
    model,
    state:{task:'Choose which child preset slot each part of the SHADING accordion should use ' +
      'for this composed look', coordinate,
      alreadyChosen: Object.fromEntries(alreadyChosen.map(a => [a.label, a.description]))},
    questions
  };
}

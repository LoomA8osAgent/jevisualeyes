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

/** One question per slot: an N-way Choice over that slot's candidate looks. */
export function slotQuestionId(gid:string, slot:number):string {
  return `slot_${gid.replace(/[^a-z0-9]/gi,'_')}_${slot}`;
}

export function buildShadingRequest(model:string, bankId:string, bankLabel:string,
                                    slotCandidates:{slot:number; candidates:ShadingLook[]}[]
                                   ):DecisionRequest {
  const questions:Record<string,DecisionQuestion> = {};
  for (const {slot, candidates} of slotCandidates) {
    if (candidates.length < 2) continue; // not a decision
    questions[slotQuestionId(bankId, slot)] = {
      type:'choice',
      instructions:`Choose the complete option that best fills preset slot ${slot} of 11 for ` +
        `this part of the shading. Each option is a full, already-valid setting of every ` +
        `parameter in this part; read the whole description and choose one. The eleven slots ` +
        `on this bank should read as genuinely different looks from one another — favor an ` +
        `option that is distinct from the other slots on this bank over one that reads similar.`,
      criteria:Object.fromEntries(candidates.map(c => [c.id, c.description]))
    };
  }
  return {
    model,
    state:{task:'Fill the factory preset bank for one accordion of the SHADING stack',
      bank:{id:bankId, label:bankLabel}},
    questions
  };
}

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

export function buildChildPickRequest(model:string, coordinate:ShadingCoordinate,
                                      banks:ChildBankOption[]):DecisionRequest {
  const questions:Record<string,DecisionQuestion> = {};
  const line = coordinateLine(coordinate);
  for (const {gid, label, slots} of banks) {
    if (slots.length < 2) continue;
    questions[childPickQuestionId(gid)] = {
      type:'choice',
      instructions:`This shading look targets ${line}. Choose which of this part's eleven ` +
        `already-built preset slots (${label}) best realizes that target here — read each ` +
        `slot's own description and choose one; the slot number you choose is what gets used.`,
      criteria:Object.fromEntries(slots.map(s => [String(s.slot), s.look.description]))
    };
  }
  return {
    model,
    state:{task:'Choose which child preset slot each part of the SHADING accordion should use ' +
      'for this composed look', coordinate},
    questions
  };
}

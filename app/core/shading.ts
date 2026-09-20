/** THE SHADING STACK — group tree + composable knob filtering for the SHARED SHADING
 *  ACCORDION (`specs/ai/decision-models.md` §P2.10, `docs/PLAN.md` §1.0b I5.5).
 *
 *  This is NOT a `StackId` in the record+tag pipeline (`records.ts`/`composer.ts`/`slot.ts`)
 *  — the shading accordion is TEMPLATE state, identical on every composed record, and this
 *  program fills the app's FACTORY bank surface (`a8_sdf_factory_banks`, shipped as the
 *  tracked seed `app/js/formats/_sdf-factory-banks.js` in the consuming app) directly,
 *  rather than one record's source-keyed preset slot (P2.3's canon, unchanged).
 *
 *  THE THREE EXCLUSIONS ARE MECHANICAL (§P2.10.5), applied here and nowhere else so every
 *  consumer (the sampler, the request builder, the deliverer) sees the same filtered set:
 *   · blend modes   — `excluded === 'blend'`
 *   · non-composable menu state (the two live-palette rows) — `composable === false`
 *   · marching / bindings / per-slider presets — absent from `shared.shading` and from this
 *     program's stack set by construction; there is nothing to filter.
 */
import type {Rosters, ShadingGroup, ShadingInput} from './rosters.js';

/** The eleven banks, in the order the accordion nests them — read off the roster's own
 *  group list rather than hardcoded, so a roster change (a new child sub) surfaces here by
 *  re-running, not by editing this repo (the same rule every other roster obeys). */
export function shadingBankIds(rosters:Rosters):string[] {
  return rosters.shading.groups.map(g => g.id);
}

export function shadingGroup(gid:string, rosters:Rosters):ShadingGroup {
  const g = rosters.shading.groups.find(x => x.id === gid);
  if (!g) throw new Error(`no shading group "${gid}" in the roster`);
  return g;
}

/** The ten children the FACTORY surface flattens under `surface`'s `childSlots`
 *  (`decision-models.md` §P2.10.4 Reading A) — every bank except `surface` itself. This is
 *  a FLAT union, not the accordion's own nesting: `sub:light1..3` nest two deep in the app
 *  (under `sub:lighting` at rest, or directly under `surface` when `lightNInStack` is set —
 *  "Inside SHADING either way", §P2.10.1), but the factory bank the app reads
 *  (`A8_GROUP_BANKS`) is keyed per bank id with no further nesting, so all ten sit beside
 *  each other here regardless of the accordion's own display depth. */
export function shadingChildren(rosters:Rosters):string[] {
  return rosters.shading.groups.filter(g => g.id !== 'surface').map(g => g.id);
}

/** The knobs ONE bank draws — the group's own members, minus the two mechanical exclusions.
 *  Never a bind, never a per-slider preset field: neither is emitted by `shared.shading` at
 *  all, so there is nothing here to filter for them. */
export function bankKnobs(gid:string, rosters:Rosters):ShadingInput[] {
  return rosters.shading.inputs.filter(i =>
    i._groupId === gid && i.excluded !== 'blend' && i.composable !== false);
}

/** Every knob key EXCLUDED for a bank, with why — reported so a compose run can prove its
 *  own filter against a set it can see (`decision-models.md` §P2.10.5), never silently. */
export function bankExclusions(gid:string, rosters:Rosters):{name:string; reason:string}[] {
  return rosters.shading.inputs
    .filter(i => i._groupId === gid && (i.excluded === 'blend' || i.composable === false))
    .map(i => ({name:i.NAME, reason: i.excluded === 'blend' ? 'blend mode (excluded:\'blend\')'
      : (i.notComposableReason ?? 'composable:false')}));
}

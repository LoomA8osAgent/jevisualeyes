/** CONSTRAINT FILTERING — operator ruling, 2026-09-20 14:00: "some material modes do not
 *  work with some lighting modes and vice versa … a dead look is never offered." A separate
 *  lane derives `shared.shading.constraints` from the shader and this repo only READS it
 *  (never transcribes which combinations conflict) — see `core/rosters.ts ShadingConstraint`
 *  and `core/shading-samplers.ts violatesConstraint`.
 *
 *  The real field is not published yet (`docs/PLAN.md` §1.0b, 2026-09-20) — this proves the
 *  FILTER MECHANISM against a PLANTED, clearly-marked synthetic constraint set, exactly the
 *  way `server/fixture.ts` plants provider answers rather than waiting on a live one. Once
 *  the real field lands, `compose-shading.mjs`'s own `constraintRemovals` log is the live
 *  proof (asserted by the coordinator's next run, not fabricated here).
 */
import {test, assert} from 'vitest';
import {violatesConstraint} from '../core/shading-samplers.js';
import type {ShadingConstraint} from '../core/rosters.js';

// PLANTED, not real: "material mode 7 (matcap) is incompatible with light1Type 3 (spot)".
const PLANTED:ShadingConstraint[] = [
  {rows:[{group:'sub:material', row:'materialType', option:7}, {group:'sub:light1', row:'light1Type', option:3}],
   verdict:'incompatible', why:'planted fixture — matcap ignores the spot cone entirely'}
];

test('a candidate that would COMPLETE the planted pair is excluded', () => {
  const chosenSoFar = [{gid:'sub:material', params:{materialType:7}}];
  const bad = violatesConstraint(PLANTED, chosenSoFar, 'sub:light1', {light1Type:3});
  assert.equal(bad, true);
});

test('a candidate that would NOT complete the pair (different light type) is allowed', () => {
  const chosenSoFar = [{gid:'sub:material', params:{materialType:7}}];
  const ok = violatesConstraint(PLANTED, chosenSoFar, 'sub:light1', {light1Type:1});
  assert.equal(ok, false);
});

test('order independence: the material bank is filtered against an ALREADY-chosen light too', () => {
  const chosenSoFar = [{gid:'sub:light1', params:{light1Type:3}}];
  const bad = violatesConstraint(PLANTED, chosenSoFar, 'sub:material', {materialType:7});
  assert.equal(bad, true);
});

test('a rule about two OTHER groups matching is not this candidate\'s to enforce', () => {
  // sub:light2 is not named in the planted rule at all — it must never be filtered by it.
  const chosenSoFar:{gid:string; params:Record<string,unknown>}[] =
    [{gid:'sub:material', params:{materialType:7}}, {gid:'sub:light1', params:{light1Type:3}}];
  const ok = violatesConstraint(PLANTED, chosenSoFar as any, 'sub:light2', {light2Type:9});
  assert.equal(ok, false);
});

test('no rows chosen yet: a lone candidate can never itself complete a 2-row pair', () => {
  const bad = violatesConstraint(PLANTED, [], 'sub:material', {materialType:7});
  assert.equal(bad, false);
});

test('an INERT verdict is excluded exactly like INCOMPATIBLE — both are "never offered"', () => {
  const inert:ShadingConstraint[] = [{...PLANTED[0], verdict:'inert'}];
  const chosenSoFar = [{gid:'sub:material', params:{materialType:7}}];
  assert.equal(violatesConstraint(inert, chosenSoFar, 'sub:light1', {light1Type:3}), true);
});

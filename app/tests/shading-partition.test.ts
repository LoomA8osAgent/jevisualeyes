/** THE PARTITION INVARIANT — a child bank's 11 slots must map BIJECTIVELY onto the 11
 *  surface looks (operator ruling, 2026-09-20 13:56: "the whole point of this exercise is
 *  to NOT have duplicate looks"). `compose-shading.mjs` drives the exact same three
 *  functions asserted here (`newPartitionState`/`availableSlots`/`forcedSlot`/`commitPick`)
 *  with a live Choice call in place of the deterministic stub below — the invariant is
 *  provable without a network call because it is a property of the REDUCTION, not of what
 *  a model happens to pick.
 */
import {test, assert} from 'vitest';
import {newPartitionState, availableSlots, forcedSlot, commitPick} from '../core/shading-samplers.js';

const SLOTS = 11;
const ALL = Array.from({length:SLOTS}, (_,i) => i+1);

/** A deterministic stub "decision": always the LOWEST remaining slot — proves the
 *  invariant holds regardless of WHICH available slot a chooser picks. */
function driveOneChild(gid:string, looks:number, chooser:(available:number[], look:number)=>number) {
  const state = newPartitionState([gid]);
  const picks:number[] = [];
  for (let k = 1; k <= looks; k++) {
    const avail = availableSlots(state, gid, ALL);
    const forced = forcedSlot(avail);
    const slot = forced ?? chooser(avail, k);
    commitPick(state, gid, slot, avail);
    picks.push(slot);
  }
  return {state, picks};
}

test('lowest-first chooser: the used set after 11 looks is exactly {1..11}', () => {
  const {state, picks} = driveOneChild('bank-a', SLOTS, (avail) => avail[0]);
  assert.equal(new Set(picks).size, SLOTS, 'every pick must be distinct');
  const used = [...state.used['bank-a']].sort((a,b) => a-b);
  assert.deepEqual(used, ALL);
});

test('highest-first chooser: the used set after 11 looks is exactly {1..11}', () => {
  const {state, picks} = driveOneChild('bank-b', SLOTS, (avail) => avail[avail.length-1]);
  assert.equal(new Set(picks).size, SLOTS);
  const used = [...state.used['bank-b']].sort((a,b) => a-b);
  assert.deepEqual(used, ALL);
});

test('a random-index chooser still yields the full partition, seeded for determinism', () => {
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const {state, picks} = driveOneChild('bank-c', SLOTS,
    (avail) => avail[Math.floor(rnd() * avail.length)]);
  assert.equal(new Set(picks).size, SLOTS);
  const used = [...state.used['bank-c']].sort((a,b) => a-b);
  assert.deepEqual(used, ALL);
});

test('the menu shrinks by exactly one look over look: 11,10,9…1, and a singleton is FORCED', () => {
  const state = newPartitionState(['bank-d']);
  const menuSizes:number[] = [];
  const forcedAt:number[] = [];
  for (let k = 1; k <= SLOTS; k++) {
    const avail = availableSlots(state, 'bank-d', ALL);
    menuSizes.push(avail.length);
    const forced = forcedSlot(avail);
    if (forced !== null) forcedAt.push(k);
    const slot = forced ?? avail[0];
    commitPick(state, 'bank-d', slot, avail);
  }
  assert.deepEqual(menuSizes, [11,10,9,8,7,6,5,4,3,2,1]);
  assert.deepEqual(forcedAt, [11], 'only the last look ever sees a singleton menu');
});

test('commitPick refuses a slot that was not in the offered menu', () => {
  const state = newPartitionState(['bank-e']);
  const avail = availableSlots(state, 'bank-e', ALL);
  assert.throws(() => commitPick(state, 'bank-e', 999, avail), /was not in the offered menu/);
});

test('ten independent banks, driven by DIFFERENT choosers, each partition fully and independently', () => {
  const gids = Array.from({length:10}, (_,i) => `bank-${i}`);
  const state = newPartitionState(gids);
  for (const gid of gids) {
    for (let k = 1; k <= SLOTS; k++) {
      const avail = availableSlots(state, gid, ALL);
      const forced = forcedSlot(avail);
      const slot = forced ?? avail[(k * 3) % avail.length];
      commitPick(state, gid, slot, avail);
    }
  }
  for (const gid of gids) assert.deepEqual([...state.used[gid]].sort((a,b)=>a-b), ALL);
});

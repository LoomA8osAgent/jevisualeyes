/** THE TAG COMPILER — a tag IS a coordinate, expressed in the axis words themselves.
 *
 *  `docs/COMPOSER.md` §6: "There are no named styles. A style is a COORDINATE in a
 *  parameter space." So a tag is not a name that a table maps to a coordinate — a named tag
 *  would be a named style wearing a lookup, and the table would be the place the style name
 *  lived. A tag is written `axis:word`, in the axis vocabulary the roster already carries,
 *  and compiling it is a projection onto each stack's own axes (`axes.ts STACK_AXES`) and
 *  nothing more. No word is minted here; every one of them is validated against `AXES`.
 *
 *  An axis the tag does not name is left UNCONSTRAINED — absent from the coordinate, which
 *  is what `any` means in §6: the sampler draws across the whole range rather than toward a
 *  hidden middle. An axis or word the roster does not carry is a REFUSAL naming both, never
 *  a silently dropped token: a mistyped tag that composed at the origin would look like a
 *  composition and be one nobody asked for.
 */
import {ok} from './canon.js';
import {AXES, STACKS, STACK_AXES} from './axes.js';
import type {AxisCoordinate, StackId} from './types.js';

export interface CompiledTag {
  /** the tag as written. */
  tag:string;
  /** axis id → the situation word, for every axis the tag named. */
  words:AxisCoordinate;
  /** stack id → the subset of `words` that stack's own axes answer to. */
  byStack:Partial<Record<StackId,AxisCoordinate>>;
}

/** Split on whitespace and commas; every token must be `axis:word`. */
export function parseTagWords(tag:string):AxisCoordinate {
  const tokens = String(tag).split(/[\s,]+/).filter(Boolean);
  ok(tokens.length > 0, 'a tag is a coordinate and an empty tag names none');
  const words:AxisCoordinate = {};
  for (const t of tokens) {
    const i = t.indexOf(':');
    ok(i > 0 && i < t.length - 1,
      `tag token "${t}" is not "axis:word" — a tag is a coordinate, not a style name (docs/COMPOSER.md §6)`);
    const axis = t.slice(0, i), word = t.slice(i + 1);
    const known = AXES[axis];
    ok(!!known, `tag names axis "${axis}", which is not in the axis roster [${Object.keys(AXES).join(', ')}]`);
    ok(known.options.some(o => o.id === word),
      `tag names "${axis}:${word}", which is not one of that axis's words [${known.options.map(o => o.id).join(', ')}]`);
    ok(words[axis] === undefined, `tag names axis "${axis}" twice`);
    // `any` is the roster's own word for "left free", and §6 keeps it OUT of the
    // coordinate rather than in it as a position: an unconstrained axis draws across the
    // whole range, and an entry would be a preference.
    if (word !== 'any') words[axis] = word;
  }
  return words;
}

/** Compile a tag onto the stacks a record offers (or every stack, when none are given). */
export function compileTag(tag:string, stacks:StackId[] = STACKS):CompiledTag {
  const words = parseTagWords(tag);
  const byStack:Partial<Record<StackId,AxisCoordinate>> = {};
  for (const stack of stacks) {
    const coord:AxisCoordinate = {};
    for (const axis of STACK_AXES[stack]) if (words[axis]) coord[axis] = words[axis];
    byStack[stack] = coord;
  }
  return {tag, words, byStack};
}

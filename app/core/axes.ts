/** THE AXIS ROSTER — coordinates, not names (`specs/ai/jev.md` §6).
 *
 *  The upstream file this replaces states the pattern verbatim: "there are no named
 *  styles; a style is a coordinate in a parameter space, and code samples concrete
 *  renderings from the chosen point." Its axes are replaced by the A8os six; the SHAPE — `{id,label,options[]}` plus an `any` option meaning "this axis is left
 *  unconstrained" — is unchanged.
 *
 *  Why this satisfies `SUBSTRATE-LEAKS-INTO-USER-TAXONOMY` structurally rather than by
 *  discipline: there is no family name, group id, route, or substrate word anywhere in a
 *  menu, because the menus ARE axes. Expanding coverage means adding an axis VALUE or a
 *  sampler branch — never a named style.
 *
 *  ⚠ WHERE THIS LIVES, and why it lives here FOR NOW. `jev.md` §6 says the axis
 *  vocabulary lives in `app/js/jev-roster.js` and that a consumer READS it rather than
 *  transcribing it (`SHARED-CANON-DUPLICATED-PER-ENGINE`). That file DOES NOT EXIST yet
 *  — only PART 1's node-side roster (`tools/hooks/lib/judgment-roster.js`) is built. So
 *  this module is the FIRST home of the PART 2 vocabulary, not a second copy of one. When
 *  `jev-roster.js` lands it is authored in the dual-export idiom (`jev.md` §3), and this
 *  file becomes a `require()` of it — never a synchronized twin.
 *
 *  EVERY CHANGE TO ANY VALUE BELOW BUMPS `ROSTER_VERSION` (L10, §11). A changed prompt
 *  or menu that does not move the version is an invisible change, and an invisible change
 *  to a question is an invisible change to every receipt downstream.
 */
import type {StackId} from './types.js';

export const ROSTER_VERSION = 'a8os.jev.roster.v1';

export interface AxisOption {id:string; label:string}
export interface Axis {id:string; label:string; options:AxisOption[]}
/** axis id → the chosen situation word. */
export type Coordinate = Record<string,string>;

const ANY:AxisOption = {id:'any',label:'Unrestricted'};

/** The six axes. Situation words throughout — never units, never a measurement (L4). */
export const AXES:Record<string,Axis> = {
  motion:{id:'motion',label:'Motion',options:[
    {id:'still',label:'Still — nothing moves'},
    {id:'slow',label:'Slow drift'},
    {id:'pulse',label:'Pulsing — periodic swell'},
    {id:'driving',label:'Driving — constant insistent movement'},
    ANY]},
  density:{id:'density',label:'Density',options:[
    {id:'sparse',label:'Sparse — few elements, much empty field'},
    {id:'medium',label:'Moderate'},
    {id:'busy',label:'Busy — the field is crowded'},
    ANY]},
  contrast:{id:'contrast',label:'Contrast',options:[
    {id:'flat',label:'Flat — soft, low separation'},
    {id:'moderate',label:'Moderate'},
    {id:'hard',label:'Hard — sharp edges, strong separation'},
    ANY]},
  warmth:{id:'warmth',label:'Warmth',options:[
    {id:'cold',label:'Cold'},
    {id:'neutral',label:'Neutral'},
    {id:'warm',label:'Warm'},
    ANY]},
  order:{id:'order',label:'Order',options:[
    {id:'chaotic',label:'Chaotic — no discernible repeat'},
    {id:'loose',label:'Loose — a repeat that wanders'},
    {id:'regular',label:'Regular — a clear repeat'},
    {id:'crystalline',label:'Crystalline — exact, lattice-like'},
    ANY]},
  depth:{id:'depth',label:'Depth',options:[
    {id:'flat',label:'Flat — reads as a surface'},
    {id:'shallow',label:'Shallow — slight relief'},
    {id:'deep',label:'Deep — recedes into the frame'},
    ANY]}
};

/** Each stack answers ONLY the axes that mean something for it (`jev.md` §6). */
export const STACK_AXES:Record<StackId,string[]> = {
  shape:['density','contrast','order'],
  mathops:['motion','order','depth'],
  shade:['contrast','warmth','depth'],
  layers:['warmth','density'],
  fx:['contrast','motion'],
  modulation:['motion']
};

export const STACK_LABELS:Record<StackId,string> = {
  shape:'the shape\'s own parameters',
  mathops:'the screen-space math operators',
  shade:'the raymarch shading operators',
  layers:'the background and fill layers',
  fx:'the post-pass effect chain',
  modulation:'which parameters move'
};

export const STACKS:StackId[] = Object.keys(STACK_AXES) as StackId[];

/** THE QUESTION TEXT, versioned beside the menus it belongs to (§11) — the one home.
 *  Upstream kept these in `requests.ts`; the plan moves them to the roster so there is
 *  never a second copy of a question (`CANON-VALUE-IN-PROSE`). */
export const PROMPT_VERSIONS = {
  axes:'axes.v1', looks:'looks.v1', motionMoving:'motion-moving.v1',
  motionWaveform:'motion-waveform.v1', motionRate:'motion-rate.v1'
} as const;

export const INSTRUCTIONS = {
  axes:'Place this aspect of the image on the given axis for the requested look. The axes jointly describe one coherent image; choose values that together realize the request rather than any single safe default. Choose "Unrestricted" only when the requested look genuinely leaves this aspect free. Do not assume that an independent question sees another answer.',
  looks:'Choose the complete option that best realizes the requested look for this part of the image. Each option is a full, already-valid setting of every parameter in this part — read the whole description and choose one; do not assemble a preference out of pieces of several.',
  motionMoving:'Should this parameter be animated for the requested look? High means it should move; low means it should be held still.',
  motionWaveform:'Choose the shape of the movement for this parameter, given the requested motion character.',
  motionRate:'Place the speed of this parameter\'s movement on the given ladder, relative to the requested motion character.'
} as const;

/** The axis question id — one per (stack, axis). Parsed back on commit. */
export const axisQuestionId = (stack:StackId, axis:string) => `axis_${stack}_${axis}`;
/** The look question id — one per stack. */
export const lookQuestionId = (stack:StackId) => `look_${stack}`;
/** The motion question ids — one triple per candidate moving parameter. */
export const movingQuestionId = (param:string) => `moving_${param}`;
export const waveformQuestionId = (param:string) => `waveform_${param}`;
export const rateQuestionId = (param:string) => `rate_${param}`;

/** Inverse of `axisQuestionId`. Split on the FIRST underscore after the prefix: stack
 *  ids carry no underscore, axis ids carry no underscore, so this is unambiguous. */
export function parseAxisQuestionId(qid:string):{stack:StackId;axis:string}|null {
  const m=/^axis_([a-z]+)_([a-z]+)$/.exec(qid);
  if(!m)return null;
  const stack=m[1] as StackId;
  if(!(stack in STACK_AXES)||!(m[2] in AXES))return null;
  return {stack,axis:m[2]};
}
export const parseLookQuestionId = (qid:string):StackId|null => {
  const m=/^look_([a-z]+)$/.exec(qid);
  return m&&(m[1] in STACK_AXES)?m[1] as StackId:null;
};

/** The rate ladder — ORDERED situation words, never units (L4). Turning a returned
 *  ordinal into an actual Hz value is arithmetic, and arithmetic is done IN CODE (L2). */
export const RATE_LADDER:string[] = [
  'Barely moves — one pass takes a long while',
  'Slow',
  'Moderate',
  'Fast',
  'Very fast — visibly hurried'
];

/* ── THE SAMPLER'S READING OF A COORDINATE (I3) ────────────────────────────────────
 *
 *  An axis value is a WORD, and a sampler needs a PLACE IN A RANGE. These two small
 *  tables are that translation and nothing more: they add no seventh axis, no named
 *  style, and no vocabulary the menus do not already carry (`jev.md` §6 —
 *  `SUBSTRATE-LEAKS-INTO-USER-TAXONOMY` stays satisfied structurally, because expanding
 *  coverage means adding an axis VALUE or a sampler branch, never a style name).
 *
 *  They are HERE, in the roster, for the same reason the question text is: one versioned
 *  home (§11). Every change below bumps ROSTER_VERSION.
 */

/** axis id → (option id → where in a knob's range that word sits, 0 = MIN, 1 = MAX).
 *  `any` is deliberately ABSENT: an unconstrained axis draws across the whole range,
 *  which is what "this aspect is left free" means — not a hidden preference for the middle. */
export const AXIS_POSITION:Record<string,Record<string,number>> = {
  motion:  {still:0.06, slow:0.3,  pulse:0.6,     driving:0.9},
  density: {sparse:0.18, medium:0.5, busy:0.85},
  contrast:{flat:0.18,  moderate:0.5, hard:0.85},
  warmth:  {cold:0.15,  neutral:0.5, warm:0.85},
  order:   {chaotic:0.1, loose:0.38, regular:0.7, crystalline:0.95},
  depth:   {flat:0.1,   shallow:0.4, deep:0.85}
};

/** How wide a band around that place the sampler draws from, so N candidates at one
 *  coordinate are genuinely DIFFERENT looks rather than N copies of a point (upstream's
 *  `humanize`, `docs/upstream/02`). Unconstrained axes ignore it and draw [0,1]. */
export const AXIS_SPREAD = 0.22;

/** knob ROLE → the axis whose situation words move it, and the SENSE (+1: the axis's
 *  "more" end is the knob's MAX end; -1: it is the knob's MIN end).
 *
 *  The role keys are READ from the app at runtime, never listed here — they are
 *  `_ROLE_NAME` in `app/js/formats/_sdf-math.js` (`auditLiterals`, the literal-auditor
 *  that mints ~49.5% of the corpus's knobs under ONE shared role table). This map is the
 *  only new judgement: which of the six axes each of those roles answers to. A role with
 *  no row here is simply unbiased — the sampler draws it across its whole range, which is
 *  the honest reading of "this coordinate says nothing about this knob".
 */
export const ROLE_AXIS:Record<string,{axis:string;sense:1|-1}> = {
  frequency:  {axis:'density',  sense:1},   // more harmonics ⇒ a busier field
  iterations: {axis:'density',  sense:1},   // more iterations ⇒ more structure per unit
  dimension:  {axis:'density',  sense:-1},  // bigger elements ⇒ fewer of them in frame
  isoLevel:   {axis:'density',  sense:-1},  // a higher threshold thins the solid
  minRadius:  {axis:'density',  sense:-1},
  exponent:   {axis:'contrast', sense:1},   // a steeper falloff ⇒ harder separation
  bailout:    {axis:'contrast', sense:1},
  coefficient:{axis:'contrast', sense:1},   // term weight ⇒ how strongly it reads
  divisor:    {axis:'contrast', sense:-1},
  foldLimit:  {axis:'order',    sense:1},   // folds ⇒ a clear repeat
  rotation:   {axis:'order',    sense:-1},  // fold rotation ⇒ the repeat wanders
  phase:      {axis:'order',    sense:-1},
  planeOffset:{axis:'order',    sense:-1},
  offset:     {axis:'order',    sense:-1},
  scale:      {axis:'depth',    sense:1}
};

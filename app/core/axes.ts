/** THE AXIS ROSTER — coordinates, not names (`docs/COMPOSER.md` §6).
 *
 *  There are no named styles: a style is a coordinate in a parameter space, and code samples
 *  concrete renderings from the chosen point. The shape — `{id,label,options[]}` plus an `any`
 *  option meaning "this axis is left unconstrained" — is the whole vocabulary.
 *
 *  Why this is structural rather than a discipline: there is no family name, group id, route,
 *  or substrate word anywhere in a menu, because the menus ARE axes. Expanding coverage means
 *  adding an axis VALUE or a sampler branch — never a named style.
 *
 *  WHERE THIS LIVES, and why it lives here FOR NOW. The consuming app is the eventual home of
 *  the axis vocabulary, and a consumer READS it rather than transcribing it. That app-side
 *  roster does not exist yet, so this module is the FIRST home of the vocabulary, not a second
 *  copy of one. When the app-side roster lands, this file becomes a read of it — never a
 *  synchronized twin.
 *
 *  EVERY CHANGE TO ANY VALUE BELOW BUMPS `ROSTER_VERSION` (`docs/COMPOSER.md` §12). A changed
 *  prompt or menu that does not move the version is an invisible change, and an invisible
 *  change to a question is an invisible change to every receipt downstream.
 */
import type {StackId} from './types.js';

export const ROSTER_VERSION = 'a8os.jev.roster.v2';

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

/** Each stack answers ONLY the axes that mean something for it (`docs/COMPOSER.md` §9).
 *
 *  `material` and `lighting` (I4) deliberately answer ONE axis each — `contrast` for the
 *  mesh material's own gloss/roughness reading, `warmth` for the light rig's colour
 *  temperature — both already fully vocabularied by §6/§6.1 and the `AXIS_POSITION` table.
 *  No axis VALUE was added for either: growing an axis's option list is a menu change this
 *  addition does not need, and the two stacks are honest about being unbiased on every axis
 *  they do not name (`docs/COMPOSER.md` §6 — "a role with no row is simply unbiased"). */
export const STACK_AXES:Record<StackId,string[]> = {
  shape:['density','contrast','order'],
  mathops:['motion','order','depth'],
  shade:['contrast','warmth','depth'],
  layers:['warmth','density'],
  fx:['contrast','motion'],
  modulation:['motion'],
  material:['contrast'],
  lighting:['warmth']
};

export const STACK_LABELS:Record<StackId,string> = {
  shape:'the shape\'s own parameters',
  mathops:'the screen-space math operators',
  shade:'the raymarch shading operators',
  layers:'the background and fill layers',
  fx:'the post-pass effect chain',
  modulation:'which parameters move',
  material:'the mesh material\'s own parameters',
  lighting:'the light rig'
};

export const STACKS:StackId[] = Object.keys(STACK_AXES) as StackId[];

/** THE QUESTION TEXT, versioned beside the menus it belongs to (`docs/COMPOSER.md` §12) —
 *  the ONE home. A question whose text lives in two places is a question that can change in
 *  one of them. */
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
 *  style, and no vocabulary the menus do not already carry (`docs/COMPOSER.md` §6 — the
 *  no-named-styles rule stays satisfied structurally, because expanding coverage means
 *  adding an axis VALUE or a sampler branch, never a style name).
 *
 *  They are HERE, in the roster, for the same reason the question text is: one versioned
 *  home (`docs/COMPOSER.md` §12). Every change below bumps ROSTER_VERSION.
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
 *  coordinate are genuinely DIFFERENT looks rather than N copies of a point
 *  (`docs/COMPOSER.md` §7). Unconstrained axes ignore it and draw [0,1]. */
export const AXIS_SPREAD = 0.22;

/* ── THE FEELING VOCABULARY (the movement half of §6.1) ────────────────────────────
 *
 *  An easing is a movement SHAPE in exactly the sense a waveform is, so the two share one
 *  menu (`samplers.ts movementOptions` → `requests.ts buildMotionRequest`). What a human
 *  types about movement, though, is neither an id nor a waveform name — it is a FEELING:
 *  "springy", "snappy", "drifting". The easing roster already carries the vocabulary that
 *  answers those words, as `family` + `label` (`rosters.ts Easing`), so this table is the
 *  translation and nothing more.
 *
 *  ONE TABLE, and it is the same table §6.1 is: each feeling also names where it sits on the
 *  MOTION axis, so a feeling word is prose that lands on a coordinate exactly the way
 *  "drift" or "insistent" does. There is no second feeling→axis map to drift from this one,
 *  and no named style is introduced — a feeling resolves to a FAMILY the app already ships.
 *
 *  A family with no feeling is simply unspoken-for: the sampler still offers it when the
 *  coordinate is unconstrained, which is the honest reading of "no feeling word selects it".
 *  Every edit here bumps ROSTER_VERSION.
 */
export interface MotionFeeling {
  /** where the feeling sits on the `motion` axis — an axis value, never a new one. */
  motion:string;
  /** the easing families that speak it, strongest first. */
  families:string[];
}
export const MOTION_FEELING:Record<string,MotionFeeling> = {
  held:    {motion:'still',    families:['steps','linear']},
  drifting:{motion:'slow',     families:['sine','quad','cosine']},
  easing:  {motion:'slow',     families:['cubic','quart','circ']},
  springy: {motion:'pulse',    families:['elastic','spring']},
  bouncy:  {motion:'pulse',    families:['back','bounce']},
  snappy:  {motion:'driving',  families:['expo','quint','stepSaw']},
  steady:  {motion:'driving',  families:['linear','saw','triangle']}
};

/** feeling → the families that speak it. */
export const easingFamiliesForFeeling = (feeling:string):string[] =>
  MOTION_FEELING[feeling]?.families.slice() ?? [];
/** family → every feeling it speaks. The same table, read the other way — which is why
 *  there is only one of it. */
export const feelingsForEasingFamily = (family:string):string[] =>
  Object.keys(MOTION_FEELING).filter(f => MOTION_FEELING[f].families.includes(family)).sort();
/** a motion AXIS word → every easing family its feelings name. `any`, an unknown word, or
 *  no word at all yields [] — an unconstrained axis restricts nothing, and the caller reads
 *  [] as "no family preference", never as "no families". */
export const easingFamiliesForMotion = (word:string|undefined):string[] => {
  if (!word || word === 'any') return [];
  const out:string[] = [];
  for (const f of Object.keys(MOTION_FEELING))
    if (MOTION_FEELING[f].motion === word)
      for (const fam of MOTION_FEELING[f].families) if (!out.includes(fam)) out.push(fam);
  return out;
};

/** knob ROLE → the axis whose situation words move it, and the SENSE (+1: the axis's
 *  "more" end is the knob's MAX end; -1: it is the knob's MIN end).
 *
 *  The role keys are READ from the app at runtime, never listed here — they come from the
 *  shared role table of the literal auditor that mints ~49.5% of the corpus's knobs
 *  (`docs/COMPOSER.md` §8.1 bucket D). This map is the
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

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

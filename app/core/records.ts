/** THE RECORD DESCRIPTOR — what the composer is allowed to know about a shape.
 *
 *  `specs/ai/jev.md` §P2.4 is the gate this module implements: the model is given each
 *  knob's MEANING, never its GLSL (L6), and **a knob with no situation description is not
 *  composable — the run refuses it rather than guessing.** So every knob that arrives here
 *  is tagged `composable` or carries the reason it is not, and the samplers hold a
 *  non-composable knob at its DEFAULT and name it in the look's `skipped[]`.
 *
 *  THE SOURCE: `app/user-media/shapes/index.json` — the generated descriptor index
 *  (495 records / 3,844 knobs as measured 2026-09-19). Every input carries
 *  `DEFAULT` / `MIN` / `MAX` / `LABEL`, and 247 of them additionally carry `BIPOLAR`.
 *  The SHAPE is read from the file, never assumed: an unknown extra field is ignored,
 *  a missing bound is a non-composable knob rather than a guessed range.
 *
 *  THE DESCRIPTION FIELD is `DESCRIPTION`, per `specs/isf2-standard.md:143` §6.3 —
 *  "ONE-LINE plain-English guide to what THIS control does *to the image* … the canonical,
 *  machine-readable home for the per-control guide — NOT a source comment block". Its
 *  FORM is `<what it does to the image> — <the MIN end>, <the MAX end>`
 *  (`specs/isf2-standard.md:330` / `jev.md` §P2.4a), and the endpoint half is load-bearing:
 *  a sentence naming both ends carries an ordered ladder, which is what a Score or a Noul
 *  consumes; a sentence naming only the effect composes to a guess.
 *
 *  THE PROVENANCE TAG is `lifted` · `authored` · `proposed` · `role`, and ONLY `lifted`
 *  and `authored` may be composed on (`jev.md` §P2.4a; `specs/isf2-standard.md:339`). The
 *  standard rules that the tag is producer-side bookkeeping living in `A8_PROVENANCE`, not
 *  a per-input field — so this module reads it from a per-record map when one is present
 *  and treats "no tag information at all" as "the file carries only the text", which is
 *  exactly what the standard says a file carries. A knob tagged `proposed` or `role` is
 *  refused the same way an absent sentence is.
 *
 *  ⚠ MEASURED STATE OF THE LIFT, 2026-09-19: the descriptor index carries
 *  `DEFAULT/MIN/MAX/LABEL/BIPOLAR` and NOTHING ELSE — zero situation sentences, so zero
 *  records are composable today. The knob meanings exist as comments in the record SOURCES
 *  and the converter strips them (`roadmap/jevisualeyes-rework.md` §8 risk 1, sized by
 *  `visualeyes/agent-reports/knob-comment-census.md`: 210 lifted-direct · 1,325 lifted-wide
 *  · 408 owed · 1,901 role-minted). That lift PRECEDES a real bake; this module is written
 *  to consume it the day it lands and to report the hole honestly until then.
 */
import {readFileSync} from 'node:fs';
import {ok} from './canon.js';
import type {StackId} from './types.js';
import {loadRosters} from './rosters.js';
import type {Rosters} from './rosters.js';

/* ── what a descriptor entry looks like on disk (read, not assumed) ─────────────── */

interface RawInput {
  DEFAULT:number; MIN:number; MAX:number; LABEL:string;
  BIPOLAR?:boolean;
  /** the situation sentence, once the lift lands (isf2 §6.3). */
  DESCRIPTION?:string;
}
interface RawRecord {
  id:string; label:string; family:string; group:string;
  /** `raymarch` | `either` | `mesh` — the record's own declaration of how it renders. */
  route:string;
  inputs?:Record<string,RawInput>;
  lip?:number; bound?:unknown; march?:unknown;
  /** the citation/derivation prose. NOT a performer situation sentence — see `situation`. */
  source?:string;
  /** per-record sentence provenance, when the producer ships it (isf2 §6.16). */
  A8_PROVENANCE?:{descriptions?:Record<string,string>; situation?:string};
  DESCRIPTION?:string;
  [k:string]:unknown;
}

/* ── the composer-facing shapes ─────────────────────────────────────────────────── */

export type SentenceOrigin = 'lifted'|'authored'|'proposed'|'role';
export const COMPOSABLE_ORIGINS:SentenceOrigin[] = ['lifted','authored'];

export interface Knob {
  name:string; label:string;
  min:number; max:number; default:number; bipolar:boolean;
  /** the situation sentence, or null. Null ⇒ not composable (§P2.4). */
  description:string|null;
  /** the sentence's provenance tag, or null when the file carries only the text. */
  descriptionOrigin:SentenceOrigin|null;
  /** the shared role gloss when the knob was minted by `auditLiterals` (`_sdf-math.js`
   *  `_ROLE_NAME`) — per-knob MEANINGLESS by construction, so it is never a sentence. */
  role:string|null; roleGloss:string|null;
  composable:boolean;
  /** why not, when `composable` is false. Never null when composable is false. */
  skipReason:string|null;
}

export interface RecordDescriptor {
  id:string; label:string; family:string; group:string; route:string;
  /** the record's own one-sentence situation description (`jev.md` §P2.4 `what_it_is`),
   *  or null. The index's `source` field is a CITATION, not a performer sentence, and is
   *  deliberately not substituted for one. */
  situation:string|null;
  lip:number|null;
  knobs:Knob[];
  /** the knobs a sampler may move. */
  composableKnobs:Knob[];
  /** the stacks this record offers (see STACK_SOURCES). */
  stacks:StackId[];
}

export interface RecordIndex {
  path:string; generatedAt:string|null; count:number;
  ids:string[];
  get(id:string):RecordDescriptor;
  has(id:string):boolean;
  /** every record with at least one composable knob — the honest size of the lift. */
  composableIds():string[];
}

/* ── THE PER-STACK KNOB MAPPING (the table, cited) ──────────────────────────────────
 *
 *  A record's own `inputs` are ONE stack. The other five draw their knobs from the shared
 *  rosters, and each roster already declares the post-`G-ONE-NAMESPACE` group id its
 *  controls live under — so the mapping is READ, not asserted (`PER-TYPE-IDENTIFIER-NAMESPACE`:
 *  a capability belongs to the medium, never to a type, and a group id names what the group
 *  IS).
 *
 *  | stack        | knobs come from                                   | group id           |
 *  |--------------|---------------------------------------------------|--------------------|
 *  | `shape`      | the record's own `inputs` map                      | `shape`            |
 *  | `mathops`    | `A8OpsCanon.OP_INPUTS` ∩ `INJECTED_OP_NAMES`      | `symmetry` (all 52 declare it) |
 *  | `shade`      | `A8RaymarchOps.OPS`                                | `raymarch`         |
 *  | `layers`     | `A8LayerCanon.BG_MODES` / `FILL_MODES` + slot hosts| `bg` / `layer:N`   |
 *  | `fx`         | the FX library manifest (`user-media/shaders/fx`)   | `fx`               |
 *  | `modulation` | the record's composable knobs × the LFO waveforms   | — (binds ride the data router) |
 *
 *  The `shade` stack is offered ONLY when the record's own `route` admits a marcher
 *  (`raymarch` or `either`) — a mesh-route record has no raymarch shading hooks to layer
 *  onto, and offering it would be a menu whose every option is inert.
 */
export const STACK_SOURCES:Record<StackId,{from:string;groupId:string|null}> = {
  shape:     {from:'the record\'s own inputs map (user-media/shapes/index.json)', groupId:'shape'},
  mathops:   {from:'A8OpsCanon.OP_INPUTS ∩ INJECTED_OP_NAMES (js/formats/_ops-canon.js:69, :453)', groupId:'symmetry'},
  shade:     {from:'A8RaymarchOps.OPS (js/formats/_raymarch-ops.js:50)', groupId:'raymarch'},
  layers:    {from:'A8LayerCanon BG_MODES / FILL_MODES (js/formats/_layer-canon.js:1345)', groupId:'bg'},
  fx:        {from:'the FX library manifest (user-media/shaders/fx/manifest.json)', groupId:'fx'},
  modulation:{from:'the record\'s composable knobs × the LFO waveform roster (js/lfo-component.js _LF_WAVEFORM_TYPES)', groupId:null}
};

const MARCHING_ROUTES = new Set(['raymarch','either']);

/* ── reading one record ─────────────────────────────────────────────────────────── */

const num = (v:unknown):number|null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

function roleOf(name:string, rosters:Rosters):{role:string;gloss:string}|null {
  // `auditLiterals` mints `<prefix><n>` (pln1, wgt3, frq2 …) and some bare (`iso`, `scl`).
  const m = /^([a-z]+)\d*$/.exec(name);
  if (!m) return null;
  const hit = rosters.roles.find(r => r.prefix === m[1]);
  return hit ? {role:hit.role, gloss:hit.gloss} : null;
}

function toKnob(name:string, raw:RawInput, origins:Record<string,string>, rosters:Rosters):Knob {
  const min = num(raw.MIN), max = num(raw.MAX), def = num(raw.DEFAULT);
  const r = roleOf(name, rosters);
  const tag = origins[name];
  const origin = (tag === 'lifted' || tag === 'authored' || tag === 'proposed' || tag === 'role')
    ? tag as SentenceOrigin : null;
  const description = (typeof raw.DESCRIPTION === 'string' && raw.DESCRIPTION.trim())
    ? raw.DESCRIPTION.trim() : null;

  let skipReason:string|null = null;
  if (min === null || max === null || def === null) skipReason = 'no declared [MIN, MAX] / DEFAULT';
  else if (max <= min) skipReason = `degenerate range [${min}, ${max}]`;
  else if (!description) skipReason = 'no situation sentence (jev.md §P2.4)';
  else if (origin && !COMPOSABLE_ORIGINS.includes(origin))
    skipReason = `sentence provenance "${origin}" is review state, not composable (§P2.4a)`;

  return {
    name, label:raw.LABEL ?? name,
    min:min ?? 0, max:max ?? 0, default:def ?? 0, bipolar:raw.BIPOLAR === true,
    description, descriptionOrigin:origin,
    role:r?.role ?? null, roleGloss:r?.gloss ?? null,
    composable:skipReason === null, skipReason
  };
}

function toDescriptor(raw:RawRecord, rosters:Rosters):RecordDescriptor {
  const prov = raw.A8_PROVENANCE ?? {};
  const origins = (prov.descriptions ?? {}) as Record<string,string>;
  const knobs = Object.entries(raw.inputs ?? {})
    .map(([n,i]) => toKnob(n, i, origins, rosters))
    .sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const composableKnobs = knobs.filter(k => k.composable);

  const stacks:StackId[] = ['shape','mathops','layers','fx'];
  if (MARCHING_ROUTES.has(raw.route)) stacks.splice(2, 0, 'shade');
  if (composableKnobs.length) stacks.push('modulation');

  const situation = (typeof raw.DESCRIPTION === 'string' && raw.DESCRIPTION.trim())
    ? raw.DESCRIPTION.trim()
    : (typeof prov.situation === 'string' && prov.situation.trim() ? prov.situation.trim() : null);

  return {
    id:raw.id, label:raw.label ?? raw.id, family:raw.family ?? '', group:raw.group ?? '',
    route:raw.route ?? '', situation, lip:num(raw.lip),
    knobs, composableKnobs, stacks
  };
}

/* ── the index ──────────────────────────────────────────────────────────────────── */

/** Load the generated descriptor index. `appRoot` is the live app directory — the parent
 *  of `js/` and `user-media/` — and is where the shared rosters are read from too, so one
 *  app tree answers every question a composer asks. */
export function loadRecordIndex(indexPath:string, appRoot:string):RecordIndex {
  const parsed = JSON.parse(readFileSync(indexPath,'utf8')) as {generatedAt?:string;count?:number;records?:RawRecord[]};
  ok(Array.isArray(parsed.records), `${indexPath} has no records array`);
  const rosters = loadRosters(appRoot);
  const raw = new Map<string,RawRecord>();
  for (const r of parsed.records!) if (r && r.id) raw.set(r.id, r);
  const built = new Map<string,RecordDescriptor>();
  const get = (id:string):RecordDescriptor => {
    const hit = built.get(id); if (hit) return hit;
    const r = raw.get(id); ok(!!r, `no record "${id}" in ${indexPath}`);
    const d = toDescriptor(r!, rosters); built.set(id, d); return d;
  };
  return {
    path:indexPath, generatedAt:parsed.generatedAt ?? null, count:raw.size,
    ids:[...raw.keys()],
    get, has:(id:string) => raw.has(id),
    composableIds:() => [...raw.keys()].filter(id => get(id).composableKnobs.length > 0)
  };
}

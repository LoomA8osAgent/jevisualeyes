/** THE RECORD DESCRIPTOR — what the composer is allowed to know about a shape.
 *
 *  `docs/COMPOSER.md` §8 is the gate this module implements: the model is given each
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
 *  THE DESCRIPTION FIELD is `DESCRIPTION` — the ISF2 dialect's own one-line plain-English
 *  guide to what THIS control does *to the image*, and the canonical machine-readable home
 *  for it, never a source comment block (https://github.com/LoomA8osAgent/ISF2). Its FORM is
 *  `<what it does to the image> — <the MIN end>, <the MAX end>` (`docs/COMPOSER.md` §8), and
 *  the endpoint half is load-bearing:
 *  a sentence naming both ends carries an ordered ladder, which is what a Score or a Noul
 *  consumes; a sentence naming only the effect composes to a guess.
 *
 *  THE PROVENANCE TAG is `lifted` · `authored` · `role` · `proposed`, and `proposed` is
 *  review state that may NOT be composed on (`docs/COMPOSER.md` §8.1). The dialect rules
 *  that the tag is producer-side bookkeeping living in the file's provenance block, not
 *  a per-input field — so this module reads it from a per-record map when one is present
 *  and treats "no tag information at all" as "the file carries only the text", which is
 *  exactly what the dialect says a file carries. A knob tagged `proposed` is refused the
 *  same way an absent sentence is.
 *
 *  ⚠ MEASURED STATE OF THE LIFT (index generated 2026-09-19T10:00Z): the mechanical half has
 *  landed — 1,479 of 3,844 knobs carry a `DESCRIPTION`, across 278 of 495 records, which is
 *  essentially the two lifted buckets of the knob census (210 lifted-direct · 1,325
 *  lifted-wide · 408 owed · 1,901 role-minted, `docs/PLAN.md` §2 risk 1). What remains is the
 *  408 that need new prose and the 1,901 that one shared role table covers. This module
 *  consumes whatever has landed and REPORTS the hole for the rest — never guesses at it.
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
  /** the situation sentence, once the lift lands (`docs/COMPOSER.md` §8). */
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
  /** per-record sentence provenance, when the producer ships it (`docs/COMPOSER.md` §8.1). */
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
  /** the situation sentence, or null. Null ⇒ not composable (§8). */
  description:string|null;
  /** the sentence's provenance tag, or null when the file carries only the text. */
  descriptionOrigin:SentenceOrigin|null;
  /** the shared role gloss when the knob was minted by the app's literal auditor — per-knob
   *  MEANINGLESS by construction, so it is never a sentence. */
  role:string|null; roleGloss:string|null;
  composable:boolean;
  /** why not, when `composable` is false. Never null when composable is false. */
  skipReason:string|null;
}

export interface RecordDescriptor {
  id:string; label:string; family:string; group:string; route:string;
  /** the record's own one-sentence situation description (`docs/COMPOSER.md` §8),
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
 *  rosters, and each roster already declares the group id its controls live under — so the
 *  mapping is READ, not asserted: a capability belongs to the medium, never to a card type,
 *  and a group id names what the group IS (`docs/COMPOSER.md` §9).
 *
 *  | stack        | knobs come from                                   | group id           |
 *  |--------------|---------------------------------------------------|--------------------|
 *  | `shape`      | the record's own `inputs` map                      | `shape`            |
 *  | `mathops`    | the warp-op roster ∩ the injected-op names        | `symmetry` (all 52 declare it) |
 *  | `shade`      | the raymarch shading-op roster                     | `raymarch`         |
 *  | `layers`     | the layer canon's bg / fill modes + slot hosts     | `bg` / `layer:N`   |
 *  | `fx`         | the FX library manifest                            | `fx`               |
 *  | `material`   | the mesh-material descriptor roster                | `material`         |
 *  | `lighting`   | the light-rig descriptor roster                    | `lights`           |
 *  | `modulation` | the record's composable knobs × the MOVEMENT roster | — (binds ride the data router) |
 *
 *  The `shade` stack is offered ONLY when the record's own `route` admits a marcher
 *  (`raymarch` or `either`) — a mesh-route record has no raymarch shading hooks to layer
 *  onto, and offering it would be a menu whose every option is inert. Symmetrically,
 *  `material` and `lighting` are offered ONLY when `route` admits a mesh (`mesh` or
 *  `either`) — a pure-raymarch record has no mesh material or three.js light rig to set.
 *
 *  ⚠ material/lighting scope, surfaced not resolved: the artifact carries other shared `_groupId` families
 *  the operator named — `color`/`sub:palette` (scattered per-engine, no single shared-canon
 *  module a composer can read the way `_mesh-material.js` / `_lighting.js` are read) and
 *  `world` / `slices` (`_sdf-template.js`, the compound-SDF instancing lattice — card-family
 *  scoped, not a medium-wide capability the way material/lighting are). Neither is wired
 *  here; a colour/palette stack needs its shared roster built FIRST (`docs/PLAN.md` — not
 *  this repo's call), and world/slice/deform read as SDF-template-specific rather than a
 *  capability every route shares.
 */
export const STACK_SOURCES:Record<StackId,{from:string;groupId:string|null}> = {
  shape:     {from:'the record\'s own inputs map (user-media/shapes/index.json)', groupId:'shape'},
  mathops:   {from:'A8OpsCanon.OP_INPUTS ∩ INJECTED_OP_NAMES (js/formats/_ops-canon.js:69, :453)', groupId:'symmetry'},
  shade:     {from:'A8RaymarchOps.OPS (js/formats/_raymarch-ops.js:50)', groupId:'raymarch'},
  layers:    {from:'A8LayerCanon BG_MODES / FILL_MODES (js/formats/_layer-canon.js:1345)', groupId:'bg'},
  fx:        {from:'the FX library manifest (user-media/shaders/fx/manifest.json)', groupId:'fx'},
  material:  {from:'A8MeshMaterial.INPUTS (js/formats/_mesh-material.js)', groupId:'material'},
  lighting:  {from:'A8Lighting.INPUTS (js/formats/_lighting.js)', groupId:'lights'},
  modulation:{from:'the record\'s composable knobs × the movement roster — the LFO waveform bank plus the easing library, both from user-media/shapes/rosters.json', groupId:null}
};

const MARCHING_ROUTES = new Set(['raymarch','either']);
const MESH_ROUTES = new Set(['mesh','either']);

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
  else if (!description) skipReason = 'no situation sentence (docs/COMPOSER.md §8)';
  else if (origin && !COMPOSABLE_ORIGINS.includes(origin))
    skipReason = `sentence provenance "${origin}" is review state, not composable (§8.1)`;

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
  if (MESH_ROUTES.has(raw.route)) stacks.push('material','lighting');
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
 *  app tree answers every question a composer asks. `artifactPath` overrides where the
 *  exported roster bundle is read from; it is passed through so a caller that configured
 *  one bundle cannot end up composing against a different one here. */
export function loadRecordIndex(indexPath:string, appRoot:string, artifactPath?:string):RecordIndex {
  const parsed = JSON.parse(readFileSync(indexPath,'utf8')) as {generatedAt?:string;count?:number;records?:RawRecord[]};
  ok(Array.isArray(parsed.records), `${indexPath} has no records array`);
  const rosters = loadRosters(appRoot, artifactPath);
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

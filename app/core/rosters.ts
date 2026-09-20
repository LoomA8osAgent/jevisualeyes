/** THE SHARED ROSTERS, READ FROM THE APP — never transcribed.
 *
 *  `docs/COMPOSER.md` §9 is explicit: the rosters are READ from the consuming app's shared
 *  canon and transcribed nowhere. This module is the ONE place that reads them, so a sampler
 *  never holds a copy and a roster change reaches the composer by re-running, not by editing
 *  this repo.
 *
 *  FOUR READ MODES, chosen by what the app file itself offers — in order of preference
 *  (mode 2 is now RETIRED; kept numbered so the modes below still match their history):
 *
 *   1. `require()` — the file already ends `module.exports = API` and loads clean in node.
 *      `app/js/formats/_ops-canon.js` (the warp-op roster) is read this way.
 *   2. a `vm` context with a `window` shim — the file is an IIFE that assigns
 *      `window.X`. No DOM is touched at module scope; the shim exists so the assignment
 *      lands. **Fully RETIRED as of this file's `layers` switch** (below) — nothing left
 *      reads this way, and `readWindowGlobal` is deleted with it, not kept idle for a future
 *      caller that would only reintroduce the transcription risk it existed to avoid.
 *   3. a JSON artifact the app itself generates — the FX roster is the manifest the
 *      library builds over `user-media/shaders/fx/**`, and `user-media/shapes/rosters.json`
 *      is the exported roster bundle (the LFO waveform bank, the easing library with its
 *      sampled curves, the per-card raymarch-op uniform prefix, and — under `.shared` —
 *      the descriptor rows for the raymarch shading-op roster, the mesh-material roster,
 *      the light-rig roster and the layer canon's bg/fill mode lists). The bundle carries
 *      the sha256 of every app source it was read from, so a stale export is detectable
 *      rather than silently composed against — those hashes surface as `Rosters.provenance`
 *      (`docs/COMPOSER.md` §5: a decision nobody can trace to its inputs is not provenance).
 *      ⚠ `raymarchOps`/`material`/`lighting`/`layers` USED TO be Mode-2 window-global reads
 *      of `_raymarch-ops.js` / `_mesh-material.js` (which itself seeded two sibling canons,
 *      `_point-line-texture.js` + `_texmapping-canon.js`, purely to let the IIFE run) /
 *      `_layer-canon.js`. The export now carries the resolved descriptor rows
 *      byte-equivalent to what those reads produced (verified field-for-field against the
 *      app tree before each switch), so all four window-global evaluations are RETIRED.
 *      `layers` carries only the bg/fill MODE lists the roster ever read
 *      (`BG_MODES`/`FILL_MODES`, renamed `bg`/`fill` in the export); the slot-host role
 *      table `_layer-canon.js` also declares had no reader here and is not exported.
 *   4. a NAMED-LITERAL source read — the value is a module-local `var` with no export at
 *      all, so the only non-transcribing way to obtain it is to read the array literal out
 *      of the source by its own name.
 *      ⚠ THE FINDING THIS FILE REPORTED IS HALF CLOSED. Mode 4 used to serve TWO values —
 *      the LFO waveform list and the raymarch-op prefix — and both are now EXPORTED by the
 *      app's own `app/tools/export-rosters.js` into the mode-3 bundle above, which is the
 *      fix the finding asked for. The old named-literal reads are DELETED, not kept as a
 *      fallback: a fallback would let a stale or absent export pass unnoticed, which is the
 *      one thing the loud failure was protecting. ONE user remains — the literal auditor's
 *      shared role table — and it is the same finding, still open.
 *
 *  Everything here is lazily loaded and cached per app root: a bake is a long-lived
 *  process and must not re-parse 800 KB of app source per record.
 */
import {createRequire} from 'node:module';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createContext, runInContext} from 'node:vm';
import {ok} from './canon.js';

const require_ = createRequire(import.meta.url);

/* ── the shapes of what we read ─────────────────────────────────────────────────── */

/** A warp-op descriptor as the app's own warp-op roster declares it. */
export interface OpInput {
  NAME:string; TYPE:string; LABEL:string;
  DEFAULT:number; MIN:number; MAX:number;
  _groupId:string; _groupLabel?:string;
  /** present on companions: they co-surface only while the parent op is active. */
  _glyOpCompanion?:string;
  /** the endpoint-form situation sentence (docs/COMPOSER.md §8) — DESCRIPTION first, TIP
   *  as the legacy fallback (`samplers.ts stackKnobs` case `'mathops'`). */
  DESCRIPTION?:string;
  TIP?:string;
  /** present on an ENUM op: the admissible values + their names, read by `samplers.ts
   *  fromRoster` in place of [MIN, MAX] (I5). */
  VALUES?:unknown[]; LABELS?:string[];
}
export interface ModeDescriptor { key:string; label:string }
export interface FxEntry { id:string; name:string; path:string; category:string }
export interface Waveform { id:string; label:string }

/** An easing as the app's easing library declares it, exported with its curve SAMPLED.
 *
 *  Easings are movement shapes in the same sense waveforms are — which is why they join the
 *  same movement menu (`requests.ts buildMotionRequest`, `samplers.ts movementOptions`). The
 *  vocabulary a feeling word resolves against is the `family` + `label` pair, never the id:
 *  `inElastic` is a NAME, "elastic" is a family a human can hear.
 *
 *  `curve.samples` is the resolved callable at `n` points of t ∈ [0,1], both endpoints
 *  included — the app's own resolver run by its own exporter, so nothing here re-derives an
 *  easing. `form:'declarative'` means the exporter could not resolve the entry to a callable
 *  and RECORDED that in `unresolved` rather than papering over it with a straight line. */
export interface EasingCurve {
  /** the declarative form the app's own resolver switches on. */
  definition:{kind:string; name?:string; gen?:string; powerKey?:string; n?:number; args?:unknown};
  /** the call-site string the app writes into a saved library entry. */
  source?:string;
  form:'samples'|'declarative';
  n?:number;
  samples?:number[];
  /** how the samples were obtained; `resolveFn` is the contract, anything else is a note. */
  samplesFrom?:string;
  note?:string;
  /** why there are no samples. Present only when `form` is `declarative`. */
  unresolved?:string;
}
export interface Easing { id:string; family:string; label:string; kind:string; curve:EasingCurve }

/** WHAT THE EXPORT WAS READ FROM — the bundle's own source hashes, carried through so a
 *  receipt can name which export it composed against (`docs/COMPOSER.md` §5). */
export interface RosterProvenance {
  generated:string; generator:string; artifactPath:string;
  sources:{file:string; sha256:string}[];
}

/** The shape of `user-media/shapes/rosters.json` — the app's own export, read, never restated.
 *  `shared` is the descriptor-row half of the export: the same `RosterInput` shape every
 *  window-global read already produced, so a Mode-3 reader for one of these needs no new
 *  type — it reads `bundle.shared.<name>` exactly where it used to call the app's IIFE. */
interface RosterArtifact {
  generated?:string; generator?:string;
  sources?:{file:string; sha256:string}[];
  waveforms?:Waveform[]; easings?:Easing[]; raymarchBase?:string;
  shared?:{
    camera?:RosterInput[]; ops?:OpInput[]; raymarchOps?:RosterInput[];
    deform?:RosterInput[]; material?:RosterInput[]; lighting?:RosterInput[];
    /** the layer canon's bg/fill MODE lists (`A8LayerCanon BG_MODES`/`FILL_MODES`,
     *  `js/formats/_layer-canon.js`), each `{key,label}` — the same `ModeDescriptor` shape
     *  the retired Mode-2 read produced. */
    layers?:{bg?:ModeDescriptor[]; fill?:ModeDescriptor[]};
    /** the menu-buried enums (`agent-reports/menu-state-inventory.md`) — `scaleMode`,
     *  `sliderBlend`, `opActive.sdf`, `clock.source` today. A 4th `shared.*` shape, keyed by
     *  `key` at read time (see `loadRosters` `need('menus', …)` below). */
    menus?:MenuDescriptor[];
    /** the SHARED SHADING ACCORDION and its ten children (`decision-models.md` §P2.10) —
     *  template state, identical on every composed record, read off the emitted ISF header
     *  rather than transcribed. A 5th `shared.*` shape: unlike the other rosters, this one
     *  carries its own GROUP TREE alongside the flat input list, because the composer needs
     *  to know which bank each knob belongs to and which bank nests under which. */
    shading?:ShadingRoster;
  };
}

/** One accordion/bank in the SHADING tree, as `export-rosters.js shadingRoster()` emits it —
 *  `parent` mirrors the app's own `_groupParent` form verbatim, including the value-aware
 *  lamp object (`{param,map,default}`) for `sub:light1..3`. */
export interface ShadingGroup {
  id:string; label:string;
  parent:string|{param:string;map:Record<string,string>;default:string}|null;
  parentDefault:string|null;
  inStack:string|null;
  toggle:string|null;
  kick:{param:string;to:number}|null;
  counts:{total:number; menuRows:number; enums:number; menuBools:number; excludedBlend:number};
}

/** One knob in the shading tree — the same field set a `RosterInput` carries, plus the
 *  three fields the composer cannot work without HERE: `_menuOnly` (a menu row is a
 *  different surface from a body row), `_groupParent` (the accordion tree, verbatim), and
 *  the two mechanical exclusions `excluded` / `composable`+`notComposableReason`
 *  (`decision-models.md` §P2.10.5's three exclusions — blend, non-composable menu state;
 *  bindings and per-slider presets are absent by construction, not by a flag). */
export interface ShadingInput {
  NAME:string; TYPE:string; LABEL:string; DEFAULT:unknown;
  MIN?:number; MAX?:number; VALUES?:unknown[]; LABELS?:string[];
  DESCRIPTION?:string;
  _groupId:string; _groupLabel?:string;
  _groupParent?:string|{param:string;map:Record<string,string>;default:string}|null;
  _menuOnly?:boolean;
  /** present only on the `*Blend`/`blendSource` name-shaped rows — mechanically excluded,
   *  never drawn, never written into a composed look (§P2.10.5). */
  excluded?:'blend';
  /** `false` only on the two live-app-state rows (`structElemPalette`/`structGapPalette`);
   *  absent/true otherwise. Mechanically excluded exactly like `excluded:'blend'`. */
  composable?:boolean;
  notComposableReason?:string;
}

export interface ShadingRoster {
  subject:{id:string; label:string; route:string; file:string};
  groups:ShadingGroup[];
  inputs:ShadingInput[];
}
/** The literal auditor's role table — role key → [name prefix, the shared gloss]. */
export interface RoleGloss { role:string; prefix:string; gloss:string }

/** One admissible state of a MENU-BURIED enum — a named snapshot field (`scaleMode`,
 *  `sliderBlend`/`groupBlend`, `opActive.sdf`, `card.clock.source`) that the app's preset
 *  walk persists but that never rode an ordinary `INPUT` descriptor
 *  (`agent-reports/menu-state-inventory.md`). `description` is the situation sentence for
 *  THIS value only — composability here is gated per VALUE, never per whole menu, because a
 *  roster can be partially lifted (§8.1 applies member-by-member). */
export interface MenuValue { id:string; label:string; description?:string }
/** A menu-buried value space as `export-rosters.js` emits it: `key` is the short field name
 *  (`scaleMode`, `sliderBlend`, `opActive.sdf`, `clock.source`), `home` is the fully dotted
 *  snapshot path the app writes it under, `source` is the app canon file it was read from. */
export interface MenuDescriptor { key:string; home:string; source:string; values:MenuValue[] }
/** The values of a menu that carry a situation sentence — the ONLY ones a sampler may draw
 *  from (§8). An empty return means the menu exists but nothing on it is composable yet: the
 *  field is never drawn, never defaulted to a guess. */
export function composableMenuValues(menu:MenuDescriptor|undefined):MenuValue[] {
  if (!menu) return [];
  return menu.values.filter(v => typeof v.description === 'string' && v.description.trim().length > 0);
}

/** An input descriptor as the app's own roster emits it — the canonical NAME, bounds and
 *  (where the roster carries one) the situation sentence. */
export interface RosterInput {
  NAME:string; TYPE:string; LABEL:string;
  DEFAULT:unknown; MIN?:number; MAX?:number;
  DESCRIPTION?:string;
  _groupId?:string; _groupLabel?:string;
  /** the op this control belongs to, and (companions only) its parent control. */
  _sdfRmOp?:string; _sdfRmOpCompanion?:string;
  /** present on an ENUM row (`materialType`, `light1Type`, an on/off toggle declared as
   *  VALUES [0,1]): the admissible values + their names, read by `samplers.ts fromRoster`
   *  in place of [MIN, MAX] — the candidate space IS this list (I5). */
  VALUES?:unknown[]; LABELS?:string[];
}

export interface Rosters {
  appRoot:string;
  /** the full warp-op roster + the subset legal on an INJECTED (non-SDF) shader. */
  ops:{all:OpInput[]; injected:OpInput[]; injectedNames:string[]};
  /** the AMOUNT + companion descriptors under the live per-card uniform prefix, as the
   *  raymarch roster itself emits them. These carry `DESCRIPTION` already, so the shade
   *  stack is composable today. */
  raymarchInputs:RosterInput[];
  rmBase:string;
  layers:{bgModes:ModeDescriptor[]; fillModes:ModeDescriptor[]};
  /** the mesh-material descriptor roster (`_mesh-material.js` `A8MeshMaterial.INPUTS`) —
   *  shared between M3DEngine and the SDF submodule's mesh-route mode, so it is read here
   *  once rather than per consumer (SHARED-CANON-DUPLICATED-PER-ENGINE). Some rows still
   *  carry only the pre-`DESCRIPTION` `TIP` field; `stackKnobs`/`fromRoster` reads
   *  `DESCRIPTION ?? TIP` (docs/COMPOSER.md §8.1) — a row with neither is honestly
   *  non-composable, never guessed at. Composability is therefore a live measurement, not a
   *  fixed count: re-run `stackKnobs(record,'material',rosters)` against a current export
   *  rather than trusting any number written here. */
  material:RosterInput[];
  /** the light-rig descriptor roster (`_lighting.js` `A8Lighting.INPUTS`), same shared-canon
   *  shape and the same `DESCRIPTION ?? TIP` rule as `material` above. */
  lighting:RosterInput[];
  fx:FxEntry[];
  waveforms:Waveform[];
  /** the easing library, curves included — the second half of the movement vocabulary. */
  easings:Easing[];
  /** the menu-buried enums, keyed by their own `key` (`scaleMode`, `sliderBlend`,
   *  `opActive.sdf`, `clock.source`). Read `composableMenuValues(rosters.menus[key])` for
   *  the value subset a sampler may draw — never `menu.values` directly (§8). */
  menus:Record<string,MenuDescriptor>;
  /** the SHARED SHADING ACCORDION and its ten children (`decision-models.md` §P2.10) —
   *  a group tree + the flat input list. Template state: identical on every record that
   *  composes. `shading.groups[].id` is the bank key the factory surface uses. */
  shading:ShadingRoster;
  /** the export's own provenance, or null when the bundle was unreadable (then `missing`
   *  names every roster that needed it). */
  provenance:RosterProvenance|null;
  /** prefix → gloss, for the literal-audited knobs minted by `auditLiterals`. */
  roles:RoleGloss[];
  /** what was NOT available in this app tree, with the reason. Never silent. */
  missing:{roster:string;reason:string}[];
}

/* ── the four read modes ────────────────────────────────────────────────────────── */

function readCjs<T>(file:string):T { return require_(file) as T; }

// Mode 2 — a `vm` context with a `window` shim, for an IIFE that assigns `window.<name>` —
// is RETIRED (see the file header). `_layer-canon.js` was its last caller; the layer roster
// now reads Mode 3 (`shared.layers` in the roster bundle) with `need()` below, and no other
// roster ever needed the window-shim path, so `readWindowGlobal` is deleted rather than kept
// idle for a hypothetical future caller.

/** Mode 4 — lift a named array/object literal out of a source file, brace-balanced.
 *  It is a READ of the canon, not a copy of it: the bytes come from the app every run. */
function readNamedLiteral(file:string, name:string):unknown {
  const src = readFileSync(file,'utf8');
  const at = src.indexOf('var ' + name);
  ok(at >= 0, `literal "${name}" not found in ${file} — it was renamed or removed`);
  const open = src.slice(at).search(/[\[{]/) + at;
  const openCh = src[open];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, end = -1, inStr:string|null = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i+1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (!depth) { end = i; break; } }
  }
  ok(end > 0, `literal "${name}" in ${file} is not brace-balanced`);
  // The literal is plain data in both live cases; evaluating it in an EMPTY context is
  // the parse, and anything that reaches for a global there is a failure we want.
  return runInContext('(' + src.slice(open, end + 1) + ')', createContext({}),
    {filename:`${file}#${name}`});
}

/** Mode 3 — the app's own exported roster bundle. A read of a generated artifact, so the
 *  failure modes are file-shaped and stated: absent (the export has never been run against
 *  this tree), unparseable, or present-but-empty. Each is thrown, which routes it into
 *  `missing[]` under the roster that needed it — never defaulted to a transcription. */
function readRosterArtifact(file:string):RosterArtifact {
  ok(existsSync(file),
    `no roster bundle at ${file} — run \`node app/tools/export-rosters.js\` in the app tree`);
  let parsed:unknown;
  try { parsed = JSON.parse(readFileSync(file,'utf8')); }
  catch (e:any) { throw new TypeError(`${file} is not parseable JSON — ${e?.message ?? e}`); }
  ok(!!parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    `${file} is not an object — the export wrote something else`);
  return parsed as RosterArtifact;
}

/** Where the bundle lives, configured exactly the way the descriptor index is
 *  (`server/config.ts` — `JEV_ROSTERS`, defaulting under the same `appRoot`). */
export const rostersArtifactPath = (appRoot:string) =>
  join(appRoot, 'user-media', 'shapes', 'rosters.json');

/* ── the loader ─────────────────────────────────────────────────────────────────── */

const cache = new Map<string,Rosters>();

/** `appRoot` = the live app directory (`<repo>/app`), i.e. the parent of `js/` and
 *  `user-media/`. Whatever is unreadable is REPORTED in `missing`, never defaulted to a
 *  transcription: a sampler with no roster emits no options for that stack
 *  (`docs/COMPOSER.md` §9 — the run refuses rather than guesses). */
export function loadRosters(appRoot:string, artifactPath?:string):Rosters {
  const artifact = artifactPath ?? rostersArtifactPath(appRoot);
  const cacheKey = appRoot + '\u0000' + artifact;
  const hit = cache.get(cacheKey); if (hit) return hit;
  const missing:{roster:string;reason:string}[] = [];
  const attempt = <T>(roster:string, fn:()=>T, fallback:T):T => {
    try { return fn(); } catch (e:any) { missing.push({roster, reason:String(e?.message ?? e)}); return fallback; }
  };
  const F = (...p:string[]) => join(appRoot, ...p);

  const opsApi = attempt('ops',
    () => readCjs<{OP_INPUTS:OpInput[];INJECTED_OP_NAMES:string[]}>(F('js','formats','_ops-canon.js')),
    {OP_INPUTS:[], INJECTED_OP_NAMES:[]});
  const injectedNames = opsApi.INJECTED_OP_NAMES ?? [];
  const all = opsApi.OP_INPUTS ?? [];

  // THE BUNDLE, read once. Every roster that needs it reports its OWN absence through
  // `need` below, so `missing` says which menu is empty and not merely which file is.
  const bundle = attempt('rosters.json', () => readRosterArtifact(artifact), null as RosterArtifact|null);
  const need = <T>(roster:string, pick:(a:RosterArtifact)=>T, fallback:T):T => attempt(roster, () => {
    ok(!!bundle, `requires the roster bundle at ${artifact}, which was not readable`);
    return pick(bundle!);
  }, fallback);

  const rmBase = need('rmBase', a => {
    ok(typeof a.raymarchBase === 'string' && !!a.raymarchBase,
      'the bundle carries no `raymarchBase` — the export is stale or was truncated');
    return a.raymarchBase!;
  }, '');
  // Mode 3 — this used to be a Mode-2 evaluation of `_raymarch-ops.js` (seeded with
  // `A8OpsCanon`) calling its own `rosterInputs(rmBase)`. The export's `shared.raymarchOps`
  // is that same call's own return value, byte-equivalent field-for-field (verified against
  // the app tree), so the window-global evaluation is retired — nothing in this repo ever
  // read the raw `OPS` array (`hook`/`fn`/`identity`) the IIFE also exposed, so it is gone
  // too rather than carried as a field with no reader.
  const raymarchInputs = need('raymarchInputs', a => {
    ok(Array.isArray(a.shared?.raymarchOps) && a.shared!.raymarchOps!.length > 0,
      'the bundle carries no `shared.raymarchOps` — the export is stale or the raymarch roster moved');
    return a.shared!.raymarchOps!;
  }, [] as RosterInput[]);

  // Mode 3 — this used to be a Mode-2 evaluation of `_layer-canon.js` reading
  // `A8LayerCanon.BG_MODES`/`FILL_MODES` off the window shim. The export's `shared.layers`
  // (`{bg, fill}`) carries the same two mode lists, byte-equivalent field-for-field
  // (verified against the app tree), so the last live window-global read retires here.
  const layers = need('layers', a => {
    ok(Array.isArray(a.shared?.layers?.bg) && a.shared!.layers!.bg!.length > 0,
      'the bundle carries no `shared.layers.bg` — the export is stale or the layer canon moved');
    ok(Array.isArray(a.shared?.layers?.fill) && a.shared!.layers!.fill!.length > 0,
      'the bundle carries no `shared.layers.fill` — the export is stale or the layer canon moved');
    return {bgModes:a.shared!.layers!.bg!, fillModes:a.shared!.layers!.fill!};
  }, {bgModes:[] as ModeDescriptor[], fillModes:[] as ModeDescriptor[]});

  // Mode 3 — `material`/`lighting` used to be Mode-2 evaluations of `_mesh-material.js`
  // (itself seeding two sibling canons at module scope, `_point-line-texture.js` +
  // `_texmapping-canon.js`, purely so the IIFE would run) and `_lighting.js`. The export's
  // `shared.material` / `shared.lighting` are those same `.INPUTS` arrays (verified
  // field-for-field against the app tree — the only drop is `_menuOnly`/`_lightHeader`/
  // `_light`, none of which any reader in this repo ever touched), so all three window-global
  // evaluations retire together.
  const material = need('material', a => {
    ok(Array.isArray(a.shared?.material) && a.shared!.material!.length > 0,
      'the bundle carries no `shared.material` — the export is stale or the mesh-material roster moved');
    return a.shared!.material!;
  }, [] as RosterInput[]);

  const lighting = need('lighting', a => {
    ok(Array.isArray(a.shared?.lighting) && a.shared!.lighting!.length > 0,
      'the bundle carries no `shared.lighting` — the export is stale or the light-rig roster moved');
    return a.shared!.lighting!;
  }, [] as RosterInput[]);

  const fx = attempt('fx', () => {
    const p = F('user-media','shaders','fx','manifest.json');
    ok(existsSync(p), `no fx manifest at ${p}`);
    const m = JSON.parse(readFileSync(p,'utf8')) as {items:{name:string;path:string}[]};
    return (m.items ?? []).map(it => ({
      id:it.path, name:it.name, path:it.path,
      category:it.path.includes('/') ? it.path.slice(0, it.path.indexOf('/')) : 'fx'
    }));
  }, [] as FxEntry[]);

  const waveforms = need('waveforms', a => {
    ok(Array.isArray(a.waveforms) && a.waveforms.length > 0,
      'the bundle carries no waveforms — the export is stale or the LFO roster moved');
    return a.waveforms!;
  }, [] as Waveform[]);

  const easings = need('easings', a => {
    ok(Array.isArray(a.easings) && a.easings.length > 0,
      'the bundle carries no easings — the export is stale or the easing library moved');
    return a.easings!;
  }, [] as Easing[]);

  // Mode 3 — the menu-buried enums (`agent-reports/menu-state-inventory.md`): named snapshot
  // fields the preset walk persists that never rode an ordinary INPUT descriptor. Keyed by
  // `key` here so a caller reads `rosters.menus['scaleMode']` the same way it reads any other
  // shared roster, never re-scanning the array.
  const menus = need('menus', a => {
    ok(Array.isArray(a.shared?.menus) && a.shared!.menus!.length > 0,
      'the bundle carries no `shared.menus` — the export is stale or has not run the menu reader yet');
    const out:Record<string,MenuDescriptor> = {};
    for (const m of a.shared!.menus!) out[m.key] = m;
    return out;
  }, {} as Record<string,MenuDescriptor>);

  // Mode 3 — the SHARED SHADING ACCORDION (`decision-models.md` §P2.10). Its own group
  // tree travels WITH the flat input list, so `need` reads the whole `shared.shading`
  // object rather than a single field.
  const shading = need('shading', a => {
    ok(Array.isArray(a.shared?.shading?.groups) && a.shared!.shading!.groups!.length > 0,
      'the bundle carries no `shared.shading.groups` — the export is stale or has not run the shading reader yet');
    ok(Array.isArray(a.shared?.shading?.inputs) && a.shared!.shading!.inputs!.length > 0,
      'the bundle carries no `shared.shading.inputs` — the export is stale or the shading accordion moved');
    return a.shared!.shading!;
  }, {subject:{id:'',label:'',route:'',file:''}, groups:[], inputs:[]} as ShadingRoster);

  const provenance:RosterProvenance|null = bundle ? {
    generated:String(bundle.generated ?? ''), generator:String(bundle.generator ?? ''),
    artifactPath:artifact, sources:(bundle.sources ?? []).map(x => ({file:x.file, sha256:x.sha256}))
  } : null;

  const roles = attempt('roles', () => {
    const t = readNamedLiteral(F('js','formats','_sdf-math.js'),'_ROLE_NAME') as Record<string,[string,string]>;
    return Object.entries(t).map(([role,[prefix,gloss]]) => ({role, prefix, gloss}));
  }, [] as RoleGloss[]);

  const r:Rosters = {
    appRoot,
    ops:{all, injectedNames, injected:all.filter(o => injectedNames.includes(o.NAME))},
    raymarchInputs, rmBase, layers, material, lighting, fx, waveforms, easings, menus, shading,
    provenance, roles, missing
  };
  cache.set(cacheKey, r);
  return r;
}

/* ── reading a curve's SHAPE off its own samples ─────────────────────────────────── */

/** The three shapes a movement curve can have, told apart by looking at the exported
 *  samples — never by the entry's NAME. A name is a label; the samples are the behaviour,
 *  and `family:'sine'` legitimately holds both a one-shot ease-in and a full cycle. */
export type CurveShape = 'monotonic'|'overshoot'|'oscillating';

/** ±1e-3 — the samples are rounded to 6dp by the exporter, so anything under this is the
 *  rounding, not a turn. */
const CURVE_EPS = 1e-3;

/** Read a curve's shape from its samples. Three lines of arithmetic, no library:
 *
 *   · `monotonic`   — it never changes direction: a one-shot move from A to B.
 *   · `overshoot`   — it leaves [0,1] and comes back, in at most two turns: it arrives by
 *                     passing its target (back, spring).
 *   · `oscillating` — anything else: it turns repeatedly, or it returns to where it began,
 *                     which is a cycle (elastic, bounce, and the waveform-shaped eases).
 *
 *  A curve with no samples (`form:'declarative'`, the exporter could not resolve it) has no
 *  readable shape and returns `null` — the honest answer, never a guessed straight line. */
export function curveShape(curve:EasingCurve):CurveShape|null {
  const s = curve.samples;
  if (curve.form !== 'samples' || !Array.isArray(s) || s.length < 2) return null;
  let turns = 0, last = 0;
  let out = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] < -CURVE_EPS || s[i] > 1 + CURVE_EPS) out = true;
    if (i === 0) continue;
    const d = s[i] - s[i-1];
    if (Math.abs(d) <= CURVE_EPS) continue;
    const sign = d > 0 ? 1 : -1;
    if (last && sign !== last) turns++;
    last = sign;
  }
  if (turns === 0) return 'monotonic';
  return (out && turns <= 2) ? 'overshoot' : 'oscillating';
}

/** Test/bake hygiene: drop the cache so a changed app tree is re-read. */
export const clearRosterCache = () => cache.clear();

/** THE SHARED ROSTERS, READ FROM THE APP — never transcribed.
 *
 *  `docs/COMPOSER.md` §9 is explicit: the rosters are READ from the consuming app's shared
 *  canon and transcribed nowhere. This module is the ONE place that reads them, so a sampler
 *  never holds a copy and a roster change reaches the composer by re-running, not by editing
 *  this repo.
 *
 *  FOUR READ MODES, chosen by what the app file itself offers — in order of preference:
 *
 *   1. `require()` — the file already ends `module.exports = API` and loads clean in node.
 *      `app/js/formats/_ops-canon.js` (the warp-op roster) is read this way.
 *   2. a `vm` context with a `window` shim — the file is an IIFE that assigns
 *      `window.X`. `_layer-canon.js` (layer modes + the slot-host roles) and
 *      `_raymarch-ops.js` (the shading-op roster) are read this way. No DOM is touched
 *      at module scope in either; the shim exists so the assignment lands.
 *   3. a JSON artifact the app itself generates — the FX roster is the manifest the
 *      library builds over `user-media/shaders/fx/**`, and `user-media/shapes/rosters.json`
 *      is the exported roster bundle (the LFO waveform bank, the easing library with its
 *      sampled curves, and the per-card raymarch-op uniform prefix). The bundle carries the
 *      sha256 of every app source it was read from, so a stale export is detectable rather
 *      than silently composed against — those hashes surface as `Rosters.provenance`
 *      (`docs/COMPOSER.md` §5: a decision nobody can trace to its inputs is not provenance).
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
  TIP?:string;
}
/** A shading op as the app's own raymarch roster declares it. */
export interface RaymarchOp {
  /** the op's stable key — it rides the card's own active-op list. */
  key:string; label?:string; hook?:string; fn?:string; identity?:number; hint?:number; tip?:string;
  /** the op's own amount bounds; `identity` is the value at which the op is OFF. */
  amt?:{DEFAULT?:number;MIN?:number;MAX?:number};
  args?:{name:string;LABEL?:string;DEFAULT:unknown;MIN?:number;MAX?:number;TIP?:string;color?:boolean}[];
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

/** The shape of `user-media/shapes/rosters.json` — the app's own export, read, never restated. */
interface RosterArtifact {
  generated?:string; generator?:string;
  sources?:{file:string; sha256:string}[];
  waveforms?:Waveform[]; easings?:Easing[]; raymarchBase?:string;
}
/** The literal auditor's role table — role key → [name prefix, the shared gloss]. */
export interface RoleGloss { role:string; prefix:string; gloss:string }

/** An input descriptor as the app's own roster emits it — the canonical NAME, bounds and
 *  (where the roster carries one) the situation sentence. */
export interface RosterInput {
  NAME:string; TYPE:string; LABEL:string;
  DEFAULT:unknown; MIN?:number; MAX?:number;
  DESCRIPTION?:string;
  _groupId?:string; _groupLabel?:string;
  /** the op this control belongs to, and (companions only) its parent control. */
  _sdfRmOp?:string; _sdfRmOpCompanion?:string;
}

export interface Rosters {
  appRoot:string;
  /** the full warp-op roster + the subset legal on an INJECTED (non-SDF) shader. */
  ops:{all:OpInput[]; injected:OpInput[]; injectedNames:string[]};
  raymarch:RaymarchOp[];
  /** the AMOUNT + companion descriptors under the live per-card uniform prefix, as the
   *  raymarch roster itself emits them. These carry `DESCRIPTION` already, so the shade
   *  stack is composable today. */
  raymarchInputs:RosterInput[];
  rmBase:string;
  layers:{bgModes:ModeDescriptor[]; fillModes:ModeDescriptor[]};
  /** the mesh-material descriptor roster (`_mesh-material.js` `A8MeshMaterial.INPUTS`) —
   *  shared between M3DEngine and the SDF submodule's mesh-route mode, so it is read here
   *  once rather than per consumer (SHARED-CANON-DUPLICATED-PER-ENGINE). These carry `TIP`,
   *  not the endpoint-form `DESCRIPTION` §8 requires — so `stackKnobs` reads only
   *  `DESCRIPTION` here exactly as it does for every other roster, and every material knob
   *  is honestly non-composable until that sentence is authored (the same debt shape as the
   *  408-knob bucket C, never guessed at). */
  material:RosterInput[];
  /** the light-rig descriptor roster (`_lighting.js` `A8Lighting.INPUTS`), same shared-canon
   *  shape and the same undescribed-today state as `material` above. */
  lighting:RosterInput[];
  fx:FxEntry[];
  waveforms:Waveform[];
  /** the easing library, curves included — the second half of the movement vocabulary. */
  easings:Easing[];
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

/** Mode 2 — evaluate an IIFE that assigns `window.<name>` and hand back that object.
 *  `seed` pre-populates the shim window for files that read a sibling canon off it (the
 *  raymarch roster reads the warp-op canon through its own accessor). */
function readWindowGlobal<T>(file:string, name:string, seed:Record<string,unknown> = {}):T {
  const win:Record<string,unknown> = {...seed};
  const stubEl = () => ({style:{}, classList:{add(){}, remove(){}, toggle(){}, contains(){return false;}},
    appendChild(){}, setAttribute(){}, addEventListener(){}, querySelector(){return null;},
    querySelectorAll(){return [];}});
  const ctx = createContext({
    window:win,
    document:{createElement:stubEl, createElementNS:stubEl, addEventListener(){},
      body:stubEl(), documentElement:stubEl(), querySelector(){return null;},
      querySelectorAll(){return [];}},
    navigator:{userAgent:'node'},
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame:()=>0, cancelAnimationFrame(){},
    performance:{now:()=>0}
  });
  runInContext(readFileSync(file,'utf8'), ctx, {filename:file});
  const v = win[name];
  ok(!!v, `${name} did not appear on window after evaluating ${file}`);
  return v as T;
}

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
  const rayApi = attempt('raymarch',
    () => readWindowGlobal<{OPS:RaymarchOp[];rosterInputs:(b:string)=>RosterInput[]}>(
      F('js','formats','_raymarch-ops.js'),'A8RaymarchOps',{A8OpsCanon:opsApi}),
    null as null|{OPS:RaymarchOp[];rosterInputs:(b:string)=>RosterInput[]});
  const raymarch = rayApi?.OPS ?? [];
  const raymarchInputs = attempt('raymarchInputs',
    () => (rayApi && rmBase ? rayApi.rosterInputs(rmBase) : []), [] as RosterInput[]);

  const layers = attempt('layers', () => {
    const L = readWindowGlobal<{BG_MODES:ModeDescriptor[];FILL_MODES:ModeDescriptor[]}>(
      F('js','formats','_layer-canon.js'),'A8LayerCanon');
    return {bgModes:L.BG_MODES ?? [], fillModes:L.FILL_MODES ?? []};
  }, {bgModes:[] as ModeDescriptor[], fillModes:[] as ModeDescriptor[]});

  const material = attempt('material', () => {
    // `_mesh-material.js` reads two sibling canons at module scope — `A8PointLineTexture`
    // (its own texture-compositing GLSL primitives) and `A8TexMappingCanon` (the face
    // material's texture mapping) — so both are read first and seeded in, the same pattern
    // the raymarch roster uses to reach `A8OpsCanon`. Neither reads anything further itself.
    const plt = readWindowGlobal<Record<string,unknown>>(
      F('js','formats','_point-line-texture.js'),'A8PointLineTexture');
    const texmap = readWindowGlobal<Record<string,unknown>>(
      F('js','formats','_texmapping-canon.js'),'A8TexMappingCanon');
    const M = readWindowGlobal<{INPUTS:RosterInput[]}>(
      F('js','formats','_mesh-material.js'),'A8MeshMaterial',
      {A8PointLineTexture:plt, A8TexMappingCanon:texmap});
    return M.INPUTS ?? [];
  }, [] as RosterInput[]);

  const lighting = attempt('lighting', () => {
    const L = readWindowGlobal<{INPUTS:RosterInput[]}>(F('js','formats','_lighting.js'),'A8Lighting');
    return L.INPUTS ?? [];
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
    raymarch, raymarchInputs, rmBase, layers, material, lighting, fx, waveforms, easings,
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

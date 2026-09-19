/** THE SHARED ROSTERS, READ FROM THE APP — never transcribed.
 *
 *  `specs/ai/jev.md` §P2.2 is explicit: "Rosters are READ from the shared canon, never
 *  transcribed (`SHARED-CANON-DUPLICATED-PER-ENGINE`)". This module is the ONE place that
 *  reads them, so a sampler never holds a copy and a roster change reaches the composer by
 *  re-running, not by editing this repo.
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
 *      library builds over `user-media/shaders/fx/**`.
 *   4. a NAMED-LITERAL source read — the value is a module-local `var` with no export at
 *      all, so the only non-transcribing way to obtain it is to read the array literal out
 *      of the source by its own name. Used for exactly two: `_LF_WAVEFORM_TYPES`
 *      (`app/js/lfo-component.js`) and `_ROLE_NAME` (`app/js/formats/_sdf-math.js`).
 *      ⚠ FINDING, reported rather than worked around: both are canon that a second
 *      consumer now needs, and both would be better exported. Mode 4 re-reads the real
 *      file on every load, so it cannot silently drift — but it DOES fail loudly if the
 *      literal is renamed, which is the intended failure.
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

/** A warp-op descriptor as `A8OpsCanon.OP_INPUTS` declares it (`_ops-canon.js:69`). */
export interface OpInput {
  NAME:string; TYPE:string; LABEL:string;
  DEFAULT:number; MIN:number; MAX:number;
  _groupId:string; _groupLabel?:string;
  /** present on companions: they co-surface only while the parent op is active. */
  _glyOpCompanion?:string;
  TIP?:string;
}
/** A shading op as `A8RaymarchOps.OPS` declares it (`_raymarch-ops.js:50`). */
export interface RaymarchOp {
  /** the op's stable key — it rides `card.rmOps` (`_raymarch-ops.js:50`). */
  key:string; label?:string; hook?:string; fn?:string; identity?:number; hint?:number; tip?:string;
  /** the op's own amount bounds; `identity` is the value at which the op is OFF. */
  amt?:{DEFAULT?:number;MIN?:number;MAX?:number};
  args?:{name:string;LABEL?:string;DEFAULT:unknown;MIN?:number;MAX?:number;TIP?:string;color?:boolean}[];
}
export interface ModeDescriptor { key:string; label:string }
export interface FxEntry { id:string; name:string; path:string; category:string }
export interface Waveform { id:string; label:string }
/** `_ROLE_NAME` — role key → [name prefix, the shared gloss] (`_sdf-math.js:1993`). */
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
  /** `A8RaymarchOps.rosterInputs(RM_BASE)` — the AMOUNT + companion descriptors under the
   *  live per-card uniform prefix (`RM_BASE`, read from `js/formats/_sdf-swap.js:94`).
   *  These carry `DESCRIPTION` already, so the shade stack is composable today. */
  raymarchInputs:RosterInput[];
  rmBase:string;
  layers:{bgModes:ModeDescriptor[]; fillModes:ModeDescriptor[]};
  fx:FxEntry[];
  waveforms:Waveform[];
  /** prefix → gloss, for the literal-audited knobs minted by `auditLiterals`. */
  roles:RoleGloss[];
  /** what was NOT available in this app tree, with the reason. Never silent. */
  missing:{roster:string;reason:string}[];
}

/* ── the four read modes ────────────────────────────────────────────────────────── */

function readCjs<T>(file:string):T { return require_(file) as T; }

/** Mode 2 — evaluate an IIFE that assigns `window.<name>` and hand back that object.
 *  `seed` pre-populates the shim window for files that read a sibling canon off it
 *  (`_raymarch-ops.js` reads `window.A8OpsCanon` — its own `CANON()` accessor at :39). */
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

/** Mode 4b — lift a named STRING constant (`var NAME = 'value';`). */
function readNamedString(file:string, name:string):string {
  const m = new RegExp('var\\s+' + name + "\\s*=\\s*'([^']*)'").exec(readFileSync(file,'utf8'));
  ok(!!m, `string constant "${name}" not found in ${file} — it was renamed or removed`);
  return m![1];
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

/* ── the loader ─────────────────────────────────────────────────────────────────── */

const cache = new Map<string,Rosters>();

/** `appRoot` = the live app directory (`<repo>/app`), i.e. the parent of `js/` and
 *  `user-media/`. Whatever is unreadable is REPORTED in `missing`, never defaulted to a
 *  transcription: a sampler with no roster emits no options for that stack (`jev.md` §P2.4
 *  one layer up — the run refuses rather than guesses). */
export function loadRosters(appRoot:string):Rosters {
  const hit = cache.get(appRoot); if (hit) return hit;
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

  const rmBase = attempt('rmBase',
    () => readNamedString(F('js','formats','_sdf-swap.js'),'RM_BASE'), '');
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

  const fx = attempt('fx', () => {
    const p = F('user-media','shaders','fx','manifest.json');
    ok(existsSync(p), `no fx manifest at ${p}`);
    const m = JSON.parse(readFileSync(p,'utf8')) as {items:{name:string;path:string}[]};
    return (m.items ?? []).map(it => ({
      id:it.path, name:it.name, path:it.path,
      category:it.path.includes('/') ? it.path.slice(0, it.path.indexOf('/')) : 'fx'
    }));
  }, [] as FxEntry[]);

  const waveforms = attempt('waveforms',
    () => readNamedLiteral(F('js','lfo-component.js'),'_LF_WAVEFORM_TYPES') as {key:string;label:string}[],
    [] as {key:string;label:string}[]).map(w => ({id:w.key, label:w.label}));

  const roles = attempt('roles', () => {
    const t = readNamedLiteral(F('js','formats','_sdf-math.js'),'_ROLE_NAME') as Record<string,[string,string]>;
    return Object.entries(t).map(([role,[prefix,gloss]]) => ({role, prefix, gloss}));
  }, [] as RoleGloss[]);

  const r:Rosters = {
    appRoot,
    ops:{all, injectedNames, injected:all.filter(o => injectedNames.includes(o.NAME))},
    raymarch, raymarchInputs, rmBase, layers, fx, waveforms, roles, missing
  };
  cache.set(appRoot, r);
  return r;
}

/** Test/bake hygiene: drop the cache so a changed app tree is re-read. */
export const clearRosterCache = () => cache.clear();

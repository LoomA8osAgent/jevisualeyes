/** COMPOSE ONE UNIT, END TO END — `docs/PLAN.md` §1 I4.
 *
 *      given tag → sample → motion Nouls → a bounded accept/resample per stack
 *                → ONE snapshot on disk, with the receipts AND the provider calls beside it
 *
 *  WHY THE CALLS RIDE THE ARTIFACT. §5 already requires the receipts to ride the composed
 *  unit so a decision can be traced to the question that produced it. I4 asks for one thing
 *  more: that the unit be RE-RUNNABLE without a provider. A receipt records the answer's
 *  VALUE; re-running needs the answer's whole RESPONSE, so the accepted request/response
 *  pair of every committed decision is written beside the snapshot and `server/replay.ts`
 *  answers from it. The claim this makes checkable is `docs/COMPOSER.md` §4.4's: the same
 *  stored responses plus the same initial PRNG state replay EXACTLY — asserted here by
 *  sha256 over the canonical snapshot, not by inspection.
 *
 *  WHAT IS DELIBERATELY NOT HERE. The write goes to a FILE, not to the consuming app's
 *  preset bank: `docs/PLAN.md` §1 I5 owns the app's own POST path, its provenance field and
 *  its read-back, and doing half of it here would be a second writer for state the app owns
 *  (`docs/PLAN.md` §3). This file's output is an intermediate a bake carries, and the
 *  journal's own copy stays in SQLite exactly as it did.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {AppConfig} from './config.js';
import {loadConfig, effectiveProvider} from './config.js';
import {createRunner} from './index.js';
import {ReplayProvider} from './replay.js';
import type {ReplayCall} from './replay.js';
import {UnitComposer} from '../core/composer.js';
import {compileTag} from '../core/tags.js';
import {loadRecordIndex} from '../core/records.js';
import type {RecordIndex} from '../core/records.js';
import {loadRosters} from '../core/rosters.js';
import type {RosterProvenance} from '../core/rosters.js';
import {hashJSON} from '../core/hash.js';
import type {CompositionDraft, DecisionKind, DecisionProvider, DecisionReceipt,
  DecisionRequest, DecisionResponse, ProviderClass, StackId} from '../core/types.js';

export interface ComposedUnit {
  schemaVersion:'a8os.jev.composed-unit.v1';
  recordId:string; tag:string; seed:number; composedAt:string;
  /** THE composed snapshot. Byte-comparable: nothing about THIS run is inside it. */
  snapshot:CompositionDraft;
  /** sha256 over the canonical JSON of `snapshot` — the I4 acceptance's own instrument. */
  snapshotSha256:string;
  receipts:DecisionReceipt[];
  /** every accepted provider call, so a re-run needs no provider (`server/replay.ts`). */
  calls:{decisionIndex:number;kind:DecisionKind;requestHash:string;
         request:DecisionRequest;response:DecisionResponse}[];
  provider:{id:string;modelId:string;providerClass:ProviderClass;provenance:'live'|'synthetic'};
  /** which roster export this was composed against (`docs/COMPOSER.md` §5). */
  rosters:RosterProvenance|null;
  /** stacks that produced fewer than 2 distinct looks, and why — never silent (§1). */
  notAsked:{stack:StackId;reason:string}[];
  /** every look the accept check rejected, with its reason (`core/composer.ts acceptLook`). */
  resampled:{stack:StackId;round:number;reason:string}[];
  /** ENVELOPE ONLY, never inside `snapshot`: the artifact this run replayed, when it did.
   *  A snapshot that changed because it was re-run could not be compared with the one it
   *  is replaying, which is the whole point of the re-run. */
  replayOf?:string;
}

export interface ComposeUnitOptions {
  recordId:string; tag:string; seed:number;
  /** the job journal's directory (SQLite). A fresh one per run keeps the runs independent. */
  dataDir:string;
  /** where the composed-unit artifact is written. */
  outDir:string;
  overrides?:Partial<AppConfig>;
  /** overrides the configured provider — the replay leg's door, never a fallback (§3.2). */
  provider?:DecisionProvider;
  replayOf?:string;
  commandId?:string;
  n?:number; resampleCap?:number; movingBand?:number;
}

/** A file name a record id can safely become: `sdf/foo bar` → `sdf_foo-bar`. */
export const unitFileName = (recordId:string, tag:string):string =>
  (`${recordId}__${tag}`).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'') + '.json';

export async function composeUnit(o:ComposeUnitOptions):Promise<{artifact:ComposedUnit;path:string}> {
  const cfg:AppConfig = {...loadConfig(), ...(o.overrides ?? {}), dataDir:o.dataDir};
  const index = loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact);
  const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
  const record = index.get(o.recordId);
  // Refuse an unparseable or unknown tag HERE, before a job row exists: a mistyped tag that
  // composed at the origin would look like a composition (`core/tags.ts`).
  compileTag(o.tag, record.stacks);

  const composer = new UnitComposer({
    index, rosters,
    // The model PIN rides every request, so it must come from the provider that will
    // actually answer — an explicitly supplied provider (the replay leg, or a caller that
    // built its own fixture) names its own, and only an unsupplied one falls to the config.
    model: o.provider ? o.provider.modelId
         : effectiveProvider(cfg) === 'jev' ? cfg.jevModel
         : effectiveProvider(cfg) === 'fixture' ? 'fixture-1' : cfg.localModel,
    ...(o.n !== undefined ? {n:o.n} : {}),
    ...(o.resampleCap !== undefined ? {resampleCap:o.resampleCap} : {}),
    ...(o.movingBand !== undefined ? {movingBand:o.movingBand} : {})
  });

  const r = createRunner(composer, cfg, o.provider);
  try {
    const job = r.runner.startJob(o.recordId, o.tag, o.commandId ?? `${o.recordId}:${o.tag}`,
      {seed:o.seed});
    await r.runner.join(job.id);
    const snap = r.runner.snapshot(job.id);
    if (snap.status !== 'completed')
      // Fail closed and name it: a refused composition is never a partial one written out.
      throw new Error(`composition did not complete (${snap.status}): ` +
        `${snap.errorCode ?? 'no code'} — ${snap.errorMessage ?? 'no message'}`);
    const composition = r.runner.compositionFor(o.recordId, o.tag);
    if (!composition) throw new Error('the job completed but no composition row was written');

    const artifact:ComposedUnit = {
      schemaVersion:'a8os.jev.composed-unit.v1',
      recordId:o.recordId, tag:o.tag, seed:o.seed >>> 0, composedAt:new Date().toISOString(),
      snapshot:composition.snapshot,
      snapshotSha256:hashJSON(composition.snapshot),
      receipts:composition.receipts,
      calls:r.runner.callsFor(job.id),
      provider:{id:r.provider.id, modelId:r.provider.modelId,
                providerClass:r.provider.providerClass, provenance:r.provider.provenance},
      rosters:rosters.provenance,
      notAsked:composer.notAsked(),
      resampled:composer.resampled(),
      ...(o.replayOf ? {replayOf:o.replayOf} : {})
    };
    mkdirSync(o.outDir, {recursive:true});
    const path = join(o.outDir, unitFileName(o.recordId, o.tag));
    writeFileSync(path, JSON.stringify(artifact, null, 2));
    return {artifact, path};
  } finally {
    r.db.close();
  }
}

export function readUnitArtifact(path:string):ComposedUnit {
  const a = JSON.parse(readFileSync(path,'utf8')) as ComposedUnit;
  if (a?.schemaVersion !== 'a8os.jev.composed-unit.v1')
    throw new TypeError(`${path} is not a composed-unit artifact (schemaVersion ` +
      `"${(a as any)?.schemaVersion}") — read fails closed rather than guessing its shape`);
  return a;
}

/** Re-run a stored unit from its own responses, at its own seed. No provider is reachable
 *  from this path by construction: the only answers are the ones the artifact carries. */
export async function replayUnit(artifactPath:string,
                                 o:{dataDir:string; outDir:string; overrides?:Partial<AppConfig>}):
                                 Promise<{artifact:ComposedUnit;path:string}> {
  const src = readUnitArtifact(artifactPath);
  const provider = new ReplayProvider(src.calls as ReplayCall[], {
    id:src.provider.id, modelId:src.provider.modelId,
    providerClass:src.provider.providerClass, provenance:src.provider.provenance});
  return composeUnit({
    recordId:src.recordId, tag:src.tag, seed:src.seed,
    dataDir:o.dataDir, outDir:o.outDir, overrides:o.overrides,
    provider, replayOf:artifactPath
  });
}

/** THE SUBJECT RESOLVER — a record is picked by what it CARRIES, never by name.
 *  Deterministic: the first id in index order with at least `minKnobs` composable knobs. */
export function resolveSubject(index:RecordIndex, minKnobs=3):string {
  const hit = index.composableIds().find(id => index.get(id).composableKnobs.length >= minKnobs);
  if (!hit) throw new Error(
    `no record in ${index.path} carries ${minKnobs} composable knobs — the descriptor lift ` +
    'has not landed far enough to compose anything (docs/PLAN.md §2 risk 1)');
  return hit;
}

/** THE ENTRY: a CLI over the job runner. No Express, no static hosting, no UI.
 *
 *  jevisualeyes is an offline author-time TOOL (`docs/PLAN.md` §3): a run is a job file,
 *  the report is stdout plus the `job_events` rows, and resumability, pause and the request
 *  ceiling come free from `jobs.ts`. The composed preset is reviewed in the consuming app's
 *  Library on a rendered card, by the operator's eyes — taste is the one thing a decision
 *  model structurally cannot judge (`docs/COMPOSER.md` §11) — never in a page this repo
 *  could grow.
 *
 *  `runUnit` is the whole API: give it a composer and one (record, tag) and it returns
 *  the composed snapshot with its receipts. The composer — what to sample and what to
 *  ask — is the domain half (`core/composer.ts`).
 */
import {loadConfig, effectiveProvider, effectiveKey} from './config.js';
import type {AppConfig} from './config.js';
import {openDb} from './db.js';
import type {DB} from './db.js';
import {EventBus} from './events.js';
import {JobRunner} from './jobs.js';
import type {Composer} from './jobs.js';
import {providerFor} from './provider.js';
import {loadRecordIndex} from '../core/records.js';
import {loadRosters} from '../core/rosters.js';
import {UnitComposer} from '../core/composer.js';
import type {UnitComposerOptions} from '../core/composer.js';
import {FixtureProvider} from './fixture.js';
import type {DecisionProvider} from '../core/types.js';

export interface Runner { cfg:AppConfig; db:DB; bus:EventBus; runner:JobRunner; provider:DecisionProvider }

/** Build the configured provider. There is NO silent fallback between providers (§3.2). */
export function buildProvider(cfg:AppConfig):DecisionProvider {
  return providerFor(cfg,effectiveProvider(cfg),effectiveKey(cfg),
    ()=>new FixtureProvider(cfg.fixturePath));
}

/** `provider` overrides the configured one — the REPLAY leg's door (`server/replay.ts`),
 *  and nothing else: it is never a fallback, and the caller that passes one says so
 *  explicitly (§3.2). */
export function createRunner(composer:Composer, overrides:Partial<AppConfig>={},
                             provider?:DecisionProvider):Runner {
  const cfg:AppConfig={...loadConfig(),...overrides};
  const db=openDb(cfg);
  const bus=new EventBus(db);
  provider=provider??buildProvider(cfg);
  const runner=new JobRunner(db,cfg,()=>provider,composer,bus);
  runner.recover();                       // never auto-resumes spend
  return {cfg,db,bus,runner,provider};
}

/** Compose ONE (record, tag) to completion and return it with its receipts. */
export async function runUnit(composer:Composer, recordId:string, tag:string,
                              opts:{commandId?:string;seed?:number;overrides?:Partial<AppConfig>;
                                    provider?:DecisionProvider}={}) {
  const r=createRunner(composer,opts.overrides??{},opts.provider);
  const job=r.runner.startJob(recordId,tag,opts.commandId??`${recordId}:${tag}`,
    opts.seed!==undefined?{seed:opts.seed}:{});
  await r.runner.join(job.id);
  const snap=r.runner.snapshot(job.id);
  return {...r, jobId:job.id, status:snap.status, snapshot:snap,
    composition:r.runner.compositionFor(recordId,tag)};
}

/** The domain half, built off ONE app tree: the record descriptors + the shared rosters.
 *  `jobs.ts` owns the spine and no sampling; this is what feeds its `Composer` seam. */
export function buildComposer(cfg:AppConfig,
                              opts:Omit<UnitComposerOptions,'index'|'rosters'|'model'> &
                                   {model?:string} = {}):UnitComposer {
  return new UnitComposer({
    index:loadRecordIndex(cfg.shapesIndex, cfg.appRoot, cfg.rostersArtifact),
    rosters:loadRosters(cfg.appRoot, cfg.rostersArtifact),
    model:opts.model ?? (effectiveProvider(cfg)==='jev' ? cfg.jevModel : cfg.localModel),
    ...opts
  });
}

/** `status` — what this install would do if a run were started right now. */
function status():void {
  const cfg=loadConfig();
  const id=effectiveProvider(cfg);
  const db=openDb(cfg);
  const composed=(db.prepare('SELECT COUNT(*) c FROM compositions').get() as any).c;
  const jobs=(db.prepare('SELECT status, COUNT(*) c FROM jobs GROUP BY status').all() as any[])
    .map(r=>`${r.status}=${r.c}`).join(' ')||'none';
  console.log(JSON.stringify({
    tool:'jevisualeyes', version:cfg.version, dataDir:cfg.dataDir,
    provider:id,
    endpoint: id==='local'?cfg.localBaseUrl : id==='jev'?cfg.jevBaseUrl : cfg.fixturePath||'(no fixture map set)',
    model: id==='local'?cfg.localModel : id==='jev'?cfg.jevModel : 'fixture-1',
    key: id==='jev' ? (effectiveKey(cfg)?'set':'MISSING') : 'not required',
    compositions: composed, jobs
  },null,2));
}

if(process.argv[1]&&process.argv[1].endsWith('index.ts')){
  const cmd=process.argv[2]??'status';
  if(cmd==='status')status();
  else {
    console.error(`Unknown command "${cmd}". Available: status.\n` +
      'A bake run needs a composer (the samplers + phase machine, docs/PLAN.md §1); ' +
      'until it lands, drive the runner through runUnit() — see scripts/smoke-fixture.mjs.');
    process.exitCode=2;
  }
}

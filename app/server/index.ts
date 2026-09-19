/** THE ENTRY: a CLI over the job runner. No Express, no static hosting, no UI.
 *
 *  jevisualeyes is an offline author-time TOOL (`roadmap/jevisualeyes-rework.md` §4): a
 *  run is a job file, the report is stdout plus the `job_events` rows, and resumability,
 *  pause and the request ceiling come free from `jobs.ts`. The composed preset is
 *  reviewed in the A8os Library on a rendered card (`jev.md` §12, THE WATCHING LAW) —
 *  never in a page this repo could grow.
 *
 *  `runUnit` is the whole API: give it a composer and one (record, tag) and it returns
 *  the composed snapshot with its receipts. The composer — what to sample and what to
 *  ask — is the domain half and arrives with the samplers (plan §5, I3/I4).
 */
import {loadConfig, effectiveProvider, effectiveKey} from './config.js';
import type {AppConfig} from './config.js';
import {openDb} from './db.js';
import type {DB} from './db.js';
import {EventBus} from './events.js';
import {JobRunner} from './jobs.js';
import type {Composer} from './jobs.js';
import {providerFor} from './provider.js';
import {FixtureProvider} from './fixture.js';
import type {DecisionProvider} from '../core/types.js';

export interface Runner { cfg:AppConfig; db:DB; bus:EventBus; runner:JobRunner; provider:DecisionProvider }

/** Build the configured provider. There is NO silent fallback between providers (§9). */
export function buildProvider(cfg:AppConfig):DecisionProvider {
  return providerFor(cfg,effectiveProvider(cfg),effectiveKey(cfg),
    ()=>new FixtureProvider(cfg.fixturePath));
}

export function createRunner(composer:Composer, overrides:Partial<AppConfig>={}):Runner {
  const cfg:AppConfig={...loadConfig(),...overrides};
  const db=openDb(cfg);
  const bus=new EventBus(db);
  const provider=buildProvider(cfg);
  const runner=new JobRunner(db,cfg,()=>provider,composer,bus);
  runner.recover();                       // never auto-resumes spend
  return {cfg,db,bus,runner,provider};
}

/** Compose ONE (record, tag) to completion and return it with its receipts. */
export async function runUnit(composer:Composer, recordId:string, tag:string,
                              opts:{commandId?:string;seed?:number;overrides?:Partial<AppConfig>}={}) {
  const r=createRunner(composer,opts.overrides??{});
  const job=r.runner.startJob(recordId,tag,opts.commandId??`${recordId}:${tag}`,
    opts.seed!==undefined?{seed:opts.seed}:{});
  await r.runner.join(job.id);
  const snap=r.runner.snapshot(job.id);
  return {...r, jobId:job.id, status:snap.status, snapshot:snap,
    composition:r.runner.compositionFor(recordId,tag)};
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
      'A bake run needs a composer (the samplers + phase machine, plan §5 I3/I4); ' +
      'until it lands, drive the runner through runUnit() — see scripts/smoke-fixture.mjs.');
    process.exitCode=2;
  }
}

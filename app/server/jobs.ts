/** THE SPINE: a resumable single-runner job engine.
 *
 *  `loop()` -> `nextStep()` -> `persistPending()` -> `evaluate()` -> `commit()` ->
 *  `finish()`, with an epoch + decisionIndex guard, boot recovery that NEVER auto-resumes
 *  spend, bounded retry with backoff and Retry-After, a request ceiling that PAUSES
 *  rather than fails, and ONE durable transaction per decision. That control flow is
 *  upstream's, kept verbatim in shape (`roadmap/jevisualeyes-rework.md` §1.2) because it
 *  is `docs/upstream/02 §2.6` steps 1-9, which are exactly `specs/ai/jev.md`'s loop with
 *  the nouns changed.
 *
 *  WHAT CHANGED: the unit. Upstream's unit had its menu rebuilt from the previous pick,
 *  which is why it spent ~75-80 calls on one piece; ours is ONE (record, tag)
 *  composition, and a preset is not a sequence (rework §2.2). So the `switch (pending.kind)` arms are
 *  `axes` / `looks` / `motion`, and the lane scheduler is gone: our stacks are
 *  independent given the coordinate, so they ride ONE bundled request (`jev.md` §7)
 *  rather than a scheduler.
 *
 *  WHAT PRODUCES THE STEPS: a `Composer`, injected. This module owns persistence, retry,
 *  validation, selection, receipts and the transaction; it owns NO sampling. Code
 *  enumerates, the model picks one id, code renders (`jev.md` §5) - and the enumerating
 *  half is the composer's, so that the samplers (I3) and this spine can never drift into
 *  each other.
 *
 *  §10.2 IS STRUCTURAL HERE: the model's returned key is LOOKED UP in the persisted
 *  candidate map and its recorded effect applied. A model-supplied string is never parsed
 *  as a param name, a path or anything else.
 */
import {randomBytes} from 'node:crypto';
import type {DB} from './db.js';
import type {AppConfig} from './config.js';
import type {AxisCoordinate, CompositionDraft, DecisionAnswer, DecisionKind, DecisionProvider,
  DecisionReceipt, DecisionRequest, DecisionResponse, JsonValue, LookCandidate, StackId} from '../core/types.js';
import {canonicalJSON, ok, clone} from '../core/canon.js';
import {hashJSON} from '../core/hash.js';
import {AXES, PROMPT_VERSIONS, ROSTER_VERSION, parseAxisQuestionId, parseLookQuestionId,
  movingQuestionId, rateQuestionId, waveformQuestionId} from '../core/axes.js';
import {validateResponse} from '../core/validate.js';
import {selectChoice} from '../core/selection.js';
import {ProviderError} from './provider.js';
import type {EventBus} from './events.js';

export const newId = (p:string) => `${p}_${randomBytes(9).toString('base64url')}`;
const now = () => new Date().toISOString();

/** One decision the composer wants made. `candidates` is the persisted map (§10.2). */
export interface ComposerStep {
  kind:DecisionKind;
  request:DecisionRequest;
  /** question id -> its candidate options, each carrying its own recorded effect. */
  candidates:Record<string,LookCandidate[]>;
  extra?:JsonValue;
}
/** The domain half: what to ask next, given the draft so far. `null` = the unit is done.
 *  Implemented by the samplers (I3) and the composer (I4). */
export interface Composer {
  id:string;
  version:string;
  candidateMapVersion:string;
  /** The Noul band above which a parameter counts as MOVING. Recorded, never inferred. */
  movingBand:number;
  nextStep(draft:CompositionDraft, seed:number):ComposerStep|null;
}

interface Runtime {
  phase:DecisionKind|'done';
  samplerState:number; attemptCount:number; attemptLimit:number;
  pendingDecisionId:string|null; selectionMode:'model'|'sample'; temperature:number;
  usage:{inputTokens:number;outputTokens:number;requests:number;missing:number};
  lastEventId:number; resumeAt:number|null;
  errorCode?:string; errorMessage?:string;
}
interface JobRow {
  id:string; record_id:string; tag:string; command_id:string;
  status:string; epoch:number; decision_index:number; draft_json:string; runtime_json:string;
}
interface Job { id:string; recordId:string; tag:string; commandId:string;
  status:string; epoch:number; decisionIndex:number; draft:CompositionDraft; rt:Runtime; }

const rowToJob = (r:JobRow):Job => ({
  id:r.id, recordId:r.record_id, tag:r.tag, commandId:r.command_id,
  status:r.status, epoch:r.epoch, decisionIndex:r.decision_index,
  draft:JSON.parse(r.draft_json), rt:JSON.parse(r.runtime_json)
});

export class JobRunner {
  private controllers = new Map<string,AbortController>();
  private loops = new Map<string,Promise<void>>();
  constructor(private db:DB, private cfg:AppConfig, private provider:()=>DecisionProvider,
              private composer:Composer, private bus:EventBus) {}

  private loadJob(id:string):Job|null {
    const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow|undefined;
    return r?rowToJob(r):null;
  }
  private persist(job:Job, status?:string):void {
    if(status)job.status=status;
    this.db.prepare(`UPDATE jobs SET status=?,epoch=?,decision_index=?,draft_json=?,runtime_json=?,updated_at=? WHERE id=?`)
      .run(job.status,job.epoch,job.decisionIndex,JSON.stringify(job.draft),JSON.stringify(job.rt),now(),job.id);
  }
  /** Persisted event append (call inside the commit transaction) + notify after. */
  private emitTx(job:Job, type:string, payload:unknown):void {
    const eid=(this.db.prepare('SELECT COALESCE(MAX(event_id),-1) m FROM job_events WHERE job_id=?')
      .get(job.id) as {m:number}).m+1;
    job.rt.lastEventId=eid;
    this.db.prepare('INSERT INTO job_events(job_id,event_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(job.id,eid,type,JSON.stringify(payload),now());
    queueMicrotask(()=>this.bus.publish(job.id,eid,type,payload));
  }
  private emitStatus(job:Job):void {
    this.emitTx(job,'job.status',{status:job.status,phase:job.rt.phase,errorCode:job.rt.errorCode??null});
  }

  /** Boot recovery: active jobs become interrupted; never auto-resume spending. */
  recover():void {
    const n=this.db.prepare(`UPDATE jobs SET status='interrupted',updated_at=? WHERE status IN
      ('queued','composing','pausing','retry_wait')`).run(now()).changes;
    if(n)console.log(`[jobs] marked ${n} unfinished job(s) interrupted`);
  }

  /** Idempotent start: the same (recordId, tag, commandId) returns the existing job. */
  startJob(recordId:string, tag:string, commandId:string,
           overrides:{selectionMode?:'model'|'sample';temperature?:number;seed?:number;attemptLimit?:number}={}):Job {
    const existing=this.db.prepare('SELECT id FROM jobs WHERE record_id=? AND tag=? AND command_id=?')
      .get(recordId,tag,commandId) as {id:string}|undefined;
    if(existing)return this.loadJob(existing.id)!;
    const id=newId('job');
    const provider=this.provider();
    const seed=overrides.seed??hashInt32(`${recordId}:${tag}:${commandId}`);
    const draft:CompositionDraft={
      schemaVersion:'a8os.jev.composition.v1',recordId,tag,
      coordinate:{},stacks:{},motion:{},
      generation:{provenance:provider.provenance==='synthetic'?'synthetic':'live',
        providerId:provider.id,providerClass:provider.providerClass,model:provider.modelId,
        rosterVersion:ROSTER_VERSION,candidateMapVersion:this.composer.candidateMapVersion,
        selection:{mode:overrides.selectionMode??'model',temperature:overrides.temperature??.8,seed},
        partial:false}};
    const rt:Runtime={phase:'axes',samplerState:seed,attemptCount:0,
      attemptLimit:overrides.attemptLimit??this.cfg.maxJobAttempts,
      pendingDecisionId:null,selectionMode:overrides.selectionMode??'model',
      temperature:overrides.temperature??.8,
      usage:{inputTokens:0,outputTokens:0,requests:0,missing:0},lastEventId:0,resumeAt:null};
    this.db.prepare(`INSERT INTO jobs(id,record_id,tag,command_id,status,epoch,decision_index,draft_json,runtime_json,created_at,updated_at)
      VALUES(?,?,?,?,'queued',0,0,?,?,?,?)`)
      .run(id,recordId,tag,commandId,JSON.stringify(draft),JSON.stringify(rt),now(),now());
    const job=this.loadJob(id)!;
    this.db.transaction(()=>{this.emitStatus(job);})();
    this.kick(id);
    return job;
  }

  private kick(id:string):void {
    if(this.loops.has(id))return;
    const ac=new AbortController();this.controllers.set(id,ac);
    const p=this.loop(id,ac.signal).finally(()=>{this.loops.delete(id);this.controllers.delete(id);});
    this.loops.set(id,p);
    p.catch(e=>console.error(`[jobs] loop ${id} failed:`,e));
  }
  isRunning(id:string):boolean { return this.loops.has(id); }
  /** Await the in-flight loop — the CLI's join point (there is no HTTP poll here). */
  async join(id:string):Promise<void> { await this.loops.get(id); }

  pause(id:string):void {
    const j=this.loadJob(id);if(!j)return;
    if(['composing','retry_wait','queued'].includes(j.status))
      this.db.transaction(()=>{this.persist(j,'pausing');this.emitStatus(j);})();
  }
  cancel(id:string):void {
    const j=this.loadJob(id);if(!j)return;
    if(['cancelled','completed','failed'].includes(j.status))return;
    this.db.transaction(()=>{j.epoch++;this.persist(j,'cancelled');this.emitStatus(j);})();
    this.controllers.get(id)?.abort(new Error('cancelled'));
  }
  resume(id:string):{ok:boolean;error?:string} {
    const j=this.loadJob(id);if(!j)return {ok:false,error:'not_found'};
    if(!['paused','interrupted','retry_wait','failed'].includes(j.status))
      return {ok:false,error:`cannot resume from ${j.status}`};
    this.db.transaction(()=>{
      j.rt.resumeAt=null;delete j.rt.errorCode;delete j.rt.errorMessage;
      this.persist(j,'composing');this.emitStatus(j);
    })();
    this.kick(id);
    return {ok:true};
  }

  /** ------------------------------------------------------------------ main loop */
  private async loop(id:string,signal:AbortSignal):Promise<void> {
    for(;;){
      const job=this.loadJob(id);if(!job)return;
      if(job.status==='pausing'){
        this.db.transaction(()=>{this.persist(job,'paused');this.emitStatus(job);})();
        return;
      }
      if(!['queued','composing','retry_wait'].includes(job.status))return;
      if(job.status==='queued')this.db.transaction(()=>{this.persist(job,'composing');this.emitStatus(job);})();
      if(job.rt.resumeAt&&Date.now()<job.rt.resumeAt){
        await sleep(Math.min(job.rt.resumeAt-Date.now(),1000),signal);continue;
      }
      try{
        const step=this.composer.nextStep(job.draft,job.rt.samplerState);
        if(!step){this.finish(job);return;}
        ok(Object.keys(step.request.questions).length>0,'Composer produced a step with no questions');
        const pending=this.persistPending(job,step);
        const result=await this.evaluate(job,pending,signal);
        if(result==='retry_later')continue;
        if(!this.commit(job.id,pending,result!))return;  // stale epoch / cancelled
        const after=this.loadJob(id)!;
        if(after.status==='pausing'){
          this.db.transaction(()=>{this.persist(after,'paused');this.emitStatus(after);})();
          return;
        }
      }catch(e:any){
        if(signal.aborted||e?.name==='AbortError')return;
        this.fail(id,e);return;
      }
    }
  }

  /** Persist the exact pending payload BEFORE the network call (upstream §2.6 step 6).
   *  It is what makes a crashed bake resumable and a receipt honest. */
  private persistPending(job:Job,step:ComposerStep):Pending {
    const row=this.db.prepare(`SELECT * FROM pending_decisions WHERE job_id=? AND decision_index=? AND accepted_receipt_json IS NULL`)
      .get(job.id,job.decisionIndex) as any;
    // A stale oversized request would re-fail on every retry — rebuild it from the
    // current step. Candidates are deterministic for the same seed, so this is safe.
    if(row&&String(row.request_json).length<=MAX_PENDING_REQUEST_BYTES)return pendingFromRow(row);
    if(row)this.db.prepare('DELETE FROM pending_decisions WHERE decision_id=?').run(row.decision_id);
    const decisionId=`${job.id}:${job.decisionIndex}`;
    const requestHash=hashJSON(step.request),candidateHash=hashJSON(step.candidates);
    this.db.prepare(`INSERT INTO pending_decisions(decision_id,job_id,decision_index,epoch,kind,request_json,request_hash,candidates_json,candidate_hash,extra_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(decisionId,job.id,job.decisionIndex,job.epoch,step.kind,JSON.stringify(step.request),
        requestHash,JSON.stringify(step.candidates),candidateHash,JSON.stringify(step.extra??null));
    job.rt.pendingDecisionId=decisionId;job.rt.phase=step.kind;this.persist(job);
    return {decisionId,decisionIndex:job.decisionIndex,epoch:job.epoch,kind:step.kind,
      request:step.request,requestHash,candidates:step.candidates,candidateHash,extra:step.extra};
  }

  /** Provider call under the bounded application retry policy — ONE layer (§10.4). */
  private async evaluate(job:Job,pending:Pending,signal:AbortSignal):Promise<EvalResult|'retry_later'> {
    const provider=this.provider();
    const maxAttempts=this.cfg.providerMaxAttemptsPerDecision;
    for(let attempt=1;;attempt++){
      if(signal.aborted)throw Object.assign(new Error('aborted'),{name:'AbortError'});
      const totalAttempts=(this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=?`)
        .get(job.id) as any).c;
      if(totalAttempts>=job.rt.attemptLimit){
        this.pauseFor(job,'request_limit','Request ceiling reached — resume explicitly to continue spending.');
        return 'retry_later';
      }
      this.db.prepare('INSERT INTO attempts(decision_id,attempt_index,status,started_at) VALUES(?,?,?,?)')
        .run(pending.decisionId,attempt,'sent',now());
      try{
        const receipt=await provider.decide(pending.request,signal);
        this.db.prepare(`UPDATE attempts SET status='ok',receipt_json=?,usage_complete=1,finished_at=? WHERE decision_id=? AND attempt_index=?`)
          .run(JSON.stringify({response:receipt.response,rawResponseHash:receipt.rawResponseHash,
            latencyMs:receipt.latencyMs,httpStatus:receipt.httpStatus,providerRequestId:receipt.providerRequestId??null}),
            now(),pending.decisionId,attempt);
        return {pending,receipt,attemptIndex:attempt};
      }catch(e:any){
        const err=e instanceof ProviderError?e:new ProviderError(e?.message||'provider failure',{retryable:false,code:'provider_error'});
        this.db.prepare(`UPDATE attempts SET status='failed',error_json=?,finished_at=? WHERE decision_id=? AND attempt_index=?`)
          .run(JSON.stringify({code:err.opts.code,message:err.message,status:err.opts.status??null}),
            now(),pending.decisionId,attempt);
        job.rt.usage.missing++;
        if(err.opts.code==='context_limit'){
          this.pauseFor(job,'context_limit','Request payload exceeds the application context ceiling (§10.3). Resume with a shorter state.');
          return 'retry_later';
        }
        // The PROVIDER classifies; the POLICY is here — one layer, never two (§10.4).
        if(!provider.isRetryable(err))throw err;
        if(attempt>=maxAttempts)throw err;
        const backoff=Math.min(30000,1000*2**(attempt-1))+Math.floor(Math.random()*500);
        const wait=Math.max(backoff,err.opts.retryAfterMs??0);
        const j2=this.loadJob(job.id)!;
        this.db.transaction(()=>{j2.rt.resumeAt=Date.now()+wait;this.persist(j2,'retry_wait');this.emitStatus(j2);})();
        await sleep(wait,signal);
        const j3=this.loadJob(job.id)!;
        if(!['retry_wait','composing'].includes(j3.status)||j3.epoch!==pending.epoch)return 'retry_later';
        this.db.transaction(()=>{j3.rt.resumeAt=null;this.persist(j3,'composing');this.emitStatus(j3);})();
      }
    }
  }
  private pauseFor(job:Job,code:string,message:string):void {
    const j=this.loadJob(job.id)!;
    this.db.transaction(()=>{
      j.rt.errorCode=code;j.rt.errorMessage=message;this.persist(j,'paused');this.emitStatus(j);
    })();
  }
  private fail(id:string,e:any):void {
    const j=this.loadJob(id);if(!j)return;
    const code=e instanceof ProviderError?e.opts.code:'internal';
    this.db.transaction(()=>{
      j.rt.errorCode=code;j.rt.errorMessage=String(e?.message||e).slice(0,500);
      this.persist(j,'failed');this.emitStatus(j);
    })();
    console.error(`[jobs] ${id} failed (${code}):`,e?.stack||e?.message||e);
  }

  /** ONE durable transaction: receipts + applied picks + PRNG + event (§2.6 step 8). */
  private commit(jobId:string,pending:Pending,result:EvalResult):boolean {
    return this.db.transaction(()=>{
      const job=this.loadJob(jobId)!;
      if(!canCommitTx(job,pending))return false;
      const rt=job.rt, provider=this.provider();
      // Strict validation FIRST — a violation is an error, never permission to improvise
      // and never permission to commit a partial answer map (§10.1).
      const answers=validateResponse(result.receipt.response,pending.request);
      const usage=result.receipt.response.usage;
      rt.usage.requests++;rt.usage.inputTokens+=usage.input_tokens;rt.usage.outputTokens+=usage.output_tokens;
      const receipts:DecisionReceipt[]=[];

      /** Selection + the receipt, for one question. Only a CHOICE is selected from
       *  (§10.5); a noul is a probability and a score an ordinal — there is no
       *  distribution to sample an answer out of, so the seed does not advance. */
      const decide=(qid:string,answer:DecisionAnswer):{selected:string|null;value:string|number} => {
        const seedBefore=rt.samplerState;
        let selected:string|null=null, value:string|number;
        if(answer.type==='choice'){
          const sel=selectChoice(answer,{mode:rt.selectionMode,seed:rt.samplerState,temperature:rt.temperature});
          rt.samplerState=sel.seed; selected=sel.selected; value=answer.choice;
        } else value=answer.type==='noul'?answer.noul:answer.score;
        receipts.push({schemaVersion:'a8os.jev.receipt.v1',
          id:`${pending.decisionId}:${qid}:${result.attemptIndex}`,jobId:job.id,
          decisionIndex:pending.decisionIndex,attemptIndex:result.attemptIndex,
          requestHash:pending.requestHash,candidateHash:pending.candidateHash,
          providerId:provider.id,providerClass:provider.providerClass,
          model:result.receipt.response.model,          // what the provider RETURNED (§2.9)
          promptTemplateVersion:promptVersionFor(pending.kind,qid),
          candidateMapVersion:this.composer.candidateMapVersion,rosterVersion:ROSTER_VERSION,
          questionId:qid,answerType:answer.type,
          providerChoice:answer.type==='choice'?answer.choice:null,selectedChoice:selected,
          answerValue:value,confidence:answer.type==='noul'?1:answer.confidence,
          selectionMode:rt.selectionMode,seedBefore,seedAfter:rt.samplerState,
          usage:{inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,complete:true},
          latencyMs:result.receipt.latencyMs,provenance:provider.provenance});
        return {selected,value};
      };

      switch(pending.kind){
        case 'axes':{
          // The coordinate: axis question id -> (stack, axis); the chosen key is an axis
          // VALUE from the roster's closed set.
          for(const [qid,answer] of Object.entries(answers)){
            const {selected}=decide(qid,answer);
            const parsed=parseAxisQuestionId(qid);
            ok(parsed&&selected,`Unexpected axis question id "${qid}"`);
            ok(AXES[parsed!.axis].options.some(o=>o.id===selected),
              `Selected axis value "${selected}" is not in the ${parsed!.axis} roster`);
            const coord:AxisCoordinate=job.draft.coordinate[parsed!.stack]??{};
            coord[parsed!.axis]=selected!;
            job.draft.coordinate[parsed!.stack]=coord;
          }
          this.emitTx(job,'axes.committed',{coordinate:job.draft.coordinate});
          break;
        }
        case 'looks':{
          // §10.2 — the key is LOOKED UP in the persisted candidate map and its recorded
          // effect applied. The string is never interpreted.
          for(const [qid,answer] of Object.entries(answers)){
            const {selected}=decide(qid,answer);
            const stack=parseLookQuestionId(qid);
            ok(stack&&selected,`Unexpected look question id "${qid}"`);
            const look=(pending.candidates[qid]??[]).find(c=>c.id===selected);
            ok(look,'Selected option missing from the persisted candidate map');
            job.draft.stacks[stack as StackId]={lookId:look!.id,params:clone(look!.params)};
          }
          this.emitTx(job,'looks.committed',
            {stacks:Object.fromEntries(Object.entries(job.draft.stacks).map(([k,v])=>[k,v!.lookId]))});
          break;
        }
        case 'motion':{
          // A Noul says WHETHER a param moves; the waveform Choice and the ordinal rate
          // Score say HOW. A Noul is never read as a magnitude (L12) — it is cut at the
          // composer's recorded band, and the band is a placeholder until measured (§1.5).
          for(const [qid,answer] of Object.entries(answers)){
            const {selected,value}=decide(qid,answer);
            const param=paramOf(qid);
            ok(param,`Unexpected motion question id "${qid}"`);
            const st=job.draft.motion[param!]??{moving:false};
            if(qid===movingQuestionId(param!)) st.moving=(value as number)>=this.composer.movingBand;
            else if(qid===waveformQuestionId(param!)){ st.moving=true; st.waveform=selected!; }
            else if(qid===rateQuestionId(param!)){
              // L4/L2: the ordinal is the LEVEL. Turning a level into a real rate is
              // arithmetic and is done in code, downstream, never asked of the model.
              st.moving=true; st.rateLevel=Math.round(value as number);
            }
            job.draft.motion[param!]=st;
          }
          this.emitTx(job,'motion.committed',{motion:job.draft.motion});
          break;
        }
      }

      job.decisionIndex++;
      rt.pendingDecisionId=null;
      this.db.prepare('UPDATE pending_decisions SET accepted_receipt_json=? WHERE decision_id=?')
        .run(JSON.stringify(receipts),pending.decisionId);
      this.persist(job);
      return true;
    })();
  }

  /** A (record, tag) is exposed only when every one of its decisions committed
   *  (upstream §2.6 step 9 — expose only COMPLETE snapshots). */
  private finish(job:Job):void {
    this.db.transaction(()=>{
      job.rt.phase='done';this.persist(job,'completed');
      const receipts=this.receiptsFor(job.id);
      const snapshot=job.draft;
      this.db.prepare(`INSERT INTO compositions(id,record_id,tag,job_id,snapshot_json,snapshot_hash,receipts_json,created_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(record_id,tag) DO UPDATE SET job_id=excluded.job_id,snapshot_json=excluded.snapshot_json,
          snapshot_hash=excluded.snapshot_hash,receipts_json=excluded.receipts_json,created_at=excluded.created_at`)
        .run(newId('cmp'),job.recordId,job.tag,job.id,canonicalJSON(snapshot),hashJSON(snapshot),
          JSON.stringify(receipts),now());
      this.emitStatus(job);
      this.emitTx(job,'job.completed',{recordId:job.recordId,tag:job.tag,
        snapshotHash:hashJSON(snapshot),receipts:receipts.length});
    })();
  }

  /** Public snapshot for the CLI report. */
  snapshot(id:string):any {
    const j=this.loadJob(id);if(!j)return null;
    const failed=(this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=? AND a.status!='ok'`).get(id) as any).c;
    const okCount=(this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=? AND a.status='ok'`).get(id) as any).c;
    return {id:j.id,recordId:j.recordId,tag:j.tag,status:j.status,phase:j.rt.phase,
      epoch:j.epoch,decisionIndex:j.decisionIndex,attemptCount:okCount+failed,
      attemptLimit:j.rt.attemptLimit,usage:{...j.rt.usage,missing:failed},
      draft:j.draft,errorCode:j.rt.errorCode??null,errorMessage:j.rt.errorMessage??null,
      resumeAt:j.rt.resumeAt};
  }
  /** The composed snapshot for one unit, or null while it is incomplete. */
  compositionFor(recordId:string,tag:string):{snapshot:CompositionDraft;receipts:DecisionReceipt[];hash:string}|null {
    const r=this.db.prepare('SELECT snapshot_json,receipts_json,snapshot_hash FROM compositions WHERE record_id=? AND tag=?')
      .get(recordId,tag) as any;
    return r?{snapshot:JSON.parse(r.snapshot_json),receipts:JSON.parse(r.receipts_json),hash:r.snapshot_hash}:null;
  }
  /** Provider-payload introspection for tests and diagnostics. */
  pendingFor(id:string):Pending|null {
    const r=this.db.prepare(`SELECT * FROM pending_decisions WHERE job_id=? AND accepted_receipt_json IS NULL ORDER BY decision_index DESC LIMIT 1`)
      .get(id) as any;
    return r?pendingFromRow(r):null;
  }
  receiptsFor(id:string):DecisionReceipt[] {
    return (this.db.prepare(`SELECT accepted_receipt_json FROM pending_decisions WHERE job_id=? AND accepted_receipt_json IS NOT NULL ORDER BY decision_index`)
      .all(id) as any[]).map(r=>JSON.parse(r.accepted_receipt_json)).flat();
  }
}

/* ---------- helpers ---------- */

interface Pending {decisionId:string;decisionIndex:number;epoch:number;kind:DecisionKind;
  request:DecisionRequest;requestHash:string;candidates:Record<string,LookCandidate[]>;
  candidateHash:string;extra?:JsonValue}
interface EvalResult {pending:Pending;attemptIndex:number;
  receipt:{response:DecisionResponse;rawResponseHash:string;latencyMs:number;httpStatus:number;providerRequestId?:string}}

const MAX_PENDING_REQUEST_BYTES=40*1024;
const pendingFromRow=(r:any):Pending=>({decisionId:r.decision_id,decisionIndex:r.decision_index,
  epoch:r.epoch,kind:r.kind,request:JSON.parse(r.request_json),requestHash:r.request_hash,
  candidates:JSON.parse(r.candidates_json),candidateHash:r.candidate_hash,
  extra:r.extra_json?JSON.parse(r.extra_json):undefined});

const canCommitTx=(job:Job,pending:Pending)=>
  ['composing','pausing'].includes(job.status)
  &&job.epoch===pending.epoch&&job.decisionIndex===pending.decisionIndex;

/** Which versioned prompt produced this question (§11, recorded in every receipt). */
function promptVersionFor(kind:DecisionKind,qid:string):string {
  if(kind==='axes')return PROMPT_VERSIONS.axes;
  if(kind==='looks')return PROMPT_VERSIONS.looks;
  if(qid.startsWith('moving_'))return PROMPT_VERSIONS.motionMoving;
  if(qid.startsWith('waveform_'))return PROMPT_VERSIONS.motionWaveform;
  return PROMPT_VERSIONS.motionRate;
}
const paramOf=(qid:string):string|null=>{
  const m=/^(?:moving|waveform|rate)_(.+)$/.exec(qid);
  return m?m[1]:null;
};
const hashInt32=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((res,rej)=>{
  const t=setTimeout(res,ms);
  signal.addEventListener('abort',()=>{clearTimeout(t);rej(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true});
});

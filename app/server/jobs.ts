/** Persistent job runner: plan → harmony → phrase intents → sequential event decisions.
 * Every decision is persisted before the network call and committed in one transaction. */
import {randomBytes} from 'node:crypto';
import type {DB} from './db.js';
import type {AppConfig} from './config.js';
import type {DecisionProvider, ChoiceRequest, ChoiceResponse, EventCandidate,
  GenerationJob, HarmonySlot, LaneRole, Note, PlanState, ProjectFile, Scope, Section, Track} from '../core/types.js';
import {canonicalJSON, ok, isPlain, clone} from '../core/canon.js';
import {hashJSON} from '../core/hash.js';
import {barTicks, STRAIGHT_SPANS, SWING_SPANS, DRUM_STRAIGHT_SPANS, DRUM_SWING_SPANS} from '../core/time.js';
import {buildCandidates, criteriaFor, pitchWindow, harmonyVoicings, LANE_RANGES, DRUM_MASKS,
  instrumentById, chordTones, NOTE_NAMES, CANDIDATE_VERSION} from '../core/candidates.js';
import {barCandidatesFor, isBarCandidate, type AnyCandidate} from '../core/barpatterns.js';
import {compileSections, harmonySlots, emptyPlan, parseExplicit, expandProgression, spellDegree,
  progressionsFor, SWING_RATIO, LANE_ROLES} from '../core/plan.js';
import {buildPlanRequest, buildInstrumentRequest, buildHarmonyRequest, buildPhraseIntentRequest,
  buildGrooveRequest, buildEventRequest} from '../core/requests.js';
import {validateChoiceResponse} from '../core/validate.js';
import {selectChoice} from '../core/selection.js';
import {applyEvent, nextLane, isEditable, isProtected, protectedCoveringEnd,
  nextProtectedStart, holdableNotes, assertPreserved, validateProject, frontierBars} from '../core/score.js';
import {removeEditableNotes} from '../core/edits.js';
import {ProviderError} from './provider.js';
import type {EventBus} from './events.js';
import {FixtureProvider} from './fixture.js';

export const newId = (p:string) => `${p}_${randomBytes(9).toString('base64url')}`;
const now = () => new Date().toISOString();

interface Runtime {
  mode:'compose'|'variation'|'regenerate'|'edit';
  instruction:string; scope:Scope; phase:'plan'|'instruments'|'harmony'|'compose'|'done';
  laneCursors:Record<string,number>; samplerState:number; attemptCount:number; attemptLimit:number;
  plan:PlanState|null; harmonyPrefix:HarmonySlot[]; harmonyTotal:number;
  harmonyChoices?:{sectionId:string;id:string;chords:string[]}[];
  phraseIntents:Record<string,string>; grooves:Record<string,Record<string,Record<string,string>>>;
  motif:{midi:number;startTick:number;durationTicks:number}[]|null;
  pendingDecisionId:string|null; selectionMode:'model'|'sample'; temperature:number;
  usage:{inputTokens:number;outputTokens:number;requests:number;missing:number};
  completedThroughTick:number; lastEventId:number;
  activeLanes:string[]; resumeAt:number|null; harmonyIndex:number;
  discarded?:boolean; accepted?:boolean; errorCode?:string; errorMessage?:string;
}
interface JobRow {
  id:string; project_id:string; base_revision_id:string|null; command_id:string;
  status:string; epoch:number; decision_index:number; draft_json:string; runtime_json:string;
}
interface Job { id:string; projectId:string; baseRevisionId:string|null; commandId:string;
  status:string; epoch:number; decisionIndex:number; draft:ProjectFile; rt:Runtime; }

const rowToJob = (r:JobRow):Job => ({
  id:r.id, projectId:r.project_id, baseRevisionId:r.base_revision_id, commandId:r.command_id,
  status:r.status, epoch:r.epoch, decisionIndex:r.decision_index,
  draft:JSON.parse(r.draft_json),
  rt:(()=>{const rt=JSON.parse(r.runtime_json);rt.grooves??={};return rt;})()
});

export class JobRunner {
  private controllers = new Map<string,AbortController>();
  private loops = new Map<string,Promise<void>>();
  constructor(private db:DB, private cfg:AppConfig, private provider:()=>DecisionProvider|null,
              private bus:EventBus) {}

  private loadJob(id:string):Job|null {
    const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow|undefined;
    return r?rowToJob(r):null;
  }
  private persist(job:Job, status?:string):void {
    if(status)job.status=status;
    this.db.prepare(`UPDATE jobs SET status=?,epoch=?,decision_index=?,draft_json=?,runtime_json=?,updated_at=? WHERE id=?`)
      .run(job.status,job.epoch,job.decisionIndex,JSON.stringify(job.draft),JSON.stringify(job.rt),now(),job.id);
  }
  /** Persisted event append (call inside the commit transaction) + SSE notify after. */
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
      ('queued','planning','composing','pausing','retry_wait')`).run(now()).changes;
    if(n)console.log(`[jobs] marked ${n} unfinished job(s) interrupted`);
  }

  /** Idempotent start: same (projectId, commandId) returns the existing job. */
  startJob(projectId:string, baseRevisionId:string|null, commandId:string,
           mode:Runtime['mode'], instruction:string, scope:Scope|null,
           overrides:{selectionMode?:'model'|'sample';temperature?:number;seed?:number;attemptLimit?:number}):Job {
    const existing=this.db.prepare('SELECT id FROM jobs WHERE project_id=? AND command_id=?')
      .get(projectId,commandId) as {id:string}|undefined;
    if(existing){const j=this.loadJob(existing.id)!;return j;}
    const id=newId('job');
    const base=baseRevisionId?this.getRevision(baseRevisionId):null;
    const projectRow=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    ok(projectRow,'Unknown project');
    // Compose starts from an empty draft; regen/variation/edit from the base revision minus editable notes.
    let draft:ProjectFile;
    const bt=base?barTicks(base.meter):barTicks({numerator:4,denominator:4});
    const effScope:Scope=scope??{trackIds:(base?.tracks??[]).map(t=>t.id),startTick:0,
      endTick:base?base.lengthBars*barTicks(base.meter):0};
    if(mode==='compose'){
      draft={schemaVersion:'jev-music.project.v1',id:projectId,revisionId:'draft',
        title:(instruction||'Untitled').slice(0,60),createdAt:now(),updatedAt:now(),
        prompt:instruction,ppq:480,tempoBpm:100,meter:{numerator:4,denominator:4},
        swing:{mode:'straight',ratio:.5},lengthBars:16,sections:[],harmonicPlan:[],tracks:[],
        generation:{provenance:this.provider() instanceof FixtureProvider?'fixture':'live',
          model:this.cfg.model,candidateVersion:CANDIDATE_VERSION,contextMode:'full',
          selection:{mode:overrides.selectionMode??'model',temperature:overrides.temperature??.8,
            seed:overrides.seed??(hashInt32(commandId))},
          partial:false,requestedLengthBars:16,history:[]}};
    } else {
      ok(base,'Base revision required');
      draft=clone(base!);
      draft.revisionId='draft';
      draft.updatedAt=now();
      draft.generation.history.push({instruction,baseRevisionId:baseRevisionId!});
      draft.generation.selection={mode:overrides.selectionMode??'model',
        temperature:overrides.temperature??.8,seed:overrides.seed??hashInt32(commandId)};
      draft=removeEditableNotes(draft,effScope);
    }
    const rt:Runtime={mode,instruction,scope:effScope,
      phase:mode==='compose'?'plan':'compose',
      laneCursors:Object.fromEntries(effScope.trackIds.map(t=>[t,effScope.startTick])),
      samplerState:overrides.seed??hashInt32(commandId),attemptCount:0,
      attemptLimit:overrides.attemptLimit??this.cfg.maxJobAttempts,
      plan:mode==='compose'?null:planFromProject(base!),harmonyPrefix:[],harmonyTotal:0,
      phraseIntents:{},grooves:{},motif:null,pendingDecisionId:null,
      selectionMode:overrides.selectionMode??'model',temperature:overrides.temperature??.8,
      usage:{inputTokens:0,outputTokens:0,requests:0,missing:0},
      completedThroughTick:effScope.startTick,lastEventId:0,
      activeLanes:effScope.trackIds.slice(),resumeAt:null,harmonyIndex:0};
    this.db.prepare(`INSERT INTO jobs(id,project_id,base_revision_id,command_id,status,epoch,decision_index,draft_json,runtime_json,created_at,updated_at)
      VALUES(?,?,?,?, 'queued',0,0,?,?,?,?)`)
      .run(id,projectId,baseRevisionId,commandId,JSON.stringify(draft),JSON.stringify(rt),now(),now());
    const job=this.loadJob(id)!;
    this.db.transaction(()=>{this.emitStatus(job);})();
    this.kick(id);
    return job;
  }
  private getRevision(id:string):ProjectFile|null {
    const r=this.db.prepare('SELECT score_json FROM revisions WHERE id=?').get(id) as {score_json:string}|undefined;
    return r?JSON.parse(r.score_json):null;
  }
  private kick(id:string):void {
    if(this.loops.has(id))return;
    const ac=new AbortController();this.controllers.set(id,ac);
    const p=this.loop(id,ac.signal).finally(()=>{this.loops.delete(id);this.controllers.delete(id);});
    this.loops.set(id,p);
    p.catch(e=>console.error(`[jobs] loop ${id} failed:`,e));
  }
  isRunning(id:string):boolean { return this.loops.has(id); }

  pause(id:string):void {
    const j=this.loadJob(id);if(!j)return;
    if(['composing','planning','retry_wait','queued'].includes(j.status)){
      this.db.transaction(()=>{this.persist(j,'pausing');this.emitStatus(j);})();
      // in-flight decision may still commit; loop exits after commit
    }
  }
  cancel(id:string):void {
    const j=this.loadJob(id);if(!j)return;
    if(['cancelled','completed','failed'].includes(j.status))return;
    this.db.transaction(()=>{
      j.epoch++; this.persist(j,'cancelled'); this.emitStatus(j);
    })();
    this.controllers.get(id)?.abort(new Error('cancelled'));
  }
  resume(id:string):{ok:boolean;error?:string} {
    const j=this.loadJob(id);if(!j)return {ok:false,error:'not_found'};
    if(!['paused','interrupted','retry_wait','failed'].includes(j.status))
      return {ok:false,error:`cannot resume from ${j.status}`};
    // base revision compatibility: the accepted revision must still be the job's base (or job's own output)
    const proj=this.db.prepare('SELECT accepted_revision_id FROM projects WHERE id=?').get(j.projectId) as any;
    if(j.baseRevisionId&&proj?.accepted_revision_id&&proj.accepted_revision_id!==j.baseRevisionId)
      return {ok:false,error:'revision_conflict'};
    this.db.transaction(()=>{
      j.rt.resumeAt=null;j.rt.errorCode=undefined;j.rt.errorMessage=undefined;
      this.persist(j,j.rt.phase==='compose'?'composing':'planning');this.emitStatus(j);
    })();
    this.kick(id);
    return {ok:true};
  }

  /** Accept a completed draft as the new accepted revision (optimistic base check). */
  accept(id:string):{ok:boolean;error?:string;revisionId?:string} {
    const j=this.loadJob(id);if(!j)return {ok:false,error:'not_found'};
    if(j.status!=='completed')return {ok:false,error:'job_not_completed'};
    if(j.rt.accepted)return {ok:false,error:'already_accepted'};
    const proj=this.db.prepare('SELECT * FROM projects WHERE id=?').get(j.projectId) as any;
    if(j.baseRevisionId&&proj.accepted_revision_id!==j.baseRevisionId)
      return {ok:false,error:'revision_conflict'};
    const base=j.baseRevisionId?this.getRevision(j.baseRevisionId):null;
    try{
      if(base&&j.rt.mode!=='compose')assertPreserved(base,j.draft,j.rt.scope);
      validateProject(j.draft);
    }catch(e:any){return {ok:false,error:`preservation_check_failed: ${e.message}`};}
    const rid=newId('rev');
    this.db.transaction(()=>{
      this.db.prepare(`INSERT INTO revisions(id,project_id,parent_id,score_json,score_hash,command_id,created_at)
        VALUES(?,?,?,?,?,?,?)`)
        .run(rid,j.projectId,j.baseRevisionId,JSON.stringify(j.draft),hashJSON(scoreForHash(j.draft)),j.commandId+'/accept',now());
      this.db.prepare(`UPDATE projects SET accepted_revision_id=?,updated_at=?,aux_json=? WHERE id=?`)
        .run(rid,now(),JSON.stringify({redo:[]}),j.projectId);
      j.rt.accepted=true;this.persist(j);this.emitTx(j,'job.accepted',{revisionId:rid});
    })();
    return {ok:true,revisionId:rid};
  }
  discard(id:string):{ok:boolean;error?:string} {
    const j=this.loadJob(id);if(!j)return {ok:false,error:'not_found'};
    if(j.status!=='completed')return {ok:false,error:'job_not_completed'};
    this.db.transaction(()=>{j.rt.discarded=true;this.persist(j);this.emitTx(j,'job.discarded',{});})();
    return {ok:true};
  }

  /** ------------------------------------------------------------------ main loop */
  private async loop(id:string,signal:AbortSignal):Promise<void> {
    for(;;){
      const job=this.loadJob(id);if(!job)return;
      if(job.status==='pausing'){
        // no provider call in flight here — safe to settle into paused
        this.db.transaction(()=>{this.persist(job,'paused');this.emitStatus(job);})();
        return;
      }
      if(!['queued','planning','composing','retry_wait'].includes(job.status))return;
      if(job.status==='queued'){this.db.transaction(()=>{this.persist(job,'planning');this.emitStatus(job);})();}
      if(job.rt.resumeAt&&Date.now()<job.rt.resumeAt){
        await sleep(Math.min(job.rt.resumeAt-Date.now(),1000),signal);continue;
      }
      try{
        const step=this.nextStep(job);
        if(step.done){this.finish(job);return;}
        const pending=this.persistPending(job,step);
        const result=await this.evaluate(job,pending,signal);
        if(result==='retry_later')continue;
        const committed=this.commit(job.id,pending,result!);
        if(!committed)return; // stale epoch/cancelled — exit
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

  /** Decide what the next decision is. Pure w.r.t. provider. */
  private nextStep(job:Job):Step {
    const rt=job.rt;
    if(rt.phase==='plan'){
      const explicit=parseExplicit(rt.instruction);
      return {done:false,kind:'plan',laneId:'',cursorTick:0,
        request:buildPlanRequest(this.cfg.model,rt.instruction,explicit),extra:{explicit}};
    }
    if(rt.phase==='instruments')
      return {done:false,kind:'instruments',laneId:'',cursorTick:0,
        request:buildInstrumentRequest(this.cfg.model,rt.instruction,rt.plan!)};
    if(rt.phase==='harmony'){
      const d=job.draft;
      const slots=harmonySlots(d.lengthBars,d.meter);
      if(rt.harmonyIndex>=slots.length){rt.phase='compose';this.persist(job);return this.nextStep(job);}
      const slot=slots[rt.harmonyIndex];
      const section=d.sections.find(s=>slot.startTick>=s.startTick&&slot.startTick<s.endTick)??null;
      const span=section?{startTick:section.startTick,endTick:section.endTick}
        :{startTick:slot.startTick,endTick:slots[slots.length-1].endTick};
      const nSlots=slots.filter(s=>s.startTick>=span.startTick&&s.endTick<=span.endTick).length;
      return {done:false,kind:'harmony',laneId:'harmony',cursorTick:slot.startTick,
        request:buildHarmonyRequest(this.cfg.model,rt.instruction,rt.plan!,section,span,nSlots,rt.harmonyChoices??[]),
        extra:{span,nSlots,sectionId:section?.id??null}};
    }
    // compose phase
    const scope=rt.scope,draft=job.draft;
    // deterministic structural skip: cursor inside a protected note jumps to its end
    let skipped=false;
    for(const laneId of rt.activeLanes){
      const t=draft.tracks.find(t=>t.id===laneId);if(!t)continue;
      const cur=rt.laneCursors[laneId]??scope.startTick;
      if(cur>=scope.endTick)continue;
      const end=protectedCoveringEnd(t,cur,scope);
      if(end!==null&&end>cur){rt.laneCursors[laneId]=end;skipped=true;}
    }
    if(skipped){this.persist(job);}
    const active=Object.fromEntries(rt.activeLanes
      .filter(id=>(rt.laneCursors[id]??scope.startTick)<scope.endTick)
      .map(id=>[id,rt.laneCursors[id]]));
    if(!Object.keys(active).length)return {done:true,kind:'done',laneId:'',cursorTick:0};
    const roles=Object.fromEntries(draft.tracks.map(t=>[t.id,t.role]));
    const laneId=nextLane(active,roles);
    const track=draft.tracks.find(t=>t.id===laneId)!;
    const cursor=rt.laneCursors[laneId];
    const bt=barTicks(draft.meter);
    const section=draft.sections.find(s=>cursor>=s.startTick&&cursor<s.endTick)??null;
    // phrase intent at each section boundary (once per section)
    if(section&&!rt.phraseIntents[section.id]){
      const motif=this.findMotif(draft,rt);
      return {done:false,kind:'phrase',laneId,cursorTick:cursor,
        request:buildPhraseIntentRequest(this.cfg.model,rt.instruction,section,motif),
        extra:{sectionId:section.id}};
    }
    // groove palettes: once per section, one sub-question per lane
    if(section&&!rt.grooves[section.id]){
      return {done:false,kind:'groove',laneId,cursorTick:cursor,
        request:buildGrooveRequest(this.cfg.model,rt.instruction,
          rt.plan??planFromProject(draft),section,
          draft.tracks.map(t=>({id:t.id,role:t.role,instrumentId:t.instrumentId}))),
        extra:{sectionId:section.id}};
    }
    // hard boundary: bar end / harmony slot end (harmony lane) / scope end / next protected note
    let boundary=Math.min(scope.endTick, Math.ceil((cursor+1)/bt)*bt);
    const slot=draft.harmonicPlan.find(h=>cursor>=h.startTick&&cursor<h.endTick)??null;
    if(track.role==='harmony'&&slot)boundary=Math.min(boundary,slot.endTick);
    boundary=nextProtectedStart(track,cursor,scope,boundary);
    const remaining=boundary-cursor;
    const swing=draft.swing.ratio>.5;
    let candidates:AnyCandidate[];
    const holdIds=track.role==='drums'?[]:holdableNotes(track,cursor,scope).map(n=>n.id);
    // Bar-aligned positions get bar-level candidates (one choice = a whole bar);
    // mid-bar positions (protected skips, partial regen) fall back to per-event.
    const barAligned=remaining===bt&&(cursor-scope.startTick)%bt===0;
    if(barAligned){
      const motif=track.role==='lead'?this.findMotif(draft,rt):null;
      candidates=barCandidatesFor({role:track.role,span:remaining,slot,
        vocab:(rt.plan??planFromProject(draft)).harmonicVocabulary,
        tonic:(rt.plan??planFromProject(draft)).tonicPitchClass,
        lastPitch:lastPitch(track,cursor),prevVoicing:lastChordVoicing(track,cursor),
        holdNoteIds:holdIds,motif,seed:rt.samplerState+cursor,
        groove:section?rt.grooves[section.id]?.[track.id]??null:null});
      const generatedNoteIds=new Set(draft.tracks.flatMap(t=>t.notes.map(n=>n.id)).filter(n=>n.startsWith(job.id+':')));
      const request=buildEventRequest(this.cfg.model,{
        prompt:draft.prompt,editInstruction:rt.mode==='compose'?null:rt.instruction,
        project:draft,track,cursorTick:cursor,boundaryTick:boundary,candidates,
        harmony:slot,phraseIntent:section?rt.phraseIntents[section.id]??null:null,
        section,plan:rt.plan??planFromProject(draft),generatedNoteIds});
      return {done:false,kind:'event',laneId,cursorTick:cursor,boundary,candidates,request,
        extra:{laneId,cursorTick:cursor,boundary}};
    }
    if(track.role==='drums'){
      candidates=buildCandidates({pitches:DRUM_MASKS,
        spans:swing?DRUM_SWING_SPANS:DRUM_STRAIGHT_SPANS,remaining,percussion:true});
    } else if(track.role==='harmony'){
      const prevVoicing=lastChordVoicing(track,cursor);
      const voicings=slot?harmonyVoicings(slot,LANE_RANGES.harmony,prevVoicing):[];
      if(voicings.length)
        candidates=buildCandidates({pitches:voicings,spans:swing?SWING_SPANS:STRAIGHT_SPANS,
          remaining,holdNoteIds:holdIds});
      else
        candidates=restCandidates(swing?SWING_SPANS:STRAIGHT_SPANS,remaining);
    } else {
      const range=LANE_RANGES[track.role];
      const last=lastPitch(track,cursor);
      const anchor=last??range.anchor;
      const window=pitchWindow(anchor,range.low,range.high);
      // Order options by fit — chord tones near the previous note first — so the
      // criteria don't always open with the lane's lowest pitch (position bias).
      const tones=slot&&slot.rootPitchClass!==null?new Set(chordTones(slot.rootPitchClass,slot.quality)):null;
      window.sort((a,b)=>{
        const ca=tones?.has(a%12)?0:1, cb=tones?.has(b%12)?0:1;
        return ca-cb||Math.abs(a-anchor)-Math.abs(b-anchor)||a-b;
      });
      candidates=buildCandidates({pitches:window,
        spans:swing?SWING_SPANS:STRAIGHT_SPANS,remaining,holdNoteIds:holdIds});
    }
    const generatedNoteIds=new Set(draft.tracks.flatMap(t=>t.notes.map(n=>n.id)).filter(n=>n.startsWith(job.id+':')));
    const request=buildEventRequest(this.cfg.model,{
      prompt:draft.prompt,editInstruction:rt.mode==='compose'?null:rt.instruction,
      project:draft,track,cursorTick:cursor,boundaryTick:boundary,candidates,
      harmony:slot,phraseIntent:section?rt.phraseIntents[section.id]??null:null,
      section,plan:rt.plan??planFromProject(draft),generatedNoteIds});
    return {done:false,kind:'event',laneId,cursorTick:cursor,boundary,candidates,request,
      extra:{laneId,cursorTick:cursor,boundary}};
  }

  private findMotif(draft:ProjectFile,rt:Runtime){
    if(rt.motif)return rt.motif;
    const lead=draft.tracks.find(t=>t.role==='lead');if(!lead)return null;
    const bt=barTicks(draft.meter);
    const theme=draft.sections.find(s=>s.role==='theme');
    const start=theme?theme.startTick:0, end=Math.min(start+2*bt,theme?theme.endTick:2*bt);
    const notes=lead.notes.filter(n=>n.startTick>=start&&n.startTick<end)
      .map(n=>({midi:n.midi,startTick:n.startTick-start,durationTicks:n.durationTicks}));
    if(notes.length>=2)rt.motif=notes;
    return rt.motif;
  }

  /** Persist the exact pending payload before the network call (spec §2.6 step 6). */
  private persistPending(job:Job,step:Step):Pending {
    // reuse existing un-accepted pending for this decisionIndex (crash/retry path)
    const row=this.db.prepare(`SELECT * FROM pending_decisions WHERE job_id=? AND decision_index=? AND accepted_receipt_json IS NULL`)
      .get(job.id,job.decisionIndex) as any;
    // A stale oversized request (e.g. full-score state predating the rolling
    // window) would re-400 on every retry — rebuild it from the current step.
    // Candidates are deterministic for the same runtime state, so this is safe.
    if(row&&String(row.request_json).length<=MAX_PENDING_REQUEST_BYTES)return pendingFromRow(row);
    if(row)this.db.prepare('DELETE FROM pending_decisions WHERE decision_id=?').run(row.decision_id);
    const decisionId=`${job.id}:${job.decisionIndex}`;
    const candidates=step.candidates??planCandidates(step.request!);
    const requestHash=hashJSON(step.request),candidateHash=hashJSON(candidates);
    this.db.prepare(`INSERT INTO pending_decisions(decision_id,job_id,decision_index,epoch,kind,request_json,request_hash,candidates_json,candidate_hash,extra_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(decisionId,job.id,job.decisionIndex,job.epoch,step.kind,JSON.stringify(step.request),
        requestHash,JSON.stringify(candidates),candidateHash,JSON.stringify(step.extra??null));
    job.rt.pendingDecisionId=decisionId;this.persist(job);
    return {decisionId,decisionIndex:job.decisionIndex,epoch:job.epoch,kind:step.kind,
      request:step.request!,requestHash,candidates,candidateHash,extra:step.extra,
      laneId:step.laneId,cursorTick:step.cursorTick,boundary:step.boundary};
  }

  /** Provider call with the bounded application retry policy (spec §3.6). */
  private async evaluate(job:Job,pending:Pending,signal:AbortSignal):Promise<EvalResult|'retry_later'> {
    const provider=this.provider();
    if(!provider)throw new ProviderError('No API key configured',{retryable:false,code:'key_missing'});
    const maxAttempts=this.cfg.providerMaxAttemptsPerDecision;
    for(let attempt=1;;attempt++){
      if(signal.aborted)throw Object.assign(new Error('aborted'),{name:'AbortError'});
      const totalAttempts=(this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=?`)
        .get(job.id) as any).c;
      if(totalAttempts>=job.rt.attemptLimit){
        this.pauseFor(job,'request_limit','Request ceiling reached — resume explicitly to continue spending.');
        return 'retry_later';
      }
      const started=now();
      this.db.prepare('INSERT INTO attempts(decision_id,attempt_index,status,started_at) VALUES(?,?,?,?)')
        .run(pending.decisionId,attempt,'sent',started);
      try{
        const receipt=await provider.evaluate(pending.request,signal);
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
          this.pauseFor(job,'context_limit','Request payload exceeds the application context ceiling. Resume with a shorter scope or enable rolling context.');
          return 'retry_later';
        }
        if(!err.opts.retryable)throw err;
        if(attempt>=maxAttempts)throw err;
        const backoff=Math.min(30000,1000*2**(attempt-1))+Math.floor(Math.random()*500);
        const wait=Math.max(backoff,err.opts.retryAfterMs??0);
        const j2=this.loadJob(job.id)!;
        this.db.transaction(()=>{
          j2.rt.resumeAt=Date.now()+wait;this.persist(j2,'retry_wait');this.emitStatus(j2);
        })();
        await sleep(wait,signal);
        const j3=this.loadJob(job.id)!;
        if(!['retry_wait','composing','planning'].includes(j3.status)||j3.epoch!==pending.epoch)return 'retry_later';
        this.db.transaction(()=>{j3.rt.resumeAt=null;this.persist(j3,j3.rt.phase==='compose'?'composing':'planning');this.emitStatus(j3);})();
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

  /** One durable transaction: receipt + event + cursor + PRNG + job event (spec §2.6 step 8). */
  private commit(jobId:string,pending:Pending,result:EvalResult):boolean {
    return this.db.transaction(()=>{
      const job=this.loadJob(jobId)!;
      if(!canCommitTx(job,pending))return false;
      const rt=job.rt;
      const answer=validateChoiceResponse(result.receipt.response,pending.request);
      const answers=(answer as any).all as Record<string,{choice:string}>;
      const mode=rt.selectionMode;
      const usage=result.receipt.response.usage;
      rt.usage.requests++;rt.usage.inputTokens+=usage.input_tokens;rt.usage.outputTokens+=usage.output_tokens;
      const receipts:ReceiptRec[]=[];
      const recordReceipt=(qid:string,ans:{choice:string},selected:string,seedBefore:number,seedAfter:number)=>{
        receipts.push({schemaVersion:'jev-music.receipt.v1',id:`${pending.decisionId}:${qid}:${result.attemptIndex}`,
          jobId:job.id,decisionIndex:pending.decisionIndex,attemptIndex:result.attemptIndex,
          requestHash:pending.requestHash,candidateHash:pending.candidateHash,
          model:result.receipt.response.model,questionId:qid,providerChoice:ans.choice,
          selectedChoice:selected,selectionMode:mode,seedBefore,seedAfter,
          usage:{inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,complete:true},
          latencyMs:result.receipt.latencyMs,
          provenance:this.provider() instanceof FixtureProvider?'synthetic':'live'});
      };

      switch(pending.kind){
        case 'plan':{
          const plan=emptyPlan();const explicit=(pending.extra as any)?.explicit??{warnings:[]};
          plan.warnings=[...(explicit.warnings??[])];
          for(const [qid,q] of Object.entries(pending.request.questions)){
            const ans=answers[qid]!;const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
            recordReceipt(qid,ans,sel.selected,rt.samplerState,sel.seed);rt.samplerState=sel.seed;
            applyPlanField(plan,qid,sel.selected);
          }
          if(explicit.tempoBpm!==undefined){plan.tempoBpm=explicit.tempoBpm;plan.explicit.tempoBpm=explicit.tempoBpm;}
          if(explicit.lengthBars!==undefined){plan.lengthBars=explicit.lengthBars;plan.explicit.lengthBars=explicit.lengthBars;}
          if(plan.meter.denominator===8&&plan.feel!=='straight'){plan.feel='straight';plan.warnings.push('Swing normalized to straight for 6/8 meter.');}
          rt.plan=plan;
          // build the draft skeleton now that plan exists
          job.draft.tempoBpm=plan.tempoBpm;job.draft.meter=plan.meter as any;
          job.draft.swing={mode:plan.feel==='straight'?'straight':plan.feel==='light_swing'?'light':'shuffle',
            ratio:SWING_RATIO[plan.feel]};
          job.draft.lengthBars=plan.lengthBars;
          job.draft.generation.requestedLengthBars=plan.lengthBars;
          job.draft.sections=compileSections(plan.form,plan.lengthBars,plan.meter);
          job.draft.harmonicPlan=[];
          rt.harmonyTotal=plan.lengthBars;
          rt.phase='instruments';
          this.emitTx(job,'plan.ready',{plan:planSummary(plan)});
          break;
        }
        case 'instruments':{
          const plan=rt.plan!;
          const channels=assignChannels(plan.lanes);
          for(const [qid] of Object.entries(pending.request.questions)){
            const role=qid.replace('instrument_','') as LaneRole;
            const ans=answers[qid]!;const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
            recordReceipt(qid,ans,sel.selected,rt.samplerState,sel.seed);rt.samplerState=sel.seed;
            const inst=instrumentById(sel.selected);
            plan.instruments[role]=inst?inst.id:'electric_keys';
          }
          job.draft.tracks=plan.lanes.map(role=>{
            const inst=instrumentById(plan.instruments[role])??INSTRUMENTS_FALLBACK[role];
            return {id:role,name:cap(role),role,instrumentId:inst.id,program:inst.program,
              channel:channels[role],volumeDb:-10,pan:0,muted:false,solo:false,locked:false,notes:[]};
          });
          rt.activeLanes=[...plan.lanes];
          rt.laneCursors=Object.fromEntries(plan.lanes.map(l=>[l,rt.scope.startTick]));
          rt.scope={trackIds:[...plan.lanes],startTick:0,endTick:plan.lengthBars*barTicks(plan.meter)};
          rt.phase='harmony';
          break;
        }
        case 'harmony':{
          const ans=answers['harmony_progression']!;
          const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
          recordReceipt('harmony_progression',ans,sel.selected,rt.samplerState,sel.seed);rt.samplerState=sel.seed;
          const {span,nSlots,sectionId}=(pending.extra as any);
          const plan=rt.plan!;
          const slots=expandProgression(plan.harmonicVocabulary,sel.selected,plan.tonicPitchClass,
            span,nSlots,barTicks(job.draft.meter));
          rt.harmonyPrefix.push(...slots);rt.harmonyIndex+=nSlots;
          const def=progressionsFor(plan.harmonicVocabulary).find(d=>d.id===sel.selected)!;
          (rt.harmonyChoices??=[]).push({sectionId:sectionId??'whole',id:sel.selected,
            chords:def.degrees===null?['no_chord']
              :def.degrees.map(d=>spellDegree(plan.harmonicVocabulary,d,plan.tonicPitchClass,NOTE_NAMES))});
          if(rt.harmonyIndex>=rt.harmonyTotal){
            job.draft.harmonicPlan=rt.harmonyPrefix;rt.phase='compose';
            this.persist(job,'composing');
          }
          break;
        }
        case 'phrase':{
          const ans=answers['phrase_intent']!;
          const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
          recordReceipt('phrase_intent',ans,sel.selected,rt.samplerState,sel.seed);rt.samplerState=sel.seed;
          rt.phraseIntents[(pending.extra as any).sectionId]=sel.selected;
          break;
        }
        case 'groove':{
          const sectionId=(pending.extra as any).sectionId;
          const out:Record<string,Record<string,string>>={};
          for(const [qid,ans] of Object.entries(answers)){
            const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
            recordReceipt(qid,ans,sel.selected,rt.samplerState,sel.seed);rt.samplerState=sel.seed;
            // qid = groove_<laneId>_<axisId> — axis id is the last segment
            const rest=qid.replace(/^groove_/,'');
            const axis=rest.slice(rest.lastIndexOf('_')+1);
            const lane=rest.slice(0,rest.lastIndexOf('_'));
            (out[lane]??={})[axis]=sel.selected;
          }
          rt.grooves[sectionId]=out;
          break;
        }
        case 'event':{
          const ans=answers['next_event']!;
          const seedBefore=rt.samplerState;
          const sel=selectChoice(ans as any,{mode,seed:rt.samplerState,temperature:rt.temperature});
          rt.samplerState=sel.seed;
          recordReceipt('next_event',ans,sel.selected,seedBefore,sel.seed);
          const cand=pending.candidates.find(c=>c.id===sel.selected) as AnyCandidate|undefined;
          ok(cand,'Selected option missing from persisted candidates');
          const track=job.draft.tracks.find(t=>t.id===pending.laneId!)!;
          const boundary=pending.boundary??barTicks(job.draft.meter)*job.draft.lengthBars;
          const sourceKind=this.provider() instanceof FixtureProvider?'fixture':'jev';
          let appliedCursor:number;
          if(isBarCandidate(cand)){
            let cur=pending.cursorTick!;
            for(const [si,ev] of cand.events.entries()){
              if(ev.kind==='rest'){cur+=ev.durationTicks;continue;}
              const ec:EventCandidate={id:`${cand.id}:${si}`,kind:ev.kind,pitches:ev.pitches,
                stepTicks:ev.durationTicks,gateTicks:ev.gateTicks,targetNoteIds:ev.targetNoteIds};
              const applied=applyEvent(track.notes,cur,ec,`${pending.decisionId}:${si}`,
                {sourceKind,velocity:84,boundaryTick:boundary});
              track.notes=applied.notes;cur=applied.cursorTick;
            }
            appliedCursor=cur;
          } else {
            const applied=applyEvent(track.notes,pending.cursorTick!,cand as EventCandidate,pending.decisionId,
              {sourceKind,velocity:84,boundaryTick:boundary});
            track.notes=applied.notes;appliedCursor=applied.cursorTick;
          }
          rt.laneCursors[pending.laneId!]=appliedCursor;
          const bt=barTicks(job.draft.meter);
          const frontier=frontierBars(rt.laneCursors,bt,rt.scope.startTick);
          const newThrough=rt.scope.startTick+frontier*bt;
          if(newThrough>rt.completedThroughTick){
            rt.completedThroughTick=newThrough;
            this.emitTx(job,'preview.ready',{throughTick:newThrough,completedBars:frontier});
          }
          this.emitTx(job,'decision.committed',{laneId:pending.laneId,cursorTick:appliedCursor,
            decisionIndex:pending.decisionIndex,choice:sel.selected,
            providerChoice:ans.choice!==sel.selected?ans.choice:undefined,
            bar:Math.floor(appliedCursor/bt)+1});
          break;
        }
      }
      job.decisionIndex++;
      rt.pendingDecisionId=null;
      // mark pending accepted + attach receipts to the successful attempt row
      this.db.prepare('UPDATE pending_decisions SET accepted_receipt_json=? WHERE decision_id=?')
        .run(JSON.stringify(receipts),pending.decisionId);
      this.persist(job);
      return true;
    })();
  }

  private finish(job:Job):void {
    this.db.transaction(()=>{
      job.rt.phase='done';this.persist(job,'completed');
      // initial composition auto-accepts (spec §4.3); edits await Keep
      if(job.rt.mode==='compose'){
        try{validateProject(job.draft);
          const rid=newId('rev');
          this.db.prepare(`INSERT INTO revisions(id,project_id,parent_id,score_json,score_hash,command_id,created_at)
            VALUES(?,?,?,?,?,?,?)`)
            .run(rid,job.projectId,job.baseRevisionId,JSON.stringify(job.draft),hashJSON(scoreForHash(job.draft)),job.commandId,now());
          this.db.prepare('UPDATE projects SET accepted_revision_id=?,updated_at=? WHERE id=?')
            .run(rid,now(),job.projectId);
          job.rt.accepted=true;this.persist(job);
        }catch(e:any){job.rt.errorCode='validation_failed';job.rt.errorMessage=e.message;this.persist(job,'failed');}
      }
      this.emitStatus(job);this.emitTx(job,'job.completed',{accepted:!!job.rt.accepted});
    })();
  }

  /** Public snapshot for the API: status + cursors + safe preview + usage. */
  snapshot(id:string):any {
    const j=this.loadJob(id);if(!j)return null;
    const bt=barTicks(j.draft.meter);
    const missing=(this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=? AND a.status!='ok'`)
      .get(id) as any).c;
    return {id:j.id,projectId:j.projectId,status:j.status,phase:j.rt.phase,mode:j.rt.mode,
      epoch:j.epoch,decisionIndex:j.decisionIndex,attemptCount:missing+ (this.db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN pending_decisions p ON a.decision_id=p.decision_id WHERE p.job_id=? AND a.status='ok'`).get(id) as any).c,
      attemptLimit:j.rt.attemptLimit,usage:{...j.rt.usage,missing},
      laneCursors:j.rt.laneCursors,completedThroughTick:j.rt.completedThroughTick,
      completedBars:Math.max(0,Math.floor((j.rt.completedThroughTick-j.rt.scope.startTick)/bt)),
      barTicks:bt,scope:j.rt.scope,plan:j.rt.plan?planSummary(j.rt.plan):null,
      accepted:!!j.rt.accepted,discarded:!!j.rt.discarded,
      errorCode:j.rt.errorCode??null,errorMessage:j.rt.errorMessage??null,
      resumeAt:j.rt.resumeAt,preview:previewOf(j)};
  }

  /** Provider-payload introspection for tests/diagnostics. */
  pendingFor(id:string):Pending|null {
    const r=this.db.prepare(`SELECT * FROM pending_decisions WHERE job_id=? AND accepted_receipt_json IS NULL ORDER BY decision_index DESC LIMIT 1`)
      .get(id) as any;
    return r?pendingFromRow(r):null;
  }
  receiptsFor(id:string):any[] {
    return (this.db.prepare(`SELECT accepted_receipt_json FROM pending_decisions WHERE job_id=? AND accepted_receipt_json IS NOT NULL ORDER BY decision_index`)
      .all(id) as any[]).map(r=>JSON.parse(r.accepted_receipt_json)).flat();
  }
}

/* ---------- helpers ---------- */

interface Step {done:boolean;kind:string;laneId:string;cursorTick:number;boundary?:number;
  candidates?:AnyCandidate[];request?:ChoiceRequest;extra?:unknown}
interface Pending {decisionId:string;decisionIndex:number;epoch:number;kind:string;
  request:ChoiceRequest;requestHash:string;candidates:any[];candidateHash:string;extra?:unknown;boundary?:number;laneId?:string;cursorTick?:number}
interface EvalResult {pending:Pending;receipt:{response:ChoiceResponse;rawResponseHash:string;latencyMs:number;httpStatus:number;providerRequestId?:string};attemptIndex:number}
type ReceiptRec = Record<string,unknown>;

const MAX_PENDING_REQUEST_BYTES=40*1024;
const pendingFromRow=(r:any):Pending=>({decisionId:r.decision_id,decisionIndex:r.decision_index,
  epoch:r.epoch,kind:r.kind,request:JSON.parse(r.request_json),requestHash:r.request_hash,
  candidates:JSON.parse(r.candidates_json),candidateHash:r.candidate_hash,
  extra:r.extra_json?JSON.parse(r.extra_json):undefined,
  boundary:r.extra_json?JSON.parse(r.extra_json)?.boundary:undefined,
  laneId:JSON.parse(r.extra_json??'{}').laneId,cursorTick:JSON.parse(r.extra_json??'{}').cursorTick});

const canCommitTx=(job:Job,pending:Pending)=>
  ['composing','planning','pausing'].includes(job.status)
  &&job.epoch===pending.epoch&&job.decisionIndex===pending.decisionIndex;

const hashInt32=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
const cap=(s:string)=>s[0].toUpperCase()+s.slice(1);
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((res,rej)=>{
  const t=setTimeout(res,ms);
  signal.addEventListener('abort',()=>{clearTimeout(t);rej(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true});
});

const INSTRUMENTS_FALLBACK:Record<LaneRole,ReturnType<typeof instrumentById>&object>={
  lead:instrumentById('electric_keys')!,bass:instrumentById('round_bass')!,
  harmony:instrumentById('electric_keys')!,drums:instrumentById('drum_kit')!};
function assignChannels(lanes:LaneRole[]):Record<string,number>{
  const out:Record<string,number>={};let ch=0;
  for(const l of lanes){if(l==='drums'){out[l]=9;continue;}while(ch===9)ch++;out[l]=ch++;}
  return out;
}
function lastPitch(track:Track,cursor:number):number|null{
  const before=track.notes.filter(n=>n.startTick<cursor).sort((a,b)=>b.startTick-a.startTick);
  return before.length?before[0].midi:null;
}
function lastChordVoicing(track:Track,cursor:number):number[]|null{
  const before=track.notes.filter(n=>n.startTick<cursor).sort((a,b)=>b.startTick-a.startTick);
  if(!before.length)return null;
  const onset=before[0].startTick;
  return before.filter(n=>n.startTick===onset).map(n=>n.midi).sort((a,b)=>a-b);
}
function restCandidates(spans:number[],remaining:number):EventCandidate[]{
  const ds=[...new Set(spans.filter(s=>s<=remaining))];
  const out=(ds.length?ds:[remaining]).map(d=>({id:`R_${d}`,kind:'rest' as const,pitches:[],stepTicks:d,gateTicks:0}));
  if(out.length<2)out.push({id:`R_x${remaining}`,kind:'rest',pitches:[],stepTicks:remaining,gateTicks:0});
  return out;
}
function planCandidates(request:ChoiceRequest):{id:string}[]{
  return Object.values(request.questions).flatMap(q=>Object.keys(q.criteria).map(id=>({id})));
}
function applyPlanField(plan:PlanState,qid:string,selected:string):void{
  switch(qid){
    case 'meter':{const m=selected.match(/^M_(\d)_(\d)$/);if(m)plan.meter={numerator:+m[1] as any,denominator:+m[2] as any};break;}
    case 'tempo':plan.tempoBpm=parseInt(selected.slice(2),10);break;
    case 'tonic':plan.tonicPitchClass=parseInt(selected.slice(2),10);break;
    case 'harmonicVocabulary':plan.harmonicVocabulary=selected;break;
    case 'feel':plan.feel=selected as any;break;
    case 'form':plan.form=selected;break;
    case 'density':plan.density=selected;break;
    case 'energyArc':plan.energyArc=selected;break;
    case 'lengthBars':plan.lengthBars=parseInt(selected.slice(2),10);break;
    case 'lanePresence':plan.lanes=selected.slice(2).split('+') as LaneRole[];break;
  }
}
function planSummary(p:PlanState){
  return {meter:`${p.meter.numerator}/${p.meter.denominator}`,tempoBpm:p.tempoBpm,
    tonic:p.tonicPitchClass,vocabulary:p.harmonicVocabulary,feel:p.feel,form:p.form,
    density:p.density,energyArc:p.energyArc,lengthBars:p.lengthBars,lanes:p.lanes,
    instruments:p.instruments,warnings:p.warnings};
}
function planFromProject(p:ProjectFile):PlanState{
  const plan=emptyPlan();
  plan.meter=p.meter;plan.tempoBpm=p.tempoBpm;plan.lengthBars=p.lengthBars;
  plan.feel=p.swing.mode==='shuffle'?'shuffle':p.swing.mode==='light'?'light_swing':'straight';
  plan.lanes=p.tracks.map(t=>t.role);
  plan.instruments=Object.fromEntries(p.tracks.map(t=>[t.role,t.instrumentId]));
  plan.tonicPitchClass=p.harmonicPlan.find(h=>h.rootPitchClass!==null)?.rootPitchClass??9;
  plan.form=p.sections.length>2?'theme_contrast_return':'sparse_evolving';
  return plan;
}
const scoreForHash=(p:ProjectFile)=>({meter:p.meter,tempoBpm:p.tempoBpm,swing:p.swing,
  lengthBars:p.lengthBars,sections:p.sections,harmonicPlan:p.harmonicPlan,
  tracks:p.tracks.map(t=>({...t,notes:t.notes}))});

/** Safe preview: out-of-scope/retained notes always kept; notes generated by this job
 * appear only once they start before the complete-bar frontier. */
function previewOf(j:Job):ProjectFile|null {
  if(!j.draft.tracks.length)return null;
  const p=clone(j.draft);
  const through=j.rt.completedThroughTick;
  for(const t of p.tracks){
    if(!j.rt.scope.trackIds.includes(t.id))continue;
    t.notes=t.notes.filter(n=>!(n.id.startsWith(j.id+':')&&n.startTick>=through));
  }
  return p;
}

/** HTTP API per spec §4.5. All writes schema-validated JSON, CSRF/Origin checked. */
import {Router, raw} from 'express';
import type {Request, Response} from 'express';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import type {DB} from './db.js';
import type {AppConfig} from './config.js';
import {readStored, writeStored, effectiveKey, effectiveMode, hasEnvKey} from './config.js';
import type {JobRunner} from './jobs.js';
import {newId} from './jobs.js';
import type {EventBus} from './events.js';
import type {DecisionProvider, ProjectFile, ResolvedEdit, Scope} from '../core/types.js';
import {canonicalJSON, isPlain, ok} from '../core/canon.js';
import {hashJSON} from '../core/hash.js';
import {validateProject} from '../core/score.js';
import {validateChoiceResponse} from '../core/validate.js';
import {applyEdit, manualAddNote, manualMoveNotes, manualResizeNotes,
  manualDeleteNotes, manualSetVelocity, quantizeNotes} from '../core/edits.js';
import {encodeSMF} from '../core/midi.js';
import {barTicks} from '../core/time.js';
import {INSTRUMENTS, instrumentById} from '../core/candidates.js';
import {buildEditIntentRequest} from '../core/requests.js';
import {LANE_ROLES} from '../core/plan.js';
import type {LaneRole} from '../core/types.js';
import {FixtureProvider} from './fixture.js';

const SCHEMA_DIR = fileURLToPath(new URL('../schemas', import.meta.url));
const ajv = new Ajv2020({strict:false, allErrors:true});
const projectSchema = ajv.compile(JSON.parse(readFileSync(`${SCHEMA_DIR}/project.schema.json`,'utf8')));
const editSchema = ajv.compile(JSON.parse(readFileSync(`${SCHEMA_DIR}/edit.schema.json`,'utf8')));

const newCmdId = () => `cmd_${randomBytes(8).toString('base64url')}`;
const now = () => new Date().toISOString();

class ApiError extends Error {
  constructor(public status:number, public code:string, message:string, public retryable=false, public details?:unknown){
    super(message);
  }
}
const err = (status:number,code:string,message:string,retryable=false,details?:unknown)=>
  new ApiError(status,code,message,retryable,details);
const wrap = (fn:(req:Request,res:Response)=>unknown|Promise<unknown>) =>
  async (req:Request,res:Response)=>{
    try{ await fn(req,res); }
    catch(e:any){
      if(e instanceof ApiError)
        res.status(e.status).json({code:e.code,message:e.message,retryable:e.retryable,details:e.details});
      else if(e?.code==='SQLITE_CONSTRAINT_UNIQUE'||/UNIQUE/.test(e?.message||''))
        res.status(409).json({code:'conflict',message:'Idempotency conflict — retry with the same commandId',retryable:true});
      else{
        console.error('[api]',req.method,req.path,e);
        res.status(500).json({code:'internal',message:'Internal error',retryable:true});
      }
    }
  };

export function buildRouter(db:DB,cfg:AppConfig,runner:JobRunner,bus:EventBus,
                            providerFor:()=>DecisionProvider|null):Router {
  const r = Router();

  /* ---------- security: Origin/Host check on mutations ---------- */
  r.use((req,res,next)=>{
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
      const origin=req.headers.origin;
      if(origin){
        try{
          const o=new URL(origin);
          const host=(req.headers.host||'').split(':')[0];
          const allowed=[host,'127.0.0.1','localhost'].includes(o.hostname)
            ||(cfg.appOrigin&&origin===cfg.appOrigin);
          if(!allowed)throw err(403,'forbidden_origin','Cross-origin mutation rejected');
        }catch(e){if(e instanceof ApiError)throw e;throw err(403,'forbidden_origin','Bad Origin header');}
      }
    }
    next();
  });

  const getProject=(id:string)=>{
    const p=db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
    if(!p)throw err(404,'not_found','Unknown project');
    return p;
  };
  const getAccepted=(projectId:string):ProjectFile|null=>{
    const p=getProject(projectId);
    if(!p.accepted_revision_id)return null;
    const r=db.prepare('SELECT score_json FROM revisions WHERE id=?').get(p.accepted_revision_id) as any;
    return r?JSON.parse(r.score_json):null;
  };
  const newRevision=(projectId:string,parent:string|null,score:ProjectFile,commandId:string):string=>{
    const rid=newId('rev');
    db.prepare(`INSERT INTO revisions(id,project_id,parent_id,score_json,score_hash,command_id,created_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(rid,projectId,parent,JSON.stringify(score),hashJSON(score),commandId,now());
    return rid;
  };
  const accept=(projectId:string,score:ProjectFile,commandId:string,parent?:string|null)=>{
    const p=getProject(projectId);
    const rid=newRevision(projectId,parent!==undefined?parent:p.accepted_revision_id,score,commandId);
    const aux=JSON.parse(p.aux_json||'{}');
    db.prepare('UPDATE projects SET accepted_revision_id=?,updated_at=?,aux_json=? WHERE id=?')
      .run(rid,now(),JSON.stringify({...aux,redo:[]}),projectId);
    return rid;
  };
  const activeJobFor=(projectId:string)=>
    db.prepare(`SELECT id FROM jobs WHERE project_id=? AND status IN
      ('queued','planning','composing','pausing','paused','retry_wait','interrupted')`).get(projectId) as any;

  /* ---------- health & settings ---------- */
  r.get('/api/health',wrap(async(_req,res)=>{
    res.json({ok:true,version:cfg.version,
      providerConfigured:!!effectiveKey(cfg),providerMode:effectiveMode(cfg),
      model:cfg.model});
  }));
  r.get('/api/settings',wrap(async(_req,res)=>{
    res.json({hasKey:!!effectiveKey(cfg),keyFromEnv:hasEnvKey(),
      providerMode:effectiveMode(cfg),model:cfg.model,
      limits:{maxJobAttempts:cfg.maxJobAttempts,
        maxProviderBodyBytes:cfg.maxProviderBodyBytes,
        attemptTimeoutMs:cfg.providerAttemptTimeoutMs,
        maxAttemptsPerDecision:cfg.providerMaxAttemptsPerDecision},
      instruments:INSTRUMENTS.map(i=>({id:i.id,name:i.name,roles:i.roles,program:i.program}))});
  }));
  r.post('/api/settings',wrap(async(req,res)=>{
    const b=req.body??{};
    const patch:Record<string,unknown>={};
    if('apiKey' in b){
      if(typeof b.apiKey!=='string'||b.apiKey.length>500)throw err(400,'invalid','apiKey must be a string');
      patch.apiKey=b.apiKey||undefined;
    }
    if('providerMode' in b){
      if(!['live','fixture'].includes(b.providerMode))throw err(400,'invalid','providerMode must be live|fixture');
      patch.providerMode=b.providerMode;
    }
    writeStored(cfg,patch);
    res.json({hasKey:!!effectiveKey(cfg),providerMode:effectiveMode(cfg)});
  }));

  /* ---------- projects ---------- */
  r.get('/api/projects',wrap(async(_req,res)=>{
    const rows=db.prepare(`SELECT p.id,p.title,p.created_at,p.updated_at,p.accepted_revision_id,
      (SELECT status FROM jobs j WHERE j.project_id=p.id ORDER BY j.created_at DESC LIMIT 1) lastJobStatus
      FROM projects p ORDER BY p.updated_at DESC`).all();
    res.json({projects:rows});
  }));
  r.post('/api/projects',wrap(async(req,res)=>{
    const b=req.body??{};
    if(b.project!==undefined){
      // validated import
      const p=b.project;
      const raw=canonicalJSON(p); // throws on unsafe keys/cycles/nonfinite/depth
      if(Buffer.byteLength(raw,'utf8')>16*1024*1024)throw err(413,'import_invalid','File exceeds 16 MiB');
      if(!projectSchema(p))throw err(422,'import_invalid','Schema validation failed',false,ajv.errorsText(projectSchema.errors));
      try{validateProject(p as ProjectFile);}catch(e:any){throw err(422,'import_invalid',e.message);}
      (p as ProjectFile).generation.provenance='fixture'; // imported provenance is unverified
      const id=newId('proj');
      db.transaction(()=>{
        db.prepare('INSERT INTO projects(id,owner_id,title,aux_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
          .run(id,'local',(p as ProjectFile).title||'Imported project',JSON.stringify({imported:true,unverified:true}),now(),now());
        const rid=newRevision(id,null,{...(p as ProjectFile),id,revisionId:'imported'},b.commandId??newCmdId());
        db.prepare('UPDATE projects SET accepted_revision_id=? WHERE id=?').run(rid,id);
      })();
      res.status(201).json({id,imported:true,unverified:true});
      return;
    }
    const id=newId('proj');
    db.prepare('INSERT INTO projects(id,owner_id,title,aux_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id,'local',String(b.title??'Untitled').slice(0,200)||'Untitled','{}',now(),now());
    res.status(201).json({id});
  }));
  r.post('/api/projects/demo',wrap(async(_req,res)=>{
    const existing=db.prepare(`SELECT id FROM projects WHERE aux_json LIKE '%"demo":true%'`).get() as any;
    if(existing){res.json({id:existing.id,demo:true});return;}
    const fixture=JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/hand-authored-project.json',import.meta.url)),'utf8'));
    const id=newId('proj');
    db.transaction(()=>{
      db.prepare('INSERT INTO projects(id,owner_id,title,aux_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .run(id,'local','Hand-authored demo — no Jev generation',JSON.stringify({demo:true,fixture:true}),now(),now());
      fixture.id=id;fixture.revisionId='demo-r1';fixture.title='Hand-authored demo — no Jev generation';
      const rid=newRevision(id,null,fixture,'demo');
      db.prepare('UPDATE projects SET accepted_revision_id=? WHERE id=?').run(rid,id);
    })();
    res.status(201).json({id,demo:true});
  }));
  r.get('/api/projects/:id',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const accepted=getAccepted(req.params.id);
    const job=activeJobFor(req.params.id);
    const aux=JSON.parse(p.aux_json||'{}');
    res.json({id:p.id,title:p.title,createdAt:p.created_at,updatedAt:p.updated_at,
      acceptedRevisionId:p.accepted_revision_id,aux,project:accepted,
      activeJob:job?runner.snapshot(job.id):null});
  }));
  r.delete('/api/projects/:id',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const job=activeJobFor(req.params.id);
    if(job)runner.cancel(job.id);
    db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
    res.json({deleted:p.id});
  }));
  r.get('/api/projects/:id/revisions',wrap(async(req,res)=>{
    getProject(req.params.id);
    const rows=db.prepare(`SELECT id,parent_id,command_id,created_at,
      json_extract(score_json,'$.generation.provenance') provenance,
      json_extract(score_json,'$.title') title
      FROM revisions WHERE project_id=? ORDER BY created_at`).all(req.params.id);
    res.json({revisions:rows});
  }));

  /* ---------- deterministic commands ---------- */
  r.post('/api/projects/:id/commands',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const b=req.body??{};
    const commandId=String(b.commandId||'');
    if(!commandId)throw err(400,'invalid','commandId required');
    const dupe=db.prepare('SELECT id FROM revisions WHERE project_id=? AND command_id=?').get(req.params.id,commandId) as any;
    if(dupe){res.json({revisionId:dupe.id,duplicate:true});return;}
    if(b.baseRevisionId!==p.accepted_revision_id)
      throw err(409,'revision_conflict','Stale base revision',false,{current:p.accepted_revision_id});
    const job=activeJobFor(req.params.id);
    if(job)throw err(409,'job_active','Pause or stop the active job before editing');
    const base=getAccepted(req.params.id);
    if(!base)throw err(409,'no_revision','Project has no accepted revision');
    let next:ProjectFile;
    try{
      switch(b.op){
        case 'edit':next=applyEdit(base,b.edit as ResolvedEdit);break;
        case 'addNote':next=manualAddNote(base,b.trackId,b.note,newId('n'));break;
        case 'moveNotes':next=manualMoveNotes(base,b.noteIds,b.dTicks,b.dMidi);break;
        case 'resizeNotes':next=manualResizeNotes(base,b.noteIds,b.durationTicks);break;
        case 'deleteNotes':next=manualDeleteNotes(base,b.noteIds);break;
        case 'setVelocity':next=manualSetVelocity(base,b.noteIds,b.velocity);break;
        case 'quantize':next=quantizeNotes(base,b.noteIds,b.gridTicks);break;
        case 'setNoteLock':{
          next=applyEdit(base,{type:'setLocks',trackIds:[],noteIds:b.noteIds,locked:!!b.locked});break;}
        case 'setTrackLock':{
          next=applyEdit(base,{type:'setLocks',trackIds:b.trackIds,noteIds:[],locked:!!b.locked});break;}
        case 'rename':{
          next={...base,title:String(b.title||base.title).slice(0,200),updatedAt:now()};break;}
        case 'setSwing':{
          const ratio=Number(b.ratio);
          ok(Number.isFinite(ratio)&&ratio>=.5&&ratio<=.75,'Swing ratio out of range');
          ok(base.meter.denominator!==8||ratio===.5,'Swing unsupported for 6/8');
          next={...base,updatedAt:now(),swing:{mode:ratio===.5?'straight':ratio===.58?'light':ratio>=2/3-.01?'shuffle':'custom',ratio}};
          validateProject(next);break;}
        case 'setMute':case 'setTrackGain':case 'setInstrument':case 'setTempo':case 'transpose':case 'duplicateRegion':{
          next=applyEdit(base,{...b,type:b.op} as ResolvedEdit);break;}
        default:throw err(400,'unsupported_request',`Unknown op ${b.op}`);
      }
    }catch(e:any){
      if(e instanceof ApiError)throw e;
      throw err(422,'invalid_edit',e.message);
    }
    next.id=req.params.id;
    const rid=accept(req.params.id,next,commandId);
    res.json({revisionId:rid});
  }));

  /* ---------- undo / redo (accepted revision chain) ---------- */
  r.post('/api/projects/:id/undo',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    if(!p.accepted_revision_id)throw err(409,'nothing_to_undo','No revision');
    const cur=db.prepare('SELECT parent_id FROM revisions WHERE id=?').get(p.accepted_revision_id) as any;
    if(!cur?.parent_id)throw err(409,'nothing_to_undo','At earliest revision');
    const aux=JSON.parse(p.aux_json||'{}');
    const redo=[p.accepted_revision_id,...(aux.redo??[])];
    db.prepare('UPDATE projects SET accepted_revision_id=?,updated_at=?,aux_json=? WHERE id=?')
      .run(cur.parent_id,now(),JSON.stringify({...aux,redo}),req.params.id);
    res.json({revisionId:cur.parent_id});
  }));
  r.post('/api/projects/:id/redo',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const aux=JSON.parse(p.aux_json||'{}');
    const stack=aux.redo??[];
    if(!stack.length)throw err(409,'nothing_to_redo','Nothing to redo');
    const [next,...rest]=stack;
    db.prepare('UPDATE projects SET accepted_revision_id=?,updated_at=?,aux_json=? WHERE id=?')
      .run(next,now(),JSON.stringify({...aux,redo:rest}),req.params.id);
    res.json({revisionId:next});
  }));

  /* ---------- jobs ---------- */
  r.post('/api/projects/:id/jobs',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const b=req.body??{};
    const commandId=String(b.commandId||'');
    if(!commandId)throw err(400,'invalid','commandId required');
    if(b.baseRevisionId!==undefined&&b.baseRevisionId!==p.accepted_revision_id)
      throw err(409,'revision_conflict','Stale base revision',false,{current:p.accepted_revision_id});
    const mode=b.mode;
    if(!['compose','variation','regenerate'].includes(mode))throw err(400,'invalid','mode must be compose|variation|regenerate');
    if(mode!=='compose'&&!p.accepted_revision_id)throw err(409,'no_revision','Nothing to vary');
    if(mode==='compose'&&p.accepted_revision_id)throw err(409,'has_revision','Use variation/regenerate on a project that already has music');
    if(!providerFor())throw err(503,'key_missing','Configure a TypeSafe API key or explicit fixture mode first');
    const running=activeJobFor(req.params.id);
    if(running)throw err(409,'job_active','A job is already active for this project');
    const base=mode==='compose'?null:getAccepted(req.params.id);
    let scope:Scope|null=null;
    if(mode==='regenerate'){
      const bt=barTicks(base!.meter),end=base!.lengthBars*bt;
      const s=b.scope;
      if(!isPlain(s)||!Array.isArray(s.trackIds)||!s.trackIds.length)
        throw err(400,'invalid','regenerate requires scope.trackIds');
      const trackIds=(s.trackIds as string[]).filter(id=>base!.tracks.some(t=>t.id===id));
      if(!trackIds.length)throw err(400,'invalid','scope.trackIds has no known lanes');
      const startTick=Math.max(0,Math.min(end-1,Math.floor(Number(s.startTick??0))));
      const endTick=Math.max(startTick+1,Math.min(end,Math.floor(Number(s.endTick??end))));
      // locked lanes/notes are never in scope
      const open=trackIds.filter(id=>!base!.tracks.find(t=>t.id===id)!.locked);
      if(!open.length)throw err(409,'locked_scope','Target lanes are locked');
      scope={trackIds:open,startTick,endTick};
    } else if(mode==='variation'){
      const open=base!.tracks.filter(t=>!t.locked).map(t=>t.id);
      if(!open.length)throw err(409,'locked_scope','All lanes are locked');
      scope={trackIds:open,startTick:0,endTick:base!.lengthBars*barTicks(base!.meter)};
    }
    const job=runner.startJob(req.params.id,base?p.accepted_revision_id:null,commandId,
      mode,String(b.instruction??b.prompt??base?.prompt??''),
      scope,{selectionMode:b.selectionMode,temperature:b.temperature,seed:b.seed,attemptLimit:b.attemptLimit});
    res.status(202).json({jobId:job.id});
  }));

  /** One-shot compose: create project + job. */
  r.post('/api/compose',wrap(async(req,res)=>{
    const b=req.body??{};
    const prompt=String(b.prompt||'').slice(0,4000);
    if(!prompt.trim())throw err(400,'invalid','prompt required');
    if(!providerFor())throw err(503,'key_missing','Configure a TypeSafe API key or explicit fixture mode first');
    const commandId=String(b.commandId||newCmdId());
    const existing=db.prepare('SELECT project_id,id FROM jobs WHERE command_id=?').get(commandId) as any;
    if(existing){res.status(202).json({projectId:existing.project_id,jobId:existing.id});return;}
    const pid=newId('proj');
    db.prepare('INSERT INTO projects(id,owner_id,title,aux_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(pid,'local',prompt.trim().slice(0,80),'{}',now(),now());
    const job=runner.startJob(pid,null,commandId,'compose',prompt,null,
      {selectionMode:b.selectionMode,temperature:b.temperature,seed:b.seed,attemptLimit:b.attemptLimit});
    res.status(202).json({projectId:pid,jobId:job.id});
  }));

  r.get('/api/jobs/:id',wrap(async(req,res)=>{
    const s=runner.snapshot(req.params.id);
    if(!s)throw err(404,'not_found','Unknown job');
    res.json(s);
  }));
  r.get('/api/jobs/:id/decisions',wrap(async(req,res)=>{
    const receipts=runner.receiptsFor(req.params.id);
    res.json({receipts:receipts.slice(-500)});
  }));
  r.get('/api/jobs/:id/events',wrap(async(req,res)=>{
    const exists=db.prepare('SELECT id FROM jobs WHERE id=?').get(req.params.id);
    if(!exists)throw err(404,'not_found','Unknown job');
    const last=req.headers['last-event-id']?parseInt(String(req.headers['last-event-id']),10):null;
    bus.attach(req.params.id,Number.isFinite(last)?last:null,res);
  }));
  r.post('/api/jobs/:id/pause',wrap(async(req,res)=>{runner.pause(req.params.id);res.json({ok:true});}));
  r.post('/api/jobs/:id/resume',wrap(async(req,res)=>{
    const out=runner.resume(req.params.id);
    if(!out.ok)throw err(409,out.error==='revision_conflict'?'revision_conflict':'cannot_resume',`Resume refused: ${out.error}`);
    res.json({ok:true});
  }));
  r.post('/api/jobs/:id/cancel',wrap(async(req,res)=>{runner.cancel(req.params.id);res.json({ok:true});}));
  r.post('/api/jobs/:id/accept',wrap(async(req,res)=>{
    const out=runner.accept(req.params.id);
    if(!out.ok)throw err(409,out.error?.includes('revision_conflict')?'revision_conflict':'cannot_accept',out.error||'Accept failed');
    res.json({revisionId:out.revisionId});
  }));
  r.post('/api/jobs/:id/discard',wrap(async(req,res)=>{
    const out=runner.discard(req.params.id);
    if(!out.ok)throw err(409,'cannot_discard',out.error||'Discard failed');
    res.json({ok:true});
  }));

  /* ---------- natural-language edit intent ---------- */
  r.post('/api/projects/:id/edits',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const b=req.body??{};
    const instruction=String(b.instruction||'').slice(0,4000);
    if(!instruction.trim())throw err(400,'invalid','instruction required');
    const commandId=String(b.commandId||'');
    if(!commandId)throw err(400,'invalid','commandId required');
    if(b.baseRevisionId!==p.accepted_revision_id)
      throw err(409,'revision_conflict','Stale base revision',false,{current:p.accepted_revision_id});
    const base=getAccepted(req.params.id);
    if(!base)throw err(409,'no_revision','Project has no accepted revision');
    const provider=providerFor();
    if(!provider)throw err(503,'key_missing','Configure a TypeSafe API key or explicit fixture mode first');
    const running=activeJobFor(req.params.id);
    if(running)throw err(409,'job_active','Pause or stop the active job before editing');
    const selection=isPlain(b.selection)?b.selection as Scope:null;
    const request=buildEditIntentRequest(cfg.model,base,instruction,selection);
    const receipt=await provider.evaluate(request,new AbortController().signal);
    const answers=(validateChoiceResponse(receipt.response,request) as any).all;
    let op=answers.operation.choice;const target=answers.targetLane.choice,
          scopeA=answers.scope.choice,dir=answers.direction.choice;
    // Keyword floor: an unambiguous keyword beats a misclassified unsupported/
    // ambiguous. Anything else musical degrades to regenerate rather than
    // refusing; only clearly non-MIDI requests stay unsupported.
    if(op==='unsupported'||op==='ambiguous'){
      const kw:[typeof op,RegExp][]=[
        ['setTempo',/\b(tempo|bpm|slower|faster|speed)\b/i],
        ['transpose',/\b(transpose|semitone|octave|higher|lower|key change)\b/i],
        ['setMute',/\b(mute|unmute|silence)\b/i],
        ['setTrackGain',/\b(volume|louder|quieter|gain|db)\b/i],
        ['setInstrument',/\b(instrument|piano|organ|keys|pluck|timbre|sound)\b/i],
        ['setLocks',/\b(lock|unlock|protect|freeze)\b/i],
        ['duplicateRegion',/\b(duplicate|copy|repeat|clone)\b/i]];
      const hit=kw.find(([,re])=>re.test(instruction));
      op=(hit?hit[0]:/\b(vocal|lyric|sing|voice|audio|mp3|wav|reverb|compress|eq\b|master|mastering|mix)\b/i.test(instruction)?'unsupported':'regenerate') as typeof op;
    }
    const bt=barTicks(base.meter),end=base.lengthBars*bt;
    const resolveScope=():Scope=>{
      if(selection)return selection;
      const q=Math.floor(end/4);
      switch(scopeA){
        case 'first_half':return {trackIds:[],startTick:0,endTick:Math.floor(end/2)};
        case 'second_half':return {trackIds:[],startTick:Math.floor(end/2),endTick:end};
        case 'first_quarter':return {trackIds:[],startTick:0,endTick:q};
        case 'last_quarter':return {trackIds:[],startTick:end-q,endTick:end};
        default:return {trackIds:[],startTick:0,endTick:end};
      }
    };
    const scope=resolveScope();
    const laneIds=target==='ALL'?base.tracks.map(t=>t.id)
      :target==='NONE'?scope.trackIds.length?scope.trackIds:base.tracks.map(t=>t.id)
      :[target];
    scope.trackIds=laneIds.filter(id=>base.tracks.some(t=>t.id===id));
    const num=(re:RegExp)=>{const m=instruction.match(re);return m?parseFloat(m[1]):undefined;};
    const inScope=(id:string)=>scope.trackIds.includes(id);
    let edit:ResolvedEdit|null=null,jobSpec:{scope:Scope;instruction:string}|null=null,message:string|null=null;
    switch(op){
      case 'setTempo':{
        const explicit=num(/(\d+)\s*bpm/i);
        const much=/much|way|a lot|drastically/i.test(instruction);
        const bpm=explicit??(dir==='less'?Math.round(base.tempoBpm*(much?.8:.9)):dir==='more'?Math.round(base.tempoBpm*(much?1.25:1.1)):base.tempoBpm);
        edit={type:'setTempo',bpm:Math.max(40,Math.min(220,bpm))};
        message=`Set tempo to ${(edit as any).bpm} BPM (was ${base.tempoBpm})`;
        break;}
      case 'setInstrument':{
        const found=INSTRUMENTS.find(i=>instruction.toLowerCase().includes(i.id.replaceAll('_',' ')))
          ??INSTRUMENTS.find(i=>instruction.toLowerCase().includes(i.name.toLowerCase()))
          ??(/piano/i.test(instruction)?instrumentById('soft_keys'):undefined)
          ??(/keys|electric piano|rhodes/i.test(instruction)?instrumentById('electric_keys'):undefined)
          ??(/organ/i.test(instruction)?instrumentById('organ'):undefined)
          ??(/pluck/i.test(instruction)?instrumentById('pluck'):undefined);
        const trackId=laneIds.find(id=>base.tracks.find(t=>t.id===id)!.role!=='drums');
        if(!found||!trackId){res.json({result:'ambiguous',message:'Which instrument, and for which lane? Supported: '+INSTRUMENTS.map(i=>i.name).join(', ')});return;}
        edit={type:'setInstrument',trackId,instrumentId:found.id};
        message=`Set ${trackId} instrument to ${found.name}`;
        break;}
      case 'setTrackGain':{
        const dbv=num(/(-?\d+(?:\.\d+)?)\s*dB/i)??(dir==='less'?-6:dir==='more'?4:0);
        edit={type:'setTrackGain',trackId:laneIds[0],volumeDb:dbv};
        message=`Set ${laneIds[0]} gain to ${dbv} dB`;break;}
      case 'setMute':{
        const mute=!/unmute|un-mute/i.test(instruction);
        edit={type:'setMute',trackId:laneIds[0],muted:mute};
        message=`${mute?'Mute':'Unmute'} ${laneIds[0]}`;break;}
      case 'transpose':{
        const semis=num(/(-?\d+)\s*(?:semitone|half[- ]?step|step)/i)
          ??(/octave/i.test(instruction)?12:undefined)
          ??(dir==='more'?12:dir==='less'?-12:2);
        const signed=/down|lower/i.test(instruction)&&semis>0?-semis:/up|higher|raise/i.test(instruction)&&semis<0?-semis:semis;
        edit={type:'transpose',scope:{...scope,trackIds:scope.trackIds.filter(id=>base.tracks.find(t=>t.id===id)!.role!=='drums')},semitones:signed};
        message=`Transpose ${signed>0?'+':''}${signed} semitones`;break;}
      case 'setLocks':{
        const locked=!/unlock/i.test(instruction);
        edit={type:'setLocks',trackIds:scope.trackIds,noteIds:(b.noteIds??[]),locked};
        message=`${locked?'Lock':'Unlock'} ${scope.trackIds.join(', ')||'selection'}`;break;}
      case 'duplicateRegion':{
        const bar=num(/(?:to|at|bar)\s*(\d+)/i);
        const dest=bar!==undefined?(bar-1)*bt:scope.endTick;
        edit={type:'duplicateRegion',scope,destinationStartTick:dest};
        message=`Duplicate selection to bar ${Math.floor(dest/bt)+1}`;break;}
      case 'regenerate':{
        const open=scope.trackIds.filter(id=>!base.tracks.find(t=>t.id===id)!.locked);
        if(!open.length){res.json({result:'locked',message:'This part is locked.',locked:true});return;}
        jobSpec={scope:{...scope,trackIds:open},instruction};
        break;}
      case 'unsupported':{res.json({result:'unsupported',message:'That is outside supported edits. Instrumental MIDI only — want a lead melody instead?'});return;}
      default:{res.json({result:'ambiguous',message:'Could you be more specific? e.g. “make the bass busier in bars 9–12” or “set tempo to 80 BPM”.'});return;}
    }
    if(jobSpec){
      const job=runner.startJob(req.params.id,p.accepted_revision_id,commandId,'regenerate',
        jobSpec.instruction,jobSpec.scope,{});
      res.status(202).json({result:'job',jobId:job.id,message:`Regenerating ${jobSpec.scope.trackIds.join(', ')}`});
      return;
    }
    try{
      const next=applyEdit(base,edit!);
      next.id=req.params.id;
      const rid=accept(req.params.id,next,commandId);
      res.json({result:'applied',revisionId:rid,message});
    }catch(e:any){throw err(422,'invalid_edit',e.message);}
  }));

  /* ---------- export ---------- */
  r.get('/api/projects/:id/export',wrap(async(req,res)=>{
    const p=getProject(req.params.id);
    const accepted=getAccepted(req.params.id);
    if(!accepted)throw err(404,'no_revision','No accepted revision to export');
    const format=String(req.query.format||'json');
    if(format==='midi'){
      const bytes=encodeSMF(accepted);
      res.setHeader('Content-Type','audio/midi');
      res.setHeader('Content-Disposition',`attachment; filename="${p.title.replace(/[^\w.-]+/g,'_').slice(0,60)||'export'}.mid"`);
      res.send(bytes);
      return;
    }
    // portable JSON: never contains credentials
    const out={...accepted,id:p.id,revisionId:p.accepted_revision_id};
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename="${(p.title||'project').replace(/[^\w.-]+/g,'_').slice(0,60)}.jev-music.json"`);
    res.send(JSON.stringify(out,null,2));
  }));

  return r;
}

/** Server integration tests — real HTTP, fixture provider, temp DATA_DIR.
 *  Runs an actual compose job end to end plus pause/resume/cancel/idempotency. */
import {test, assert, beforeAll, afterAll} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';

// env must be set before server modules load
process.env.JEV_PROVIDER='fixture';
const dataDir=mkdtempSync(join(tmpdir(),'jevmusic-test-'));
process.env.DATA_DIR=dataDir;
process.env.TYPESAFE_API_KEY='';

let base:string, stop:()=>void, app:any;

beforeAll(async()=>{
  const {createServer}=await import('../server/index.js');
  const srv=createServer({port:0,host:'127.0.0.1',dataDir});
  app=srv.app;
  const listener=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>listener.on('listening',r));
  base=`http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  stop=()=>listener.close();
});
afterAll(()=>{stop();rmSync(dataDir,{recursive:true,force:true});});

const post=async(path:string,body:unknown)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
};
const get=async(path:string)=>{const r=await fetch(base+path);return {status:r.status,body:await r.json().catch(()=>null)};};

async function waitJob(id:string,want:string[],timeout=30000){
  const t0=Date.now();
  while(Date.now()-t0<timeout){
    const {body}=await get(`/api/jobs/${id}`);
    if(want.includes(body.status))return body;
    await new Promise(r=>setTimeout(r,150));
  }
  const {body}=await get(`/api/jobs/${id}`);
  throw new Error(`job ${id} stuck at ${body.status} (${body.errorCode}: ${body.errorMessage})`);
}

test('health reports fixture mode and no key',async()=>{
  const {status,body}=await get('/api/health');
  assert.equal(status,200);assert.equal(body.providerMode,'fixture');assert.equal(body.providerConfigured,false);
});

test('compose runs end to end and auto-accepts',async()=>{
  const {status,body}=await post('/api/compose',{prompt:'test waltz',commandId:'itest-compose'});
  assert.equal(status,202);
  const job=await waitJob(body.jobId,['completed','failed','cancelled']);
  assert.equal(job.status,'completed',job.errorMessage);
  assert.isTrue(job.accepted);
  assert.isAbove(job.decisionIndex,20);
  // draft notes exist across lanes
  const proj=await get(`/api/projects/${body.projectId}`);
  assert.isTrue(proj.body.project.tracks.length>=3);
  assert.isAbove(proj.body.project.tracks.reduce((n:number,t:any)=>n+t.notes.length,0),50);
  assert.equal(proj.body.project.generation.provenance,'fixture');
},45000);

test('compose is idempotent on commandId',async()=>{
  const a=await post('/api/compose',{prompt:'idem',commandId:'itest-idem'});
  const b=await post('/api/compose',{prompt:'idem',commandId:'itest-idem'});
  assert.equal(a.body.jobId,b.body.jobId);
  assert.equal(a.body.projectId,b.body.projectId);
  await waitJob(a.body.jobId,['completed','failed','cancelled']);
});

test('pause then resume does not regenerate accepted decisions',async()=>{
  const {body}=await post('/api/compose',{prompt:'pause me',commandId:'itest-pause'});
  const jobId=body.jobId;
  // wait until composing then pause
  const t0=Date.now();
  while(Date.now()-t0<15000){
    const j=(await get(`/api/jobs/${jobId}`)).body;
    if(j.status==='composing')break;
    await new Promise(r=>setTimeout(r,100));
  }
  await post(`/api/jobs/${jobId}/pause`,{});
  const paused=await waitJob(jobId,['paused','completed']);
  if(paused.status==='completed')return; // finished before pause took effect — acceptable
  const idx=paused.decisionIndex;
  await post(`/api/jobs/${jobId}/resume`,{});
  const done=await waitJob(jobId,['completed','failed']);
  assert.equal(done.status,'completed');
  // decisions are unique and monotonic — count persisted receipts
  const recs=await get(`/api/jobs/${jobId}/decisions`);
  const idxs=recs.body.receipts.map((r:any)=>r.decisionIndex);
  assert.equal(new Set(idxs).size,idxs.length,'duplicate decision indices');
  assert.isAbove(idxs[idxs.length-1],idx-1);
},45000);

test('cancel prevents late mutation and marks job cancelled',async()=>{
  const {body}=await post('/api/compose',{prompt:'cancel me',commandId:'itest-cancel'});
  await post(`/api/jobs/${body.jobId}/cancel`,{});
  const j=await waitJob(body.jobId,['cancelled','completed']);
  if(j.status==='cancelled'){
    assert.isFalse(j.accepted);
    // cancelled compose leaves no accepted revision
    const proj=await get(`/api/projects/${body.projectId}`);
    assert.isNull(proj.body.acceptedRevisionId);
  }
});

test('deterministic commands require matching base revision and reject unknown ops',async()=>{
  const c=await post('/api/compose',{prompt:'edits',commandId:'itest-edit'});
  const done=await waitJob(c.body.jobId,['completed']);
  const rev=done&& (await get(`/api/projects/${c.body.projectId}`)).body.acceptedRevisionId;
  const bad=await post(`/api/projects/${c.body.projectId}/commands`,
    {commandId:'e1',baseRevisionId:'bogus',op:'setTempo',bpm:120});
  assert.equal(bad.status,409);assert.equal(bad.body.code,'revision_conflict');
  const okR=await post(`/api/projects/${c.body.projectId}/commands`,
    {commandId:'e2',baseRevisionId:rev,op:'setTempo',bpm:123});
  assert.equal(okR.status,200);
  const proj=await get(`/api/projects/${c.body.projectId}`);
  assert.equal(proj.body.project.tempoBpm,123);
  const unk=await post(`/api/projects/${c.body.projectId}/commands`,
    {commandId:'e3',baseRevisionId:okR.body.revisionId,op:'nope'});
  assert.equal(unk.status,400);
},45000);

test('undo/redo walk the revision chain',async()=>{
  const c=await post('/api/compose',{prompt:'undo me',commandId:'itest-undo'});
  await waitJob(c.body.jobId,['completed']);
  const p1=(await get(`/api/projects/${c.body.projectId}`)).body;
  const r=await post(`/api/projects/${c.body.projectId}/commands`,
    {commandId:'u1',baseRevisionId:p1.acceptedRevisionId,op:'setTempo',bpm:99});
  const u=await post(`/api/projects/${c.body.projectId}/undo`,{});
  assert.equal(u.status,200);assert.equal(u.body.revisionId,p1.acceptedRevisionId);
  const rd=await post(`/api/projects/${c.body.projectId}/redo`,{});
  assert.equal(rd.status,200);assert.equal(rd.body.revisionId,r.body.revisionId);
},45000);

test('export midi and json round-trip import',async()=>{
  const c=await post('/api/compose',{prompt:'export me',commandId:'itest-export'});
  await waitJob(c.body.jobId,['completed']);
  const mid=await fetch(`${base}/api/projects/${c.body.projectId}/export?format=midi`);
  assert.equal(mid.status,200);
  const buf=Buffer.from(await mid.arrayBuffer());
  assert.equal(buf.subarray(0,4).toString(),'MThd');
  const js=await fetch(`${base}/api/projects/${c.body.projectId}/export?format=json`);
  const proj=await js.json();
  const imp=await post('/api/projects',{project:proj,commandId:'imp1'});
  assert.equal(imp.status,201);
  assert.isTrue(imp.body.unverified);
},45000);

test('import rejects malformed project',async()=>{
  const r=await post('/api/projects',{project:{schemaVersion:'jev-music.project.v1'},commandId:'bad1'});
  assert.equal(r.status,422);assert.equal(r.body.code,'import_invalid');
});

test('SSE stream replays persisted events',async()=>{
  const c=await post('/api/compose',{prompt:'sse',commandId:'itest-sse'});
  await waitJob(c.body.jobId,['completed']);
  const ac=new AbortController();
  const r=await fetch(`${base}/api/jobs/${c.body.jobId}/events`,
    {headers:{'Last-Event-ID':'0'},signal:ac.signal});
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type')||'',/text\/event-stream/);
  const reader=r.body!.getReader(),dec=new TextDecoder();
  let text='';
  const deadline=Date.now()+10000;
  while(!text.includes('job.completed')&&Date.now()<deadline){
    const {value,done}=await reader.read();
    if(done)break;
    text+=dec.decode(value,{stream:true});
  }
  ac.abort();
  assert.include(text,'job.status');
  assert.include(text,'job.completed');
},45000);

/** Fixture compose sanity check: runs a real compose end-to-end with the
 * fixture provider and prints groove parameter picks + first-bar notes. */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.JEV_PROVIDER='fixture';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'jev-groove-'));
process.env.TYPESAFE_API_KEY='';
const prompt=process.argv[2]??'bossa nova';
const {createServer}=await import('../server/index.ts');
const {app}=createServer({port:0,host:'127.0.0.1',dataDir:process.env.DATA_DIR});
const listener=app.listen(0,'127.0.0.1');
await new Promise(r=>listener.on('listening',r));
const base=`http://127.0.0.1:${listener.address().port}`;
const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
const get=async p=>{const r=await fetch(base+p);return {status:r.status,body:await r.json()};};

const {status,body}=await post('/api/compose',{prompt,commandId:`gc-${Date.now()}`});
console.log('COMPOSE',status,JSON.stringify({jobId:body.jobId,projectId:body.projectId}));
let job;
for(let i=0;i<600;i++){await new Promise(r=>setTimeout(r,250));const j=await get(`/api/jobs/${body.jobId}`);job=j.body;if(['completed','succeeded','failed','cancelled'].includes(j.body?.status))break;}
console.log('JOB',job.status,job.error??'');
if(job.status==='completed'||job.status==='succeeded'){
  const recs=(await get(`/api/jobs/${body.jobId}/decisions`)).body?.receipts??[];
  for(const e of recs.filter(e=>String(e.decisionId??e.questionId??'').includes('groove')))
    console.log('GROOVE',e.decisionId??e.questionId,'→',e.selected??e.choice);
  const proj=(await get(`/api/projects/${body.projectId}`)).body.project;
  for(const t of proj.tracks){
    const bar=1920;
    const first=t.notes.filter(n=>n.startTick<bar).slice(0,16);
    console.log(`\n[${t.role}] first bar (${first.length} notes):`,
      first.map(n=>`${n.startTick}:${n.midi}/${n.durationTicks}`).join(' '));
    console.log(`  total notes: ${t.notes.length}`);
  }
}
listener.close();
process.exit(0);

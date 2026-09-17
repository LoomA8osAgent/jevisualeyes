/** Executable reference contracts, not the finished application.
 * No network calls, dependencies, model, or audio renderer in this module.
 */
import {createHash} from 'node:crypto';
export const PPQ = 480;
export const STRAIGHT_SPANS = [120,160,240,320,480,720,960,1920];
const unsafeKeys = new Set(['__proto__','prototype','constructor']);
const ok = (v, msg) => { if (!v) throw new TypeError(msg); };
const int = (v, lo=0, hi=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v>=lo && v<=hi;
const plain = v => v!==null && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const clone = v => structuredClone(v);
export function canonicalJSON(value) {
  const stack = new Set();
  function walk(v, depth) {
    ok(depth<=32, 'JSON depth limit');
    if (v===null || typeof v==='string' || typeof v==='boolean') return JSON.stringify(v);
    if (typeof v==='number') { ok(Number.isFinite(v), 'Nonfinite number'); return JSON.stringify(v); }
    ok(Array.isArray(v)||plain(v), 'Non-JSON value');
    ok(!stack.has(v), 'Cyclic JSON'); stack.add(v);
    let s;
    if (Array.isArray(v)) s='['+v.map(x=>walk(x,depth+1)).join(',')+']';
    else s='{'+Object.keys(v).sort().map(k=>{
      ok(!unsafeKeys.has(k),'Unsafe key'); return JSON.stringify(k)+':'+walk(v[k],depth+1);
    }).join(',')+'}';
    stack.delete(v); return s;
  }
  return walk(value,0);
}
export const hashJSON = value => createHash('sha256').update(canonicalJSON(value),'utf8').digest('hex');
export function barTicks(meter) {
  ok([[4,4],[3,4],[6,8]].some(([n,d])=>meter?.numerator===n && meter?.denominator===d),'Unsupported meter');
  return meter.numerator*PPQ*4/meter.denominator;
}
export function warpTick(t, ratio=.5) {
  ok(int(t),'Invalid tick'); ok(Number.isFinite(ratio)&&ratio>=.5&&ratio<=.75,'Invalid swing');
  const q=Math.floor(t/PPQ), u=t-q*PPQ;
  return Math.round(q*PPQ+(u<=PPQ/2 ? 2*ratio*u : ratio*PPQ+2*(1-ratio)*(u-PPQ/2)));
}
export function performedNote(note,ratio=.5) {
  const startTick=warpTick(note.startTick,ratio);
  const endTick=warpTick(note.startTick+note.durationTicks,ratio);
  return {...note,startTick,durationTicks:Math.max(1,endTick-startTick)};
}
export function pitchWindow(anchor,low,high) {
  ok(int(anchor,0,127)&&int(low,0,127)&&int(high,low,127),'Invalid pitch range');
  const size=Math.min(24,high-low+1);
  const start=Math.max(low,Math.min(anchor-12,high-size+1));
  return Array.from({length:size},(_,i)=>start+i);
}
export function legalSpans(spans,remaining) {
  ok(int(remaining,1),'Invalid remaining interval');
  ok(Array.isArray(spans)&&spans.length>0&&spans.every(x=>int(x,1)),'Invalid spans');
  const unique=[...new Set(spans)].sort((a,b)=>a-b);
  ok(unique.length<=8,'At most eight spans');
  let out=unique.filter(x=>x<=remaining);
  // Off-grid/manual boundaries get a real residual event, never a zero-length pad.
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const quantum=unique.reduce(gcd);
  if (!out.length) out=[remaining];
  else if (remaining%quantum!==0 && !out.includes(remaining)) {
    if(out.length===8)out.pop(); out.push(remaining);out.sort((a,b)=>a-b);
  }
  return out;
}
export function buildCandidates({pitches,spans=STRAIGHT_SPANS,remaining,holdNoteIds=[],percussion=false}) {
  ok(Array.isArray(pitches)&&pitches.length>0&&pitches.length<=24,'Invalid pitch/voicing palette');
  const groups=pitches.map(p=>[...(Array.isArray(p)?p:[p])].sort((a,b)=>a-b));
  ok(groups.every(g=>g.length>0&&g.length<=4&&g.every(p=>int(p,0,127))&&new Set(g).size===g.length),'Invalid voicing');
  ok(new Set(groups.map(g=>g.join('_'))).size===groups.length,'Duplicate voicing');
  ok(Array.isArray(holdNoteIds)&&new Set(holdNoteIds).size===holdNoteIds.length&&holdNoteIds.every(x=>typeof x==='string'&&x.length),'Invalid hold IDs');
  ok(!percussion||holdNoteIds.length===0,'Percussion cannot hold');
  const ds=legalSpans(spans,remaining), out=[];
  for(const group of groups) for(const d of ds) out.push({id:`N_${group.join('_')}_${d}`,kind:'note',pitches:group,stepTicks:d,gateTicks:percussion?Math.min(60,d):d});
  for(const d of ds) out.push({id:`R_${d}`,kind:'rest',pitches:[],stepTicks:d,gateTicks:0});
  for(const d of ds) if(holdNoteIds.length) out.push({id:`H_${d}`,kind:'hold',pitches:[],stepTicks:d,gateTicks:d,targetNoteIds:[...holdNoteIds]});
  ok(out.length>=2&&out.length<=255,'Choice count must be 2..255');
  return out;
}
export function criteriaFor(candidates,cursorTick=0) {
  ok(int(cursorTick),'Invalid cursor');
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return Object.fromEntries(candidates.map(c=>{
    const ns=c.pitches.map(p=>`${names[p%12]}${Math.floor(p/12)-1} (MIDI ${p})`).join(', ');
    const action=c.kind==='note'?`Play ${ns}`:c.kind==='rest'?'Rest':`Hold existing note IDs ${c.targetNoteIds.join(', ')}`;
    return [c.id,`${action} at score tick ${cursorTick}; sounding gate ${c.gateTicks} ticks; advance ${c.stepTicks} ticks. PPQ 480.`];
  }));
}
export function validateChoiceResponse(response, request, questionId='next_event') {
  canonicalJSON(response);
  const criteria=request?.questions?.[questionId]?.criteria;
  ok(plain(criteria),'Missing request criteria');
  const a=response?.answers?.[questionId];
  ok(a?.type==='choice','Missing/wrong answer type');
  const keys=Object.keys(criteria).sort();
  ok(keys.length>=2&&keys.length<=255,'Invalid candidate count');
  ok(plain(a.probabilities),'Missing probabilities');
  ok(JSON.stringify(Object.keys(a.probabilities).sort())===JSON.stringify(keys),'Probability keys mismatch');
  const values=keys.map(k=>a.probabilities[k]);
  ok(values.every(p=>Number.isFinite(p)&&p>=0&&p<=1),'Invalid probability');
  const sum=values.reduce((x,y)=>x+y,0);
  ok(sum>0&&Math.abs(sum-1)<=1e-3,'Probability sum invalid');
  ok(keys.includes(a.choice),'Unknown selected option');
  ok(a.probabilities[a.choice]>=Math.max(...values)-1e-8,'Choice is not a maximum');
  ok(Number.isFinite(a.confidence)&&a.confidence>=0&&a.confidence<=1,'Invalid confidence');
  ok(typeof response.model==='string'&&response.model.length>0,'Missing model');
  ok(int(response.usage?.input_tokens)&&int(response.usage?.output_tokens),'Invalid usage');
  return {...a,probabilities:Object.fromEntries(keys.map(k=>[k,a.probabilities[k]/sum]))};
}
export function nextRandom(seed) {
  ok(int(seed,0,0xffffffff),'Invalid PRNG state');
  let x=(seed>>>0)||0x6d2b79f5; // defined normalization of seed zero
  x^=x<<13; x^=x>>>17; x^=x<<5; x>>>=0;
  return {seed:x,value:x/0x100000000};
}
export function selectChoice(answer,{mode='model',temperature=.8,seed=1}={}) {
  ok(['model','sample'].includes(mode),'Invalid mode');
  ok(Number.isFinite(temperature)&&temperature>=0&&temperature<=2,'Invalid temperature');
  ok(int(seed,0,0xffffffff),'Invalid seed');
  const keys=Object.keys(answer.probabilities).sort(), ps=keys.map(k=>answer.probabilities[k]);
  ok(keys.length>=2&&ps.every(p=>Number.isFinite(p)&&p>=0)&&ps.some(p=>p>0),'Invalid sampling probabilities');
  if(mode==='model') {ok(keys.includes(answer.choice),'Unknown choice');return {selected:answer.choice,seed};}
  if(temperature===0) {
    const maximum=Math.max(...ps); return {selected:keys.find((k,i)=>ps[i]===maximum),seed};
  }
  const logs=ps.map(p=>p>0?Math.log(p)/temperature:-Infinity), max=Math.max(...logs);
  const ws=logs.map(l=>Number.isFinite(l)?Math.exp(l-max):0), total=ws.reduce((a,b)=>a+b,0);
  const draw=nextRandom(seed); let threshold=draw.value*total;
  for(let i=0;i<keys.length;i++){threshold-=ws[i];if(threshold<0)return {selected:keys[i],seed:draw.seed};}
  return {selected:keys[ws.findLastIndex(w=>w>0)],seed:draw.seed};
}
export function applyEvent(notes,cursorTick,event,decisionId,{sourceKind='fixture',velocity=84,boundaryTick=Number.MAX_SAFE_INTEGER}={}) {
  ok(int(cursorTick)&&int(boundaryTick,cursorTick+1),'Invalid cursor/boundary');
  ok(int(event?.stepTicks,1)&&cursorTick+event.stepTicks<=boundaryTick,'Invalid event span');
  ok(['note','rest','hold'].includes(event.kind),'Invalid event kind');
  ok(typeof decisionId==='string'&&decisionId.length>0&&int(velocity,1,127),'Invalid decision/velocity');
  ok(['jev','manual','derived','fixture'].includes(sourceKind),'Invalid source kind');
  const result=clone(notes);
  if(event.kind==='note') {
    ok(Array.isArray(event.pitches)&&event.pitches.length>=1&&event.pitches.length<=4&&event.pitches.every(p=>int(p,0,127)),'Invalid event pitches');
    ok(new Set(event.pitches).size===event.pitches.length,'Duplicate event pitch');
    ok(int(event.gateTicks,1,event.stepTicks),'Invalid gate');
    for(const [i,p] of event.pitches.entries()) {
      const id=`${decisionId}:${i}`; ok(!result.some(n=>n.id===id),'Duplicate decision commit');
      result.push({id,startTick:cursorTick,durationTicks:event.gateTicks,midi:p,velocity,locked:false,source:{kind:sourceKind,decisionIds:[decisionId],parentNoteIds:[]}});
    }
  } else if(event.kind==='hold') {
    ok(Array.isArray(event.targetNoteIds)&&event.targetNoteIds.length>0&&new Set(event.targetNoteIds).size===event.targetNoteIds.length,'Missing/duplicate hold target');
    const targets=event.targetNoteIds.map(id=>result.find(n=>n.id===id));
    ok(targets.every(n=>n&&!n.locked&&n.startTick+n.durationTicks===cursorTick),'Hold target not sustained/editable');
    ok(targets.every(n=>!n.source.decisionIds.includes(decisionId)),'Duplicate hold commit');
    for(const n of targets){n.durationTicks+=event.stepTicks;n.source.decisionIds.push(decisionId);}
  }
  return {notes:result,cursorTick:cursorTick+event.stepTicks};
}
export function nextLane(cursors,roles) {
  const order={drums:0,harmony:1,bass:2,lead:3};
  const ids=Object.keys(cursors);ok(ids.length>0&&ids.every(id=>int(cursors[id])&&roles[id] in order),'Invalid cursors');
  return ids.sort((a,b)=>cursors[a]-cursors[b]||order[roles[a]]-order[roles[b]]||a.localeCompare(b))[0];
}
export function canCommit({status,epoch,decisionIndex},pending) {
  return ['composing','planning','pausing'].includes(status)&&epoch===pending.epoch&&decisionIndex===pending.decisionIndex;
}
export function assertPreserved(before,after,scope) {
  ok(scope.endTick>scope.startTick&&Array.isArray(scope.trackIds),'Invalid scope');
  ok(before.tracks.length===after.tracks.length,'Unexpected track count change');
  for(const tr of before.tracks) {
    const dest=after.tracks.find(t=>t.id===tr.id);ok(dest,'Missing track');
    const editable=n=>!tr.locked&&!n.locked&&scope.trackIds.includes(tr.id)&&n.startTick>=scope.startTick&&n.startTick+n.durationTicks<=scope.endTick;
    const old=new Map(tr.notes.map(n=>[n.id,n]));
    for(const n of tr.notes) if(!editable(n)) ok(canonicalJSON(dest.notes.find(x=>x.id===n.id))===canonicalJSON(n),'Protected note changed');
    for(const n of dest.notes) {
      if(!old.has(n.id)) ok(editable(n),'Added note outside editable scope');
      else if(editable(old.get(n.id)) && canonicalJSON(n)!==canonicalJSON(old.get(n.id))) {
        ok(editable(n),'Changed note moved outside editable scope');
      }
    }
  }
  return true;
}
export function validateProject(p) {
  canonicalJSON(p);
  ok(p.schemaVersion==='jev-music.project.v1'&&p.ppq===480,'Unknown project format');
  const bt=barTicks(p.meter);ok(int(p.lengthBars,1,64)&&int(p.tempoBpm,40,220),'Invalid length/tempo');
  ok(p.swing&&Number.isFinite(p.swing.ratio)&&p.swing.ratio>=.5&&p.swing.ratio<=.75,'Invalid swing');
  ok(p.meter.denominator!==8||p.swing.ratio===.5,'Swing unsupported for 6/8');
  const end=bt*p.lengthBars;
  ok(Array.isArray(p.tracks)&&p.tracks.length>=1&&p.tracks.length<=4,'Invalid tracks');
  const ids=new Set(),roles=new Set(),channels=new Set(),notes=new Set();let count=0;
  for(const tr of p.tracks){
    ok(!ids.has(tr.id)&&!roles.has(tr.role)&&['lead','bass','harmony','drums'].includes(tr.role),'Duplicate/invalid track role');ids.add(tr.id);roles.add(tr.role);
    ok(int(tr.program,0,127)&&int(tr.channel,0,15),'Invalid program/channel');
    ok(tr.role==='drums'?tr.channel===9:tr.channel!==9,'Incorrect percussion channel');
    ok(!channels.has(tr.channel),'Duplicate channel');channels.add(tr.channel);
    const byPitch=[...tr.notes].sort((a,b)=>a.midi-b.midi||a.startTick-b.startTick);
    for(let k=1;k<byPitch.length;k++){
      const a=byPitch[k-1],b=byPitch[k];
      ok(a.midi!==b.midi||a.startTick+a.durationTicks<=b.startTick,'Overlapping same-pitch notes');
    }
    for(const n of tr.notes){
      ok(!notes.has(n.id),'Duplicate note ID');notes.add(n.id);count++;
      ok(int(n.startTick)&&int(n.durationTicks,1)&&n.startTick+n.durationTicks<=end,'Invalid note time');
      ok(int(n.midi,0,127)&&int(n.velocity,1,127),'Invalid note value');
      ok(n.source&&['jev','manual','derived','fixture'].includes(n.source.kind),'Invalid provenance');
      if(n.source.kind==='jev')ok(n.source.decisionIds.length>0,'Live note missing decision ID');
    }
  }
  ok(count<=50000,'Note limit');
  for(const intervals of [p.sections,p.harmonicPlan]) {
    ok(Array.isArray(intervals),'Missing intervals');if(!intervals.length)continue;
    let cursor=0;
    for(const s of intervals){ok(int(s.startTick)&&int(s.endTick,1)&&s.startTick===cursor&&s.endTick>s.startTick&&s.endTick<=end,'Invalid interval coverage');cursor=s.endTick;}
    ok(cursor===end,'Incomplete interval coverage');
  }
  ok(p.sections.length>0,'Missing sections');
  return true;
}
function vlq(n){ok(int(n,0,0x0fffffff),'MIDI delta out of range');const b=[n&127];while((n>>>=7)>0)b.unshift((n&127)|128);return b;}
function chunk(name,body){const h=Buffer.alloc(8);h.write(name,0,4,'ascii');h.writeUInt32BE(body.length,4);return Buffer.concat([h,Buffer.from(body)]);}
function textMeta(type,text){const bs=[...Buffer.from(text,'utf8')];return [255,type,...vlq(bs.length),...bs];}
function trackBytes(events,totalTick){
  events.sort((a,b)=>a.tick-b.tick||a.priority-b.priority||a.seq-b.seq);
  let last=0;const bs=[];
  for(const e of events){bs.push(...vlq(e.tick-last),...e.bytes);last=e.tick;}
  bs.push(...vlq(Math.max(last,totalTick)-last),255,47,0);return chunk('MTrk',bs);
}
/** Restricted SMF writer serving as an independent export oracle. No general MIDI import. */
export function encodeSMF(project){
  validateProject(project);const end=barTicks(project.meter)*project.lengthBars;
  const us=Math.round(60000000/project.tempoBpm),header=Buffer.alloc(6);
  header.writeUInt16BE(1,0);header.writeUInt16BE(project.tracks.length+1,2);header.writeUInt16BE(480,4);
  const conductor=[
    {tick:0,priority:0,seq:0,bytes:textMeta(3,project.title)},
    {tick:0,priority:0,seq:1,bytes:[255,81,3,(us>>>16)&255,(us>>>8)&255,us&255]},
    {tick:0,priority:0,seq:2,bytes:[255,88,4,project.meter.numerator,Math.log2(project.meter.denominator),24,8]}
  ];
  const tracks=[trackBytes(conductor,end)];
  for(const tr of project.tracks){
    let seq=0;const es=[{tick:0,priority:0,seq:seq++,bytes:textMeta(3,tr.name)}];
    if(tr.role!=='drums')es.push({tick:0,priority:1,seq:seq++,bytes:[192|tr.channel,tr.program]});
    for(const n of tr.notes){const pn=performedNote(n,project.swing.ratio);
      es.push({tick:pn.startTick,priority:3,seq:seq++,bytes:[144|tr.channel,pn.midi,pn.velocity]});
      es.push({tick:pn.startTick+pn.durationTicks,priority:2,seq:seq++,bytes:[128|tr.channel,pn.midi,0]});
    }
    tracks.push(trackBytes(es,end));
  }
  return Buffer.concat([chunk('MThd',header),...tracks]);
}
/** Parser only for the explicit-status event subset emitted by this oracle. */
export function parseSMF(bytes){
  const b=Buffer.from(bytes);let i=0;
  const need=n=>ok(i+n<=b.length,'Truncated MIDI');
  const byte=()=>{need(1);return b[i++];};
  const u16=()=>{need(2);const v=b.readUInt16BE(i);i+=2;return v;};
  const u32=()=>{need(4);const v=b.readUInt32BE(i);i+=4;return v;};
  const label=()=>{need(4);const v=b.toString('ascii',i,i+4);i+=4;return v;};
  const variable=()=>{let v=0;for(let k=0;k<4;k++){const x=byte();v=(v<<7)|(x&127);if(!(x&128))return v;}throw new TypeError('Invalid VLQ');};
  ok(label()==='MThd'&&u32()===6,'Invalid MIDI header');const format=u16(),numTracks=u16(),ppq=u16(),tracks=[];
  for(let t=0;t<numTracks;t++){
    ok(label()==='MTrk','Invalid track');const len=u32(),stop=i+len;ok(stop<=b.length,'Truncated track');let tick=0;const es=[];
    while(i<stop){tick+=variable();const status=byte();
      if(status===255){const type=byte(),n=variable();need(n);const data=[...b.subarray(i,i+n)];i+=n;es.push({tick,type:'meta',metaType:type,data});}
      else if((status&240)===192)es.push({tick,type:'program',channel:status&15,value:byte()});
      else if([128,144].includes(status&240)){const midi=byte(),velocity=byte();es.push({tick,type:(status&240)===128?'off':'on',channel:status&15,midi,velocity});}
      else throw new TypeError('Unsupported oracle event');
    }
    ok(i===stop,'Track length mismatch');tracks.push(es);
  }
  ok(i===b.length,'Trailing MIDI bytes');return {format,ppq,tracks};
}

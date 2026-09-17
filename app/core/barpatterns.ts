/** Bar-level candidates: one option = a lane's complete bar (note/rest/hold segments).
 * Jev chooses musical units; code renders them deterministically. Per-event choices
 * remain the fallback for non-bar-aligned cursors.
 *
 * Bar renderings are sampled from the lane's groove parameter vector
 * (see grooves.ts) — the axes define a region of bar-space, the seed samples
 * distinct concrete bars from it. Styles are coordinates, not table entries. */
import {ok, isInt} from './canon.js';
import {chordTones, noteName, harmonyVoicings, DRUM_NAMES, LANE_RANGES} from './candidates.js';
import type {GrooveParams} from './grooves.js';
import type {HarmonySlot, LaneRole} from './types.js';

export interface BarEvent {kind:'note'|'rest'|'hold'; pitches:number[]; durationTicks:number;
  gateTicks:number; targetNoteIds?:string[]}
export interface BarCandidate {id:string; events:BarEvent[]; stepTicks:number}
export type AnyCandidate = BarCandidate|{id:string;kind:string;pitches:number[];stepTicks:number;gateTicks:number;targetNoteIds?:string[]};
export const isBarCandidate=(c:AnyCandidate):c is BarCandidate=>Array.isArray((c as BarCandidate).events);

const CELL=240;
type Seg=[cells:number, payload:number[]|'rest'];

const scaleFor=(vocab:string):number[]=>
  vocab==='minor'||vocab==='chromatic_ambiguous'?[0,2,3,5,7,8,10]
  :vocab==='blues_dominant'?[0,2,3,4,5,7,9,10]:[0,2,4,5,7,9,11];
/** deterministic tiny PRNG for melodic rendering */
const lcg=(seed:number)=>{let x=(seed>>>0)||0x9e3779b9;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/0x100000000;};};
const placePc=(pc:number,low:number,high:number):number=>{
  let p=pc%12;while(p<low)p+=12;while(p>high)p-=12;return p;
};
const nearestInSet=(raw:number,pcs:number[],low:number,high:number):number=>{
  let best=low,bd=1e9;
  for(const p of low<high?Array.from({length:high-low+1},(_,i)=>low+i):[]){if(!pcs.includes(p%12))continue;const d=Math.abs(p-raw);
    if(d<bd){bd=d;best=p;}}
  return best;
};
const range=(a:number,b:number,step:number):number[]=>{const o:number[]=[];for(let i=a;i<b;i+=step)o.push(i);return o;};
const sampleN=<T>(rnd:()=>number,pool:T[],n:number):T[]=>{
  const p=[...pool],o:T[]=[];
  for(let i=0;i<n&&p.length;i++)o.push(p.splice(Math.floor(rnd()*p.length),1)[0]);
  return o;
};

function segsToEvents(segs:Seg[],cellsTotal:number,span:number):BarEvent[]{
  const out:BarEvent[]=[];
  const unit=cellsTotal>0?span/cellsTotal:0;
  for(const [c,payload] of segs){
    const dur=Math.round(c*unit);
    if(dur<=0)continue;
    if(payload==='rest')out.push({kind:'rest',pitches:[],durationTicks:dur,gateTicks:0});
    else out.push({kind:'note',pitches:payload,durationTicks:dur,gateTicks:dur});
  }
  const diff=span-out.reduce((a,e)=>a+e.durationTicks,0);
  if(out.length&&diff!==0)out[out.length-1].durationTicks+=diff; // last segment absorbs rounding
  return out;
}

/* ---- lead melodic rendering ----
 * Rhythm templates in 240-tick cells (6 cells = 3/4 or 6/8 bar, 8 = 4/4 bar).
 * 'R2' = a two-cell rest. */
type R=(number|'R2')[];
const LEAD_RHYTHM_TABLE:Record<number,R[]>={
  6:[[4,2],[2,2,2],[6],[2,1,1,2],[3,3],[1,1,1,1,1,1],[2,4],[4,1,1],[2,2,'R2'],['R2',4],[1,1,1,1,2],[6]],
  8:[[4,4],[2,2,2,2],[8],[2,1,1,4],[4,2,2],[2,4,2],[1,1,1,1,1,1,1,1],[2,2,4],[4,4],[2,2,2,'R2'],['R2',2,4],[1,1,1,1,4],[6,2],[4,2,1,1]],
};
const CONTOURS=['arch','asc','desc'] as const;
function renderLeadBar(rhythm:R,contour:string,ctx:{anchor:number;chordPcs:number[];scalePcs:number[];
    low:number;high:number;span:number;cells:number;seed:number}):BarEvent[]{
  const {anchor,chordPcs,scalePcs,low,high,span,cells}=ctx;
  const rnd=lcg(ctx.seed);
  const notes=rhythm.filter(s=>s!=='R2').length;
  const dir=contour==='asc'?1:contour==='desc'?-1:(rnd()<0.5?1:-1);
  const startOff=contour==='asc'?-5:contour==='desc'?5:0;
  let pitch=nearestInSet(anchor+startOff,scalePcs.length?scalePcs:chordPcs,low,high);
  const out:BarEvent[]=[];let i=0,off=0;
  const unit=span/cells;
  for(const seg of rhythm){
    const dur=Math.round((seg==='R2'?2:seg as number)*unit);
    if(seg==='R2'){out.push({kind:'rest',pitches:[],durationTicks:dur,gateTicks:0});off+=dur;continue;}
    const strong=off%480===0;
    const pcs=strong&&chordPcs.length?chordPcs:(scalePcs.length?scalePcs:chordPcs);
    const d=contour==='arch'?(i<Math.ceil(notes/2)?dir:-dir):dir;
    const step=2+Math.floor(rnd()*4); // 2-5 semitones
    pitch=nearestInSet(pitch+d*step,pcs.length?pcs:scalePcs,low,high);
    out.push({kind:'note',pitches:[pitch],durationTicks:dur,gateTicks:dur});
    off+=dur;i++;
  }
  const diff=span-out.reduce((a,e)=>a+e.durationTicks,0);
  if(out.length&&diff!==0)out[out.length-1].durationTicks+=diff;
  return out;
}

/* ============ parameterized bar renderers ============
 * Each produces `count` distinct bar renderings sampled from the parameter
 * point; `any`/missing axes leave that layer unconstrained (chosen per seed). */

const noteCount=(r:R)=>r.filter(s=>s!=='R2').length;
function leadRhythmsFor(table:number,params:GrooveParams):R[]{
  const all=LEAD_RHYTHM_TABLE[table];
  let pool=all;
  const den=params.density;
  if(den&&den!=='any'){
    const f=pool.filter(r=>{
      const n=noteCount(r);
      return den==='sparse'?n<=3:den==='busy'?n>=5:n>=3&&n<=5;
    });
    if(f.length>=2)pool=f;
  }
  const syn=params.syncopation;
  if(syn&&syn!=='any'&&syn!=='mixed'){
    const f=pool.filter(r=>{
      const off=syn==='syncopated';
      return off?(r.includes('R2')||r.some(s=>s===1)):!r.includes('R2');
    });
    if(f.length>=2)pool=f;
  }
  return pool;
}

/** drums: layers at half-cell (120-tick) resolution, merged into a mask. */
function drumCandidates(params:GrooveParams,cells:number,span:number,seed:number,count:number):BarCandidate[]{
  const sc=cells*2; // subcells
  const beatSc=range(0,sc,4);
  const layer=(val:string|undefined,choices:Record<string,(rnd:()=>number)=>number[]>,rnd:()=>number):number[]=>{
    const keys=Object.keys(choices);
    const k=val&&val!=='any'&&choices[val]?val:keys[Math.floor(rnd()*keys.length)];
    return choices[k](rnd);
  };
  const out:BarCandidate[]=[];
  for(let ci=0;ci<count;ci++){
    const rnd=lcg(seed+ci*131);
    const kick=layer(params.kick,{
      beats:()=>[...beatSc],
      driving:r=>[...beatSc,...(r()<0.5?[2]:[])],
      sparse:r=>[0,...sampleN(r,[8,12].filter(x=>x<sc),r()<0.4?1:0)],
      syncopated:r=>[0,...sampleN(r,[3,6,7,10,11,14].filter(x=>x<sc),2)],
      off:()=>[]},rnd);
    const snare=layer(params.snare,{
      backbeat:()=>[4,12].filter(x=>x<sc),
      third:()=>[8].filter(x=>x<sc),
      syncopated:r=>sampleN(r,[3,6,10,11,14].filter(x=>x<sc),2),
      off:()=>[]},rnd);
    const hats=layer(params.hats,{
      eighths:()=>range(0,sc,2),
      quarters:()=>[...beatSc],
      sixteenths:()=>range(0,sc,1),
      sparse:r=>sampleN(r,range(0,sc,2),3),
      off:()=>[]},rnd);
    const acc=layer(params.accent,{
      none:()=>[],
      clave:r=>{const m=[[0,6,12],[4,10,14],[0,6,10,12]];return m[Math.floor(r()*m.length)].filter(x=>x<sc);},
      open_hat:r=>sampleN(r,[3,7,11,15].filter(x=>x<sc),1+(r()<0.4?1:0)),
      crash:()=>[0]},rnd);
    // humanize: seeded dropout/extra so each candidate is a distinct mask
    const humanize=(arr:number[],r:()=>number,pool:number[]):number[]=>{
      const a=[...arr];
      if(a.length>1&&r()<0.18)a.splice(Math.floor(r()*a.length),1);
      if(r()<0.12){const ex=sampleN(r,pool.filter(x=>!a.includes(x)),1);a.push(...ex);}
      return a;
    };
    const map=new Map<number,number[]>();
    const put=(pos:number,midi:number)=>{const a=map.get(pos)??[];if(!a.includes(midi))a.push(midi);map.set(pos,a);};
    for(const x of humanize(hats,rnd,range(0,sc,2)))put(x,42);
    for(const x of humanize(kick,rnd,beatSc))put(x,36);
    for(const x of humanize(snare,rnd,[2,4,6,10,12,14].filter(v=>v<sc)))put(x,38);
    for(const x of acc)put(x,params.accent==='clave'?37:params.accent==='open_hat'?46:49);
    if(!map.size)put(0,42);
    const pos=[...map.keys()].sort((a,b)=>a-b);
    const segs:Seg[]=[];let prev=0;
    for(const [i,p] of pos.entries()){
      if(p>prev)segs.push([(p-prev)/2,'rest']);
      const next=pos[i+1]??sc;
      segs.push([Math.max(0.5,(next-p)/2),map.get(p)!]);
      prev=next;
    }
    if(prev<sc)segs.push([(sc-prev)/2,'rest']);
    const evs=segsToEvents(segs,cells,span);
    for(const e of evs)if(e.kind==='note')e.gateTicks=Math.min(60,e.durationTicks);
    out.push({id:`B_d${ci}`,events:evs,stepTicks:span});
  }
  return out;
}

/** bass: onset schedule × pitch logic. */
function bassCandidates(params:GrooveParams,cells:number,span:number,rootPc:number,
    chordPcs:number[],scalePcs:number[],low:number,high:number,seed:number,count:number):BarCandidate[]{
  const beatCells=range(0,cells,2);
  const thirdOff=chordPcs.length>1?((chordPcs[1]-rootPc+12)%12):4;
  const schedules:Record<string,(rnd:()=>number)=>number[]>={
    quarters:r=>r()<0.5?[...beatCells]:sampleN(r,beatCells,3),
    eighths:()=>range(0,cells,1),
    dotted:r=>{const seqs:number[][]=[[5,3],[6,2],[4,2,2],[3,3,2],[5,2,1]];
      const s=seqs[Math.floor(r()*seqs.length)];let acc=0;return s.map(d=>(acc+=d)-d);},
    sustained:r=>r()<0.5?[0]:[0,Math.floor(cells/2)],
    syncopated:r=>[0,...sampleN(r,[1,3,5,6,7].filter(x=>x<cells),2)],
    any:r=>sampleN(r,range(0,cells,1),2+Math.floor(r()*4)),
  };
  const sched=(rnd:()=>number)=>schedules[params.rhythm&&params.rhythm!=='any'&&schedules[params.rhythm]?params.rhythm:'any'](rnd);
  const pitchSeq=(onsets:number[],rnd:()=>number):number[]=>{
    const kind=params.pitches&&params.pitches!=='any'?params.pitches:
      ['root','root_fifth','chord_tones','walking'][Math.floor(rnd()*4)];
    const pc=(off:number)=>placePc(rootPc+off,low,Math.min(high,low+24));
    if(kind==='root')return onsets.map(()=>pc(0));
    if(kind==='root_fifth')return onsets.map((o,i)=>pc(i===0||o%4===0?0:7));
    if(kind==='walking'){
      let cur=pc(0);const scaleSteps=scalePcs.length?scalePcs:[0,2,4,5,7,9,11];
      return onsets.map((o,i)=>{
        if(i===0)return cur;
        const dir=rnd()<0.5?-1:1,st=1+Math.floor(rnd()*2);
        const pcs=scaleSteps.map(s=>(rootPc+s)%12);
        const cand=[dir*st,-dir*st].map(o2=>nearestInSet(cur+o2,pcs,low,Math.min(high,low+24)));
        cur=cand[Math.floor(rnd()*cand.length)];return cur;
      });
    }
    // chord_tones
    const offs=[0,thirdOff,7,12];
    const rot=Math.floor(rnd()*4);
    return onsets.map((o,i)=>pc(offs[(i+rot)%offs.length]));
  };
  const out:BarCandidate[]=[];
  for(let ci=0;ci<count;ci++){
    const rnd=lcg(seed+ci*131);
    const onsets=sched(rnd).filter(x=>x<cells).sort((a,b)=>a-b);
    if(!onsets.length)onsets.push(0);
    const ps=pitchSeq(onsets,rnd);
    const segs:Seg[]=[];let prev=0;
    for(const [i,o] of onsets.entries()){
      if(o>prev)segs.push([o-prev,'rest']);
      const next=onsets[i+1]??cells;
      segs.push([next-o,[ps[i]]]);prev=next;
    }
    if(prev<cells)segs.push([cells-prev,'rest']);
    out.push({id:`B_b${ci}`,events:segsToEvents(segs,cells,span),stepTicks:span});
  }
  return out;
}

/** harmony: attack pattern × voicing density. */
function harmonyCandidates(params:GrooveParams,cells:number,span:number,
    voicings:number[][],seed:number,count:number):BarCandidate[]{
  const beatCells=range(0,cells,2);
  const v=voicings[0]??[];
  const light=v.length>2?v.slice(0,Math.max(2,v.length-1)):v;
  const chord=params.density==='light'?light:v;
  const out:BarCandidate[]=[];
  for(let ci=0;ci<count;ci++){
    const rnd=lcg(seed+ci*131);
    const kind=params.attack&&params.attack!=='any'?params.attack:
      ['block','comp','arp','sustain','sparse'][Math.floor(rnd()*5)];
    const segs:Seg[]=[];
    if(kind==='sustain')segs.push([cells,chord]);
    else if(kind==='arp')for(let c=0;c<cells;c++)segs.push([1,chord]);
    else{
      const pool=kind==='block'?beatCells
        :kind==='comp'?[1,3,4,5,7].filter(x=>x<cells)
        :kind==='sparse'?beatCells:[...beatCells,1,3,5,7].filter(x=>x<cells);
      const n=kind==='sparse'?1:kind==='comp'?2:kind==='block'?2+Math.floor(rnd()*3):2+Math.floor(rnd()*2);
      const onsets=sampleN(rnd,pool,Math.max(1,Math.min(n,pool.length))).sort((a,b)=>a-b);
      let prev=0;
      for(const [i,o] of onsets.entries()){
        if(o>prev)segs.push([o-prev,'rest']);
        const next=onsets[i+1]??cells;
        segs.push([Math.min(next-o,kind==='comp'?1:next-o),chord]);
        prev=next;
      }
      if(prev<cells)segs.push([cells-prev,'rest']);
    }
    out.push({id:`B_h${ci}`,events:segsToEvents(segs,cells,span),stepTicks:span});
  }
  return out;
}

export function barCandidatesFor(args:{
  role:LaneRole; span:number; slot:HarmonySlot|null; vocab:string; tonic:number;
  lastPitch:number|null; prevVoicing:number[]|null; holdNoteIds:string[];
  motif:{midi:number;startTick:number;durationTicks:number}[]|null; seed:number;
  groove?:GrooveParams|string|null;
}):BarCandidate[]{
  const {role,span,slot,vocab,tonic}=args;
  ok(isInt(span,1),'Invalid bar span');
  const cells=Math.round(span/CELL);
  ok(cells>=2&&span%CELL===0,'Bar span must be a whole number of 240-tick cells');
  const table=cells<=6?6:8;
  const params:GrooveParams=(args.groove&&typeof args.groove==='object')?args.groove:{};
  const out:BarCandidate[]=[];
  const chordPcs=slot&&slot.rootPitchClass!==null?chordTones(slot.rootPitchClass,slot.quality):[];
  const scalePcs=scaleFor(vocab).map(i=>(tonic+i)%12);
  const push=(id:string,events:BarEvent[])=>{if(events.length)out.push({id,events,stepTicks:span});};

  if(role==='lead'){
    const range=LANE_RANGES.lead;
    const anchor=args.lastPitch??range.anchor;
    const rhythms=leadRhythmsFor(table,params);
    for(const [ri,r] of rhythms.entries())
      for(const c of CONTOURS)
        push(`B_r${ri}_${c}`,renderLeadBar(r,c,{anchor,chordPcs,scalePcs,low:range.low,high:range.high,
          span,cells,seed:args.seed+ri*97+c.length*13}));
    if(args.motif&&args.motif.length>=2){
      const evs:BarEvent[]=[];let off=0;
      for(const n of args.motif){
        if(n.startTick>off)evs.push({kind:'rest',pitches:[],durationTicks:n.startTick-off,gateTicks:0});
        if(off>=span)break;
        const dur=Math.min(n.durationTicks,span-Math.max(off,n.startTick));
        if(dur<=0)break;
        evs.push({kind:'note',pitches:[n.midi],durationTicks:dur,gateTicks:dur});
        off=Math.max(off,n.startTick)+dur;
      }
      const acc=evs.reduce((a,e)=>a+e.durationTicks,0);
      if(acc<span)evs.push({kind:'rest',pitches:[],durationTicks:span-acc,gateTicks:0});
      if(evs.reduce((a,e)=>a+e.durationTicks,0)===span)push('B_motif',evs);
    }
  } else if(role==='bass'){
    const range=LANE_RANGES.bass;
    const rootPc=slot&&slot.rootPitchClass!==null?slot.rootPitchClass:tonic;
    for(const c of bassCandidates(params,cells,span,rootPc,chordPcs,scalePcs,
        range.low,range.high,args.seed,12))push(c.id,c.events);
  } else if(role==='harmony'){
    const voicings=slot?harmonyVoicings(slot,LANE_RANGES.harmony,args.prevVoicing):[];
    if(voicings.length)
      for(const c of harmonyCandidates(params,cells,span,voicings,args.seed,8))push(c.id,c.events);
    else push('B_rest',segsToEvents([[cells,'rest']],cells,span));
  } else if(role==='drums'){
    for(const c of drumCandidates(params,cells,span,args.seed,14))push(c.id,c.events);
  }
  if(args.holdNoteIds.length)
    push('B_hold',[{kind:'hold',pitches:[],durationTicks:span,gateTicks:span,targetNoteIds:[...args.holdNoteIds]}]);
  ok(out.length>=2&&out.length<=255,'Bar candidate count must be 2..255');
  return out;
}

/** Readable bar descriptions for criteria values. */
export function barCriteriaFor(cands:BarCandidate[],cursorTick:number):Record<string,string>{
  const names=(ps:number[])=>ps.map(p=>DRUM_NAMES[p]??noteName(p)).join('+');
  return Object.fromEntries(cands.map(c=>{
    const parts=c.events.map(e=>e.kind==='rest'?`rest ${e.durationTicks}`
      :e.kind==='hold'?`hold ${e.durationTicks}`:`${names(e.pitches)} ${e.durationTicks}`);
    return [c.id,`${parts.join('; ')} — full bar from tick ${cursorTick}, ${c.stepTicks} ticks, PPQ 480.`];
  }));
}

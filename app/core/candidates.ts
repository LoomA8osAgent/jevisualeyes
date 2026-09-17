/** Concrete candidate enumeration: pitched windows, harmony voicings, drum masks. */
import {ok, isInt} from './canon.js';
import {STRAIGHT_SPANS} from './time.js';
import type {EventCandidate, HarmonySlot, LaneRole} from './types.js';

export const CANDIDATE_VERSION = 'candidates.v1';

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const noteName = (p:number):string => `${NOTE_NAMES[p%12]}${Math.floor(p/12)-1}`;

/** Lane pitch ranges (inclusive). */
export const LANE_RANGES:Record<LaneRole,{low:number;high:number;anchor:number}> = {
  lead:{low:60,high:84,anchor:72},
  bass:{low:28,high:55,anchor:40},
  harmony:{low:48,high:76,anchor:60},
  drums:{low:0,high:0,anchor:0}
};

/** P0 percussion masks over GM drum pitches. No open+closed hat simultaneously. */
export const DRUM_MASKS:number[][] = [
  [36],[38],[42],[46],[39],[49],
  [36,42],[38,42],[36,46],[38,46],[36,38],[36,38,42],[36,49],[38,49],[36,38,49]
];
export const DRUM_NAMES:Record<number,string> = {
  36:'kick',37:'rim click',38:'snare',39:'clap',42:'closed hat',46:'open hat',49:'crash'
};

/** Curated instrument bank. program = GM export mapping (0-based), not a realism claim. */
export interface InstrumentDef {
  id:string; name:string; program:number; polyphonic:boolean; roles:LaneRole[];
  description:string;
}
export const INSTRUMENTS:InstrumentDef[] = [
  {id:'electric_keys',name:'Electric keys',program:4,polyphonic:true,roles:['lead','harmony'],description:'mellow electric keys'},
  {id:'soft_keys',name:'Soft keys',program:0,polyphonic:true,roles:['lead','harmony'],description:'soft keyed tone, explicitly synthetic'},
  {id:'organ',name:'Organ',program:16,polyphonic:true,roles:['lead','harmony'],description:'sustained organ-like tone'},
  {id:'pluck',name:'Pluck',program:24,polyphonic:true,roles:['lead','harmony'],description:'short plucked tone'},
  {id:'round_bass',name:'Round bass',program:33,polyphonic:false,roles:['bass'],description:'rounded bass'},
  {id:'synth_bass',name:'Synth bass',program:38,polyphonic:false,roles:['bass'],description:'electronic bass'},
  {id:'soft_lead',name:'Soft lead',program:80,polyphonic:false,roles:['lead'],description:'rounded melody voice'},
  {id:'bright_lead',name:'Bright lead',program:81,polyphonic:false,roles:['lead'],description:'cutting electronic melody voice'},
  {id:'drum_kit',name:'Drum kit',program:0,polyphonic:true,roles:['drums'],description:'kick/snare/hats/clap/crash'}
];
export const instrumentById = (id:string):InstrumentDef|undefined => INSTRUMENTS.find(i=>i.id===id);

export function pitchWindow(anchor:number, low:number, high:number):number[] {
  ok(isInt(anchor,0,127)&&isInt(low,0,127)&&isInt(high,low,127),'Invalid pitch range');
  const size=Math.min(24,high-low+1);
  const start=Math.max(low,Math.min(anchor-12,high-size+1));
  return Array.from({length:size},(_,i)=>start+i);
}
export function legalSpans(spans:number[], remaining:number):number[] {
  ok(isInt(remaining,1),'Invalid remaining interval');
  ok(Array.isArray(spans)&&spans.length>0&&spans.every(x=>isInt(x,1)),'Invalid spans');
  const unique=[...new Set(spans)].sort((a,b)=>a-b);
  ok(unique.length<=8,'At most eight spans');
  let out=unique.filter(x=>x<=remaining);
  // Off-grid/manual boundaries get a real residual event, never a zero-length pad.
  const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
  const quantum=unique.reduce(gcd);
  if (!out.length) out=[remaining];
  else if (remaining%quantum!==0 && !out.includes(remaining)) {
    if(out.length===8)out.pop(); out.push(remaining);out.sort((a,b)=>a-b);
  }
  return out;
}
export function buildCandidates({pitches,spans=STRAIGHT_SPANS,remaining,holdNoteIds=[],percussion=false}:{
  pitches:(number|number[])[];spans?:number[];remaining:number;holdNoteIds?:string[];percussion?:boolean;
}):EventCandidate[] {
  ok(Array.isArray(pitches)&&pitches.length>0&&pitches.length<=24,'Invalid pitch/voicing palette');
  const groups=pitches.map(p=>[...(Array.isArray(p)?p:[p])].sort((a,b)=>a-b));
  ok(groups.every(g=>g.length>0&&g.length<=4&&g.every(p=>isInt(p,0,127))&&new Set(g).size===g.length),'Invalid voicing');
  ok(new Set(groups.map(g=>g.join('_'))).size===groups.length,'Duplicate voicing');
  ok(Array.isArray(holdNoteIds)&&new Set(holdNoteIds).size===holdNoteIds.length&&holdNoteIds.every(x=>typeof x==='string'&&x.length),'Invalid hold IDs');
  ok(!percussion||holdNoteIds.length===0,'Percussion cannot hold');
  const ds=legalSpans(spans,remaining), out:EventCandidate[]=[];
  for(const group of groups) for(const d of ds) out.push({id:`N_${group.join('_')}_${d}`,kind:'note',pitches:group,stepTicks:d,gateTicks:percussion?Math.min(60,d):d});
  for(const d of ds) out.push({id:`R_${d}`,kind:'rest',pitches:[],stepTicks:d,gateTicks:0});
  for(const d of ds) if(holdNoteIds.length) out.push({id:`H_${d}`,kind:'hold',pitches:[],stepTicks:d,gateTicks:d,targetNoteIds:[...holdNoteIds]});
  ok(out.length>=2&&out.length<=255,'Choice count must be 2..255');
  return out;
}
/** Readable string descriptions for every candidate (string-valued criteria). */
export function criteriaFor(candidates:EventCandidate[], cursorTick=0):Record<string,string> {
  ok(isInt(cursorTick),'Invalid cursor');
  return Object.fromEntries(candidates.map(c=>{
    const ns=c.pitches.map(p=>`${noteName(p)} (MIDI ${p})`).join(', ');
    const action=c.kind==='note'?`Play ${ns}`:c.kind==='rest'?'Rest':`Hold existing note IDs ${c.targetNoteIds!.join(', ')}`;
    return [c.id,`${action} at score tick ${cursorTick}; sounding gate ${c.gateTicks} ticks; advance ${c.stepTicks} ticks. PPQ 480.`];
  }));
}

const CHORD_INTERVALS:Record<string,number[]> = {
  major:[0,4,7], minor:[0,3,7], dominant7:[0,4,7,10], major7:[0,4,7,11],
  minor7:[0,3,7,10], diminished:[0,3,6], sus2:[0,2,7], sus4:[0,5,7]
};
export const CHORD_QUALITIES = Object.keys(CHORD_INTERVALS);
export const chordTones = (rootPc:number|null, quality:string):number[] =>
  rootPc===null||quality==='no_chord'?[]:CHORD_INTERVALS[quality].map(i=>(rootPc+i)%12);

/**
 * Enumerate concrete harmony voicings (<=4 MIDI pitches) of the current chord inside
 * the lane range: inversions and octave placements, deduplicated, capped at 24.
 * Sorted by proximity to the previous voicing center, then lexicographically.
 */
export function harmonyVoicings(slot:HarmonySlot, range:{low:number;high:number}, prevVoicing:number[]|null):number[][] {
  const tones=chordTones(slot.rootPitchClass,slot.quality);
  if(!tones.length) return [];
  const voicings=new Map<string,number[]>();
  // Generate root-position sets across octaves, then all inversions.
  for(let octave=-1;octave<=9;octave++){
    const base=tones.map(t=>t+octave*12+12);
    if(base.some(p=>p<range.low||p>range.high)) {
      // still try shifting whole set by octaves later; skip out-of-range base
    }
    for(let inv=0;inv<tones.length;inv++){
      const v=base.map((p,i)=>i<inv?p+12:p).sort((a,b)=>a-b);
      if(v.every(p=>p>=range.low&&p<=range.high)) voicings.set(v.join('_'),v);
    }
    // also try the base itself transposed +/- one octave is covered by octave loop
  }
  const all=[...voicings.values()];
  const center=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
  const prev=prevVoicing?center(prevVoicing):(range.low+range.high)/2;
  all.sort((a,b)=>Math.abs(center(a)-prev)-Math.abs(center(b)-prev)||a.join('_').localeCompare(b.join('_')));
  return all.slice(0,24);
}

/** Note tuples as sent in provider state: [id, laneId, startTick, gateTicks, midi, velocity]. */
export type NoteTuple = [string,string,number,number,number,number];
export function noteTuples(notes:{id:string;startTick:number;durationTicks:number;midi:number;velocity:number}[], laneId:string):NoteTuple[] {
  return notes.map(n=>[n.id,laneId,n.startTick,n.durationTicks,n.midi,n.velocity]);
}

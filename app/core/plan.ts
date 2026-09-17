/** Plan vocabulary, deterministic prompt parsing, section compilation. */
import {ok, isInt} from './canon.js';
import type {HarmonySlot, LaneRole, Meter, PlanState, Section} from './types.js';
import {barTicks} from './time.js';

export const METERS:Meter[]=[{numerator:4,denominator:4},{numerator:3,denominator:4},{numerator:6,denominator:8}];
export const TEMPO_RANGE=Array.from({length:181},(_,i)=>40+i);
export const TONICS=Array.from({length:12},(_,i)=>i);
export const HARMONIC_VOCAB=['major','minor','blues_dominant','modal','chromatic_ambiguous'];
export const FEELS=['straight','light_swing','shuffle'];
export const FORMS=['theme_contrast_return','AABA','blues_chorus','buildup_drop','sparse_evolving'];
export const DENSITIES=['sparse','medium','busy'];
export const ENERGY_ARCS=['steady','rising','rise_fall','restrained_return'];
export const LENGTH_OPTIONS=[4,8,12,16,24,32,48,64];
export const LANE_ROLES:LaneRole[]=['lead','bass','harmony','drums'];

/** 15 nonempty lane subsets, deterministic order. */
export const LANE_SUBSETS:string[]=(()=>{
  const out:string[]=[];
  for(let m=1;m<16;m++)out.push(LANE_ROLES.filter((_,i)=>m&(1<<i)).join('+'));
  return out;
})();

export interface ParsedExplicit {tempoBpm?:number;lengthBars?:number;warnings:string[]}
/** Deterministic recognition of unambiguous numeric forms only (spec §2.3). */
export function parseExplicit(prompt:string):ParsedExplicit {
  const warnings:string[]=[];
  let tempoBpm:number|undefined, lengthBars:number|undefined;
  const bpm=prompt.match(/\b(\d{2,3})\s*(?:bpm|BPM)\b/);
  if(bpm){const v=parseInt(bpm[1],10);
    if(v>=40&&v<=220)tempoBpm=v; else warnings.push(`Ignored out-of-range tempo ${v} BPM (supported 40–220).`);}
  const bars=prompt.match(/\b(\d{1,2})\s*(?:bar|bars|BAR|Bars)\b/);
  if(bars){const v=parseInt(bars[1],10);
    if(v>=4&&v<=64)lengthBars=v;
    else if(v===1||v===2){lengthBars=4;warnings.push(`Adjusted ${v}-bar request to minimum 4 bars.`);}
    else if(v>64){lengthBars=64;warnings.push(`Clamped ${v}-bar request to maximum 64 bars.`);}
    else warnings.push(`Ignored unsupported bar count ${v}.`);}
  return {tempoBpm,lengthBars,warnings};
}

export const SWING_RATIO:Record<string,number>={straight:.5,light_swing:.58,shuffle:2/3};

/** Compile structural sections (metadata only) from the chosen form. */
export function compileSections(form:string,lengthBars:number,meter:Meter):Section[] {
  const bt=barTicks(meter);const end=bt*lengthBars;
  const mk=(i:number,name:string,role:string,a:number,b:number):Section=>({id:`s${i}`,name,role,startTick:a*bt,endTick:b*bt});
  let parts:[string,string,number][]=[];
  if(form==='blues_chorus'){
    // 12-bar choruses; if not a multiple of 12, split evenly.
    const n=Math.max(1,Math.round(lengthBars/12)), per=lengthBars/n;
    parts=Array.from({length:n},(_,i)=>[`Chorus ${i+1}`,'theme',per] as [string,string,number]);
  } else if(form==='AABA'){
    const q=lengthBars/4;
    parts=[['A','theme',q],['A2','variation',q],['B','contrast',q],['A3','return',q]];
  } else if(form==='buildup_drop'){
    const q=Math.floor(lengthBars/4);
    parts=[['Intro','intro',q],['Buildup','build',q],['Drop','drop',q],['Outro','ending',lengthBars-3*q]];
  } else if(form==='sparse_evolving'){
    const q=Math.floor(lengthBars/4);
    parts=[['Part 1','theme',q],['Part 2','variation',q],['Part 3','variation',q],['Part 4','return',lengthBars-3*q]];
  } else { // theme_contrast_return default
    const q=Math.floor(lengthBars/4);
    parts=[['Intro','theme',q],['Theme','theme',q],['Contrast','contrast',q],['Return','return',lengthBars-3*q]];
  }
  let bar=0;const out:Section[]=[];
  for(let i=0;i<parts.length;i++){const [name,role,len]=parts[i];const l=Math.max(0,Math.round(len));
    if(l>0){out.push(mk(i+1,name,role,bar,bar+l));bar+=l;}}
  if(out.length&&out[out.length-1].endTick!==end)out[out.length-1].endTick=end;
  ok(out.length>0&&out[0].startTick===0&&out[out.length-1].endTick===end,'Bad section compile');
  return out;
}

/** Default harmony slots: one per bar. */
export function harmonySlots(lengthBars:number,meter:Meter):{startTick:number;endTick:number}[]{
  const bt=barTicks(meter);
  return Array.from({length:lengthBars},(_,i)=>({startTick:i*bt,endTick:(i+1)*bt}));
}

/* ---------- harmonic progressions ----------
 * Jev picks ONE progression template per section (real chord motion),
 * code expands it deterministically to per-bar slots. Replaces the old
 * per-slot 97-chord menu which self-anchored on the tonic. */

export type ChordQuality='major'|'minor'|'dominant7'|'major7'|'minor7'|'diminished'|'sus2'|'sus4';
type DegMap=Record<string,[number,ChordQuality]>;
const DEG_MINOR:DegMap={
  'i':[0,'minor'],'i7':[0,'minor7'],'iidim':[2,'diminished'],'III':[3,'major'],'iv':[5,'minor'],
  'iv7':[5,'minor7'],'v':[7,'minor'],'V':[7,'dominant7'],'VI':[8,'major'],'VII':[10,'major'],
  'bII':[1,'major'],'bIII':[3,'major'],'bVI':[8,'major'],'bVII':[10,'major']};
const DEG_MAJOR:DegMap={
  'I':[0,'major'],'ii':[2,'minor'],'iii':[4,'minor'],'IV':[5,'major'],'V':[7,'dominant7'],
  'vi':[9,'minor'],'vii':[11,'diminished'],'II':[2,'major'],'III':[4,'major'],
  'bIII':[3,'major'],'bVI':[8,'major'],'bVII':[10,'major']};
const DEG_BLUES:DegMap={
  'I7':[0,'dominant7'],'IV7':[5,'dominant7'],'V7':[7,'dominant7'],
  'i7':[0,'minor7'],'iv7':[5,'minor7'],'v7':[7,'minor7'],
  'i':[0,'minor'],'iv':[5,'minor'],'v':[7,'minor']};

export interface ProgressionDef {id:string;degrees:string[]|null}
const mkProg=(degrees:string[]|null):ProgressionDef=>
  ({id:degrees===null?'P_none':`P_${degrees.join('_')}`,degrees});
const PROG_MINOR:ProgressionDef[]=[
  mkProg(['i','VI','III','VII']), mkProg(['i','iv','V','i']),   mkProg(['i','iv','i','V']),
  mkProg(['i','VII','VI','V']),  mkProg(['i','V','VI','iv']),  mkProg(['i','III','VII','VI']),
  mkProg(['i','iv','VII','III']),mkProg(['i','VI','iv','V']),  mkProg(['i','i','iv','iv']),
  mkProg(['i']),                 mkProg(null)];
const PROG_MAJOR:ProgressionDef[]=[
  mkProg(['I','V','vi','IV']),   mkProg(['I','IV','V','I']),   mkProg(['I','vi','IV','V']),
  mkProg(['I','V','IV','I']),    mkProg(['I','iii','IV','V']), mkProg(['I','IV','I','V']),
  mkProg(['I','vi','ii','V']),   mkProg(['I','ii','V','I']),   mkProg(['I','I','IV','IV']),
  mkProg(['I']),                 mkProg(null)];
const PROG_BLUES:ProgressionDef[]=[
  mkProg(['I7','IV7','I7','V7']),mkProg(['I7','IV7','I7','I7']),mkProg(['I7','V7','IV7','I7']),
  mkProg(['i7','iv7','i7','v7']),mkProg(['i7','iv7','V7','i7']),mkProg(['I7']),mkProg(null)];
const PROG_MODAL:ProgressionDef[]=[
  mkProg(['I','bVII','IV','I']), mkProg(['I','bVII','bVI','bVII']),mkProg(['i','bVII','bVI','bVII']),
  mkProg(['i','VII','i','VII']), mkProg(['I','IV','I','bVII']),    mkProg(['i','iv','i','i']),
  mkProg(['I']),                 mkProg(null)];
const PROG_CHROMATIC:ProgressionDef[]=[
  mkProg(['i','bII','i','V']),   mkProg(['i','iv','bVI','V']),  mkProg(['i','bVI','bVII','i']),
  mkProg(['i','iidim','i','V']), mkProg(['i','bII','bVII','i']),mkProg(['i','bIII','bII','i']),
  mkProg(['i']),                 mkProg(null)];
const VOCAB_TABLE:Record<string,{map:DegMap;progs:ProgressionDef[]}>={
  minor:{map:DEG_MINOR,progs:PROG_MINOR}, major:{map:DEG_MAJOR,progs:PROG_MAJOR},
  blues_dominant:{map:DEG_BLUES,progs:PROG_BLUES}, modal:{map:DEG_MAJOR,progs:PROG_MODAL},
  chromatic_ambiguous:{map:DEG_MINOR,progs:PROG_CHROMATIC}};
export const progressionsFor=(vocab:string):ProgressionDef[]=>
  (VOCAB_TABLE[vocab]??VOCAB_TABLE.major).progs;
const QUALITY_LABEL:Record<string,string>={dominant7:'7',minor7:'m7',major7:'maj7',diminished:'dim'};
export const spellDegree=(vocab:string,deg:string,tonic:number,noteNames:string[]):string=>{
  const [off,q]=(VOCAB_TABLE[vocab]??VOCAB_TABLE.major).map[deg];
  return `${noteNames[(tonic+off)%12]}${QUALITY_LABEL[q]??(q==='major'?'':q==='minor'?'m':' '+q)}`;
};
export function expandProgression(vocab:string,progId:string,tonic:number,
    span:{startTick:number;endTick:number},nSlots:number,bt:number):HarmonySlot[]{
  const def=progressionsFor(vocab).find(d=>d.id===progId);
  ok(def,`Unknown progression ${progId}`);
  const map=(VOCAB_TABLE[vocab]??VOCAB_TABLE.major).map;
  const out:HarmonySlot[]=[];
  for(let i=0;i<nSlots;i++){
    const startTick=span.startTick+i*bt,endTick=Math.min(startTick+bt,span.endTick);
    if(def.degrees===null){out.push({startTick,endTick,rootPitchClass:null,quality:'no_chord'});continue;}
    const [off,q]=map[def.degrees[i%def.degrees.length]];
    out.push({startTick,endTick,rootPitchClass:(tonic+off)%12,quality:q});
  }
  return out;
}
export function emptyPlan():PlanState {
  return {meter:{numerator:4,denominator:4},tempoBpm:100,tonicPitchClass:9,harmonicVocabulary:'major',
    feel:'straight',form:'theme_contrast_return',density:'medium',energyArc:'steady',lengthBars:16,
    lanes:['lead','bass','harmony','drums'],instruments:{},warnings:[],explicit:{}};
}

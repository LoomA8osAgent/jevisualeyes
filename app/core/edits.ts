/** Deterministic edit operations on the canonical score. No model involvement. */
import {ok, isInt, clone} from './canon.js';
import {barTicks} from './time.js';
import type {Note, ProjectFile, ResolvedEdit, Scope, Track} from './types.js';
import {instrumentById, LANE_RANGES} from './candidates.js';
import {isEditable} from './score.js';
import {validateProject} from './score.js';

const derive=(n:Note,parentIds:string[]):Note=>({...n,source:{kind:'derived',decisionIds:[],parentNoteIds:parentIds}});

function checkPitchOverlaps(track:Track):void{
  const byPitch=[...track.notes].sort((a,b)=>a.midi-b.midi||a.startTick-b.startTick);
  for(let k=1;k<byPitch.length;k++){
    const a=byPitch[k-1],b=byPitch[k];
    ok(a.midi!==b.midi||a.startTick+a.durationTicks<=b.startTick,
      `Overlapping same-pitch notes on ${track.id} at MIDI ${b.midi}`);
  }
}

/** Apply a validated ResolvedEdit; returns a NEW project (does not mutate). */
export function applyEdit(project:ProjectFile, edit:ResolvedEdit):ProjectFile {
  const p=clone(project);
  const bt=barTicks(p.meter), end=p.lengthBars*bt;
  const track=(id:string):Track=>{const t=p.tracks.find(t=>t.id===id);ok(t,'Unknown track');return t;};
  switch(edit.type){
    case 'setTempo':
      ok(isInt(edit.bpm,40,220),'Tempo out of range');p.tempoBpm=edit.bpm;break;
    case 'setInstrument':{
      const t=track(edit.trackId),inst=instrumentById(edit.instrumentId);
      ok(inst,'Unknown instrument');ok(inst.roles.includes(t.role),'Instrument not valid for lane role');
      t.instrumentId=inst.id;t.program=inst.program;break;
    }
    case 'setTrackGain':{
      const t=track(edit.trackId);ok(Number.isFinite(edit.volumeDb)&&edit.volumeDb>=-60&&edit.volumeDb<=6,'Gain out of range');
      t.volumeDb=edit.volumeDb;break;
    }
    case 'setMute':{track(edit.trackId).muted=!!edit.muted;break;}
    case 'transpose':{
      ok(isInt(edit.semitones,-48,48)&&edit.semitones!==0,'Invalid transpose');
      for(const id of edit.scope.trackIds){
        const t=track(id);ok(t.role!=='drums','Cannot transpose drums');
        const targets=t.notes.filter(n=>isEditable(t,n,edit.scope));
        const range=LANE_RANGES[t.role];
        for(const n of targets){
          const m=n.midi+edit.semitones;
          ok(isInt(m,0,127)&&m>=range.low&&m<=range.high,
            `Transpose would push ${n.id} (${n.midi}→${m}) outside lane range ${range.low}–${range.high}`);
        }
        for(const n of targets){const m=n.midi+edit.semitones;Object.assign(n,derive({...n,midi:m},[n.id]));}
        checkPitchOverlaps(t);
      }
      break;
    }
    case 'setLocks':{
      for(const id of edit.trackIds)track(id).locked=edit.locked;
      const set=new Set(edit.noteIds);
      if(set.size)for(const t of p.tracks)for(const n of t.notes)if(set.has(n.id))n.locked=edit.locked;
      break;
    }
    case 'duplicateRegion':{
      ok(isInt(edit.destinationStartTick,0,end-1),'Invalid destination');
      const delta=edit.destinationStartTick-edit.scope.startTick;
      ok(delta!==0,'Destination equals source');
      for(const id of edit.scope.trackIds){
        const t=track(id);
        const src=t.notes.filter(n=>isEditable(t,n,edit.scope));
        ok(src.length>0,'Nothing to duplicate in scope');
        const copies=src.map(n=>{
          ok(n.startTick+delta>=0&&n.startTick+delta+n.durationTicks<=end,'Duplicate would leave the composition');
          return {...derive({...n,startTick:n.startTick+delta},[n.id]),id:`dup-${n.id}-${edit.destinationStartTick}`};
        });
        t.notes.push(...copies);checkPitchOverlaps(t);
      }
      break;
    }
    case 'regenerate':throw new TypeError('regenerate is a job, not a deterministic edit');
    default:throw new TypeError('Unsupported edit');
  }
  p.updatedAt=new Date().toISOString();
  validateProject(p);
  return p;
}

/** Manual piano-roll ops — all deterministic commands, one undo step each. */
export function manualAddNote(p:ProjectFile,trackId:string,n:{startTick:number;durationTicks:number;midi:number;velocity:number},id:string):ProjectFile{
  const proj=clone(p);const t=proj.tracks.find(t=>t.id===trackId);ok(t,'Unknown track');
  const bt=barTicks(proj.meter);
  ok(isInt(n.startTick,0)&&isInt(n.durationTicks,1)&&n.startTick+n.durationTicks<=proj.lengthBars*bt,'Note outside composition');
  ok(isInt(n.midi,0,127)&&isInt(n.velocity,1,127),'Invalid note');
  t.notes.push({id,startTick:n.startTick,durationTicks:n.durationTicks,midi:n.midi,velocity:n.velocity,locked:false,source:{kind:'manual',decisionIds:[],parentNoteIds:[]}});
  checkPitchOverlaps(t);validateProject(proj);return proj;
}
export function manualMoveNotes(p:ProjectFile,noteIds:string[],dTicks:number,dMidi:number):ProjectFile{
  const proj=clone(p);const set=new Set(noteIds);const bt=barTicks(proj.meter);const end=proj.lengthBars*bt;
  for(const t of proj.tracks){
    const targets=t.notes.filter(n=>set.has(n.id));
    for(const n of targets){
      ok(!n.locked&&!t.locked,'Note is locked');
      const st=n.startTick+dTicks,m=t.role==='drums'?n.midi:n.midi+dMidi;
      ok(isInt(st,0)&&st+n.durationTicks<=end,'Move outside composition');
      ok(isInt(m,0,127),'Move outside MIDI range');
      Object.assign(n,derive({...n,startTick:st,midi:m},[n.id]));
    }
    if(targets.length)checkPitchOverlaps(t);
  }
  validateProject(proj);return proj;
}
export function manualResizeNotes(p:ProjectFile,noteIds:string[],durationTicks:number):ProjectFile{
  const proj=clone(p);const set=new Set(noteIds);const bt=barTicks(proj.meter);const end=proj.lengthBars*bt;
  ok(isInt(durationTicks,1),'Invalid duration');
  for(const t of proj.tracks)for(const n of t.notes)if(set.has(n.id)){
    ok(!n.locked&&!t.locked,'Note is locked');
    ok(n.startTick+durationTicks<=end,'Resize outside composition');
    Object.assign(n,derive({...n,durationTicks},[n.id]));
  }
  for(const t of proj.tracks)if(t.notes.some(n=>set.has(n.id)))checkPitchOverlaps(t);
  validateProject(proj);return proj;
}
export function manualDeleteNotes(p:ProjectFile,noteIds:string[]):ProjectFile{
  const proj=clone(p);const set=new Set(noteIds);
  for(const t of proj.tracks){
    for(const n of t.notes)if(set.has(n.id))ok(!n.locked&&!t.locked,'Note is locked');
    t.notes=t.notes.filter(n=>!set.has(n.id));
  }
  validateProject(proj);return proj;
}
export function manualSetVelocity(p:ProjectFile,noteIds:string[],velocity:number):ProjectFile{
  const proj=clone(p);const set=new Set(noteIds);ok(isInt(velocity,1,127),'Invalid velocity');
  for(const t of proj.tracks)for(const n of t.notes)if(set.has(n.id)){
    ok(!n.locked&&!t.locked,'Note is locked');
    Object.assign(n,derive({...n,velocity},[n.id]));
  }
  validateProject(proj);return proj;
}
export function quantizeNotes(p:ProjectFile,noteIds:string[],gridTicks:number):ProjectFile{
  const proj=clone(p);const set=new Set(noteIds);const bt=barTicks(proj.meter);const end=proj.lengthBars*bt;
  ok([120,160,240,480].includes(gridTicks),'Unsupported grid');
  for(const t of proj.tracks){
    const targets=t.notes.filter(n=>set.has(n.id));
    for(const n of targets){
      ok(!n.locked&&!t.locked,'Note is locked');
      const st=Math.round(n.startTick/gridTicks)*gridTicks;
      const dur=Math.max(gridTicks,Math.round(n.durationTicks/gridTicks)*gridTicks);
      ok(st+dur<=end,'Quantize outside composition');
      Object.assign(n,derive({...n,startTick:st,durationTicks:dur},[n.id]));
    }
    if(targets.length)checkPitchOverlaps(t);
  }
  validateProject(proj);return proj;
}
/** Remove editable notes in scope (regeneration draft preparation). */
export function removeEditableNotes(p:ProjectFile,scope:Scope):ProjectFile{
  const proj=clone(p);
  for(const t of proj.tracks)t.notes=t.notes.filter(n=>!isEditable(t,n,scope));
  return proj;
}

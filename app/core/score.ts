/** Score operations: event application, lane scheduling, lock/scope invariants. */
import {ok, isInt, clone, canonicalJSON} from './canon.js';
import {barTicks} from './time.js';
import type {EventCandidate, LaneRole, Note, ProjectFile, Scope, Track} from './types.js';

export function applyEvent(
  notes:Note[], cursorTick:number, event:EventCandidate, decisionId:string,
  {sourceKind='fixture',velocity=84,boundaryTick=Number.MAX_SAFE_INTEGER}:
  {sourceKind?:'jev'|'manual'|'derived'|'fixture';velocity?:number;boundaryTick?:number}={}
):{notes:Note[];cursorTick:number} {
  ok(isInt(cursorTick)&&isInt(boundaryTick,cursorTick+1),'Invalid cursor/boundary');
  ok(isInt(event?.stepTicks,1)&&cursorTick+event.stepTicks<=boundaryTick,'Invalid event span');
  ok(['note','rest','hold'].includes(event.kind),'Invalid event kind');
  ok(typeof decisionId==='string'&&decisionId.length>0&&isInt(velocity,1,127),'Invalid decision/velocity');
  ok(['jev','manual','derived','fixture'].includes(sourceKind),'Invalid source kind');
  const result=clone(notes);
  if(event.kind==='note') {
    ok(Array.isArray(event.pitches)&&event.pitches.length>=1&&event.pitches.length<=4&&event.pitches.every(p=>isInt(p,0,127)),'Invalid event pitches');
    ok(new Set(event.pitches).size===event.pitches.length,'Duplicate event pitch');
    ok(isInt(event.gateTicks,1,event.stepTicks),'Invalid gate');
    for(const [i,p] of event.pitches.entries()) {
      const id=`${decisionId}:${i}`; ok(!result.some(n=>n.id===id),'Duplicate decision commit');
      result.push({id,startTick:cursorTick,durationTicks:event.gateTicks,midi:p,velocity,locked:false,source:{kind:sourceKind,decisionIds:[decisionId],parentNoteIds:[]}});
    }
  } else if(event.kind==='hold') {
    ok(Array.isArray(event.targetNoteIds)&&event.targetNoteIds.length>0&&new Set(event.targetNoteIds).size===event.targetNoteIds.length,'Missing/duplicate hold target');
    const targets=event.targetNoteIds.map(id=>result.find(n=>n.id===id));
    ok(targets.every(n=>n&&!n.locked&&n.startTick+n.durationTicks===cursorTick),'Hold target not sustained/editable');
    ok(targets.every(n=>!n!.source.decisionIds.includes(decisionId)),'Duplicate hold commit');
    for(const n of targets){n!.durationTicks+=event.stepTicks;n!.source.decisionIds.push(decisionId);}
  }
  return {notes:result,cursorTick:cursorTick+event.stepTicks};
}
export function nextLane(cursors:Record<string,number>, roles:Record<string,LaneRole>):string {
  const order:Record<string,number>={drums:0,harmony:1,bass:2,lead:3};
  const ids=Object.keys(cursors);ok(ids.length>0&&ids.every(id=>isInt(cursors[id])&&roles[id] in order),'Invalid cursors');
  return ids.sort((a,b)=>cursors[a]-cursors[b]||order[roles[a]]-order[roles[b]]||a.localeCompare(b))[0];
}
export function canCommit(job:{status:string;epoch:number;decisionIndex:number},pending:{epoch:number;decisionIndex:number}):boolean {
  return ['composing','planning','pausing'].includes(job.status)&&job.epoch===pending.epoch&&job.decisionIndex===pending.decisionIndex;
}

/** A note is editable iff its lane is selected, lane unlocked, note unlocked, and the note
 * is wholly contained in the half-open scope interval. */
export const isEditable = (track:Track, n:Note, scope:Scope):boolean =>
  !track.locked && !n.locked && scope.trackIds.includes(track.id) &&
  n.startTick>=scope.startTick && n.startTick+n.durationTicks<=scope.endTick;
export const isProtected = (track:Track, n:Note, scope:Scope):boolean => !isEditable(track,n,scope);

/** If a protected note covers `cursor` on this lane, return its end (structural skip target). */
export function protectedCoveringEnd(track:Track, cursor:number, scope:Scope):number|null {
  for(const n of track.notes){
    if(isProtected(track,n,scope)&&n.startTick<=cursor&&cursor<n.startTick+n.durationTicks) return n.startTick+n.durationTicks;
  }
  return null;
}
/** Earliest protected-note start at or after cursor on this lane (a hard boundary). */
export function nextProtectedStart(track:Track, cursor:number, scope:Scope, limit:number):number {
  let b=limit;
  for(const n of track.notes){
    if(isProtected(track,n,scope)&&n.startTick>cursor&&n.startTick<b) b=n.startTick;
  }
  return b;
}
/** Hold candidates: notes sounding exactly through cursor that are editable (generation lanes mono). */
export function holdableNotes(track:Track, cursor:number, scope:Scope):Note[] {
  return track.notes.filter(n=>isEditable(track,n,scope)&&n.startTick+n.durationTicks===cursor&&n.startTick<cursor);
}

/** Verify protected content is byte-identical and no notes were added outside editable scope. */
export function assertPreserved(before:ProjectFile, after:ProjectFile, scope:Scope):true {
  ok(scope.endTick>scope.startTick&&Array.isArray(scope.trackIds),'Invalid scope');
  ok(before.tracks.length===after.tracks.length,'Unexpected track count change');
  for(const tr of before.tracks) {
    const dest=after.tracks.find(t=>t.id===tr.id);ok(dest,'Missing track');
    const editable=(n:Note)=>isEditable(tr,n,scope);
    const old=new Map(tr.notes.map(n=>[n.id,n]));
    for(const n of tr.notes) if(!editable(n)) ok(canonicalJSON(dest.notes.find(x=>x.id===n.id))===canonicalJSON(n),'Protected note changed');
    for(const n of dest!.notes) {
      if(!old.has(n.id)) ok(editable(n),'Added note outside editable scope');
      else if(editable(old.get(n.id)!) && canonicalJSON(n)!==canonicalJSON(old.get(n.id))) {
        ok(editable(n),'Changed note moved outside editable scope');
      }
    }
  }
  return true;
}

/** Semantic invariants beyond JSON Schema (spec §6.3). */
export function validateProject(p:ProjectFile):true {
  canonicalJSON(p);
  ok(p.schemaVersion==='jev-music.project.v1'&&p.ppq===480,'Unknown project format');
  const bt=barTicks(p.meter);ok(isInt(p.lengthBars,1,64)&&isInt(p.tempoBpm,40,220),'Invalid length/tempo');
  ok(p.swing&&Number.isFinite(p.swing.ratio)&&p.swing.ratio>=.5&&p.swing.ratio<=.75,'Invalid swing');
  ok(p.meter.denominator!==8||p.swing.ratio===.5,'Swing unsupported for 6/8');
  const end=bt*p.lengthBars;
  ok(Array.isArray(p.tracks)&&p.tracks.length>=1&&p.tracks.length<=4,'Invalid tracks');
  const ids=new Set<string>(),roles=new Set<string>(),channels=new Set<number>(),notes=new Set<string>();let count=0;
  for(const tr of p.tracks){
    ok(!ids.has(tr.id)&&!roles.has(tr.role)&&['lead','bass','harmony','drums'].includes(tr.role),'Duplicate/invalid track role');ids.add(tr.id);roles.add(tr.role);
    ok(isInt(tr.program,0,127)&&isInt(tr.channel,0,15),'Invalid program/channel');
    ok(tr.role==='drums'?tr.channel===9:tr.channel!==9,'Incorrect percussion channel');
    ok(!channels.has(tr.channel),'Duplicate channel');channels.add(tr.channel);
    const byPitch=[...tr.notes].sort((a,b)=>a.midi-b.midi||a.startTick-b.startTick);
    for(let k=1;k<byPitch.length;k++){
      const a=byPitch[k-1],b=byPitch[k];
      ok(a.midi!==b.midi||a.startTick+a.durationTicks<=b.startTick,'Overlapping same-pitch notes');
    }
    for(const n of tr.notes){
      ok(!notes.has(n.id),'Duplicate note ID');notes.add(n.id);count++;
      ok(isInt(n.startTick)&&isInt(n.durationTicks,1)&&n.startTick+n.durationTicks<=end,'Invalid note time');
      ok(isInt(n.midi,0,127)&&isInt(n.velocity,1,127),'Invalid note value');
      ok(n.source&&['jev','manual','derived','fixture'].includes(n.source.kind),'Invalid provenance');
      if(n.source.kind==='jev')ok(n.source.decisionIds.length>0,'Live note missing decision ID');
    }
  }
  ok(count<=50000,'Note limit');
  for(const intervals of [p.sections,p.harmonicPlan]) {
    ok(Array.isArray(intervals),'Missing intervals');if(!intervals.length)continue;
    let cursor=0;
    for(const s of intervals){ok(isInt(s.startTick)&&isInt(s.endTick,1)&&s.startTick===cursor&&s.endTick>s.startTick&&s.endTick<=end,'Invalid interval coverage');cursor=s.endTick;}
    ok(cursor===end,'Incomplete interval coverage');
  }
  ok(p.sections.length>0,'Missing sections');
  return true;
}

/** Frontier = minimum cursor across active lanes; complete bars only. */
export function frontierBars(cursors:Record<string,number>, bt:number, scopeStart:number):number {
  const vals=Object.values(cursors);
  if(!vals.length)return 0;
  return Math.floor((Math.min(...vals)-scopeStart)/bt);
}

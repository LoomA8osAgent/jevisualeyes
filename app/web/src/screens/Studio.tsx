import {useCallback,useEffect,useRef,useState} from 'react';
import {api,JobSnapshot,ProjectDetail} from '../api.js';
import type {Toast} from '../App.js';
import type {Engine} from '../audio.js';
import {barTicks} from '@core/time.js';
import {Arrangement} from '../components/Arrangement.js';
import {PianoRoll} from '../editor/PianoRoll.js';
import type {ProjectFile} from '@core/types.js';

/** Studio: transport + arrangement + piano roll + NL edits + export. */
export function StudioScreen({detail,onRefresh,say,engine,onJobStarted}:
  {detail:ProjectDetail;onRefresh:()=>Promise<void>;say:(t:string,k?:Toast['kind'])=>void;
   engine:Engine;onJobStarted:(j:JobSnapshot)=>void}){
  const p=detail.project!;
  const [playing,setPlaying]=useState(false);
  const [loop,setLoop]=useState(false);
  const [tick,setTick]=useState(0);
  const [sel,setSel]=useState<{trackIds:string[];startTick:number;endTick:number}|null>(null);
  const [editTrack,setEditTrack]=useState(p.tracks[0]?.id??'');
  const [nl,setNl]=useState('');
  const [busyEdit,setBusyEdit]=useState(false);
  const bt=barTicks(p.meter);

  engine.onTick=t=>setTick(t);

  useEffect(()=>{engine.load(p);engine.setLoop(loop,0,p.lengthBars*bt);
    return()=>{engine.stop();};
  },[detail.acceptedRevisionId,loop]);

  const cmd=useCallback(async(op:string,args:Record<string,unknown>={})=>{
    try{
      await api.command(detail.id,detail.acceptedRevisionId!,op,args);
      await onRefresh();
    }catch(e:any){say(e.message,'error');}
  },[detail.id,detail.acceptedRevisionId,onRefresh,say]);

  const nlEdit=async()=>{
    if(!nl.trim()||busyEdit)return;
    setBusyEdit(true);
    try{
      const r=await api.nlEdit(detail.id,detail.acceptedRevisionId!,nl,sel);
      setNl('');
      if(r.result==='job'){onJobStarted(await api.job(r.jobId));return;}
      if(r.result==='applied'){say(r.message||'Applied');await onRefresh();}
      else say(r.message||'Could not apply','warn');
    }catch(e:any){say(e.message,'error');}
    finally{setBusyEdit(false);}
  };

  const regenerate=async()=>{
    if(!sel){say('Select a region in the arrangement first','warn');return;}
    try{
      const r=await api.startJob(detail.id,'regenerate',nl||'regenerate this section',
        sel,{baseRevisionId:detail.acceptedRevisionId});
      onJobStarted(await api.job(r.jobId));
    }catch(e:any){say(e.message,'error');}
  };
  const variation=async()=>{
    try{
      const r=await api.startJob(detail.id,'variation',nl||'create a variation',null,
        {baseRevisionId:detail.acceptedRevisionId});
      onJobStarted(await api.job(r.jobId));
    }catch(e:any){say(e.message,'error');}
  };

  const togglePlay=async()=>{
    if(playing){engine.pause();setPlaying(false);return;}
    await engine.play(tick);setPlaying(true);
  };

  return <>
    <div className="transport">
      <button className="tbtn" onClick={togglePlay}>{playing?'❚❚':'▶'}</button>
      <button className="tbtn" onClick={()=>{engine.stop();setPlaying(false);setTick(0);}}>■</button>
      <label className="kv"><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> loop</label>
      <span className="kv">bar <b>{Math.floor(tick/bt)+1}</b> / {p.lengthBars}</span>
      <span className="kv">{p.tempoBpm} BPM · {p.meter.numerator}/{p.meter.denominator} · swing {p.swing.ratio.toFixed(2)}</span>
      <span className="kv">prompt: <i>{p.prompt.slice(0,80)}</i></span>
      <div className="spacer"/>
      <button onClick={async()=>{try{await api.undo(detail.id);await onRefresh();}catch(e:any){say(e.message,'warn');}}}>Undo</button>
      <button onClick={async()=>{try{await api.redo(detail.id);await onRefresh();}catch(e:any){say(e.message,'warn');}}}>Redo</button>
      <a href={api.exportUrl(detail.id,'midi')} download><button>Export MIDI</button></a>
      <a href={api.exportUrl(detail.id,'json')} download><button>Export JSON</button></a>
    </div>
    <Arrangement project={p} playheadTick={tick} selection={sel} onSelect={setSel}
      onCommand={cmd}/>
    <div className="row" style={{padding:'6px 16px'}}>
      <span className="kv">piano roll:</span>
      <select value={editTrack} onChange={e=>setEditTrack(e.target.value)}>
        {p.tracks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {sel&&<span className="kv">selected bars {Math.floor(sel.startTick/bt)+1}–{Math.ceil(sel.endTick/bt)} on {sel.trackIds.join(', ')}
        <button style={{marginLeft:8}} onClick={regenerate}>Regenerate selection</button>
        <button onClick={()=>setSel(null)}>Clear</button></span>}
      {!sel&&<button onClick={variation}>Variation (unlocked lanes)</button>}
    </div>
    <div className="canvaswrap">
      <PianoRoll project={p} trackId={editTrack} playheadTick={tick}
        onCommand={cmd} say={say}/>
    </div>
    <div className="editbox">
      <input placeholder='Edit in words — "make the bass busier in the second half", "set tempo to 80 BPM", "transpose lead up an octave"'
        value={nl} onChange={e=>setNl(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter')nlEdit();}}/>
      <button className="primary" disabled={busyEdit} onClick={nlEdit}>{busyEdit?'…':'Apply'}</button>
    </div>
  </>;
}

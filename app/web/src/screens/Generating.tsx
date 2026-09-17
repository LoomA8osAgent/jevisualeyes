import {useEffect,useRef,useState} from 'react';
import {api,JobSnapshot} from '../api.js';
import type {Toast} from '../App.js';
import type {Engine} from '../audio.js';
import {barTicks} from '@core/time.js';

/** Generation progress: SSE-driven status, per-lane cursors, honest progress
 *  (complete bars only), pause/resume/cancel, live preview playback. */
export function GeneratingScreen({job,projectId,onJob,onDone,say,engine}:
  {job:JobSnapshot;projectId:string;onJob:(j:JobSnapshot)=>void;onDone:(status?:string)=>void;
   say:(t:string,k?:Toast['kind'])=>void;engine:Engine}){
  const [snap,setSnap]=useState(job);
  const [previewing,setPreviewing]=useState(false);
  const esRef=useRef<EventSource|null>(null);

  useEffect(()=>{
    const es=new EventSource(`/api/jobs/${job.id}/events`);
    esRef.current=es;
    const refresh=async()=>{try{setSnap(await api.job(job.id));}catch{}};
    const on=(t:string,fn:(d:any)=>void)=>es.addEventListener(t,e=>fn(JSON.parse((e as MessageEvent).data)));
    on('job.status',d=>{refresh();
      if(d.status==='completed'){es.close();onDone('completed');}
      else if(d.status==='cancelled')es.close();}); // failed stays subscribed so Retry streams progress
    on('preview.ready',()=>refresh());
    on('decision.committed',()=>refresh());
    on('job.paused',()=>refresh());
    es.onerror=()=>{/* EventSource auto-reconnects with Last-Event-ID replay */};
    return ()=>es.close();
  },[job.id]);

  useEffect(()=>()=>engine.stop(),[engine]);

  const barsTotal=snap.plan?.lengthBars??(Math.round((snap.scope.endTick-snap.scope.startTick)/(snap.barTicks||1))||16);
  const done=['completed','failed','cancelled'].includes(snap.status);
  const preview=async()=>{
    if(previewing){engine.stop();setPreviewing(false);return;}
    const j=await api.job(job.id);setSnap(j);
    if(!j.preview){say('No complete bars yet','warn');return;}
    engine.load(j.preview);engine.setLoop(true);
    await engine.play(0);setPreviewing(true);
    engine.onTick=()=>{if(!engine.playing)setPreviewing(false);};
  };

  return <div className="center"><div className="card">
    <div className="row" style={{justifyContent:'space-between'}}>
      <h1>Composing</h1>
      <span className="badge">{snap.status}</span>
    </div>
    <div className="sub mono">{snap.phase} · decision {snap.decisionIndex} · {snap.usage.requests} requests · {snap.usage.inputTokens+snap.usage.outputTokens} tokens</div>
    {snap.plan&&<div className="kv" style={{marginBottom:10}}>
      {snap.plan.meter} · {snap.plan.tempoBpm} BPM · {snap.plan.lengthBars} bars · {snap.plan.form?.replaceAll('_',' ')} · {snap.plan.density} density
    </div>}
    <div className="bar" style={{marginBottom:14}}><i style={{width:`${Math.min(100,100*snap.completedBars/Math.max(1,barsTotal))}%`}}/></div>
    <div className="dim" style={{fontSize:12,marginBottom:12}}>{snap.completedBars} / {barsTotal} bars complete — previews only ever contain whole bars</div>
    {Object.entries(snap.laneCursors).map(([lane,cur])=>
      <div className="lanebar" key={lane}><span className="name">{lane}</span>
        <div className="bar"><i style={{width:`${Math.min(100,100*(cur-snap.scope.startTick)/Math.max(1,snap.scope.endTick-snap.scope.startTick))}%`}}/></div>
      </div>)}
    {snap.errorMessage&&<div className="badge err" style={{marginBottom:10}}>{snap.errorCode}: {snap.errorMessage}</div>}
    {snap.resumeAt&&<div className="dim" style={{fontSize:12,marginBottom:8}}>Retrying at {new Date(snap.resumeAt).toLocaleTimeString()}</div>}
    <div className="row">
      <button onClick={preview}>{previewing?'Stop preview':'Play preview'}</button>
      {snap.status==='paused'
        ?<button className="primary" onClick={async()=>{await api.resumeJob(job.id);setSnap(await api.job(job.id));}}>Resume</button>
        :<button onClick={async()=>{await api.pauseJob(job.id);setSnap(await api.job(job.id));}}
           disabled={done}>Pause</button>}
      <button className="danger" disabled={done} onClick={async()=>{await api.cancelJob(job.id);onDone('cancelled');}}>Stop</button>
      {snap.status==='interrupted'&&<button className="primary" onClick={async()=>{await api.resumeJob(job.id);}}>Resume interrupted job</button>}
      {snap.status==='failed'&&<button className="primary"
        onClick={async()=>{await api.resumeJob(job.id);setSnap(await api.job(job.id));}}>Retry from here</button>}
      {done&&<button onClick={()=>onDone(snap.status)}>
        {snap.status==='failed'?'Back':'Done'}</button>}
    </div>
  </div></div>;
}

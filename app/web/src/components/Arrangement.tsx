import {useRef,useState} from 'react';
import type {ProjectFile} from '@core/types.js';
import {barTicks} from '@core/time.js';

const COLORS:Record<string,string>={lead:'var(--lead)',bass:'var(--bass)',harmony:'var(--harmony)',drums:'var(--drums)'};
const PX_PER_BAR=64;

/** Track lanes overview with note blocks, bar grid, drag-select region for regen. */
export function Arrangement({project:p,playheadTick,selection,onSelect,onCommand}:
  {project:ProjectFile;playheadTick:number;
   selection:{trackIds:string[];startTick:number;endTick:number}|null;
   onSelect:(s:{trackIds:string[];startTick:number;endTick:number}|null)=>void;
   onCommand:(op:string,args?:Record<string,unknown>)=>void}){
  const bt=barTicks(p.meter);
  const [drag,setDrag]=useState<{x0:number;trackIdx:number;x1:number}|null>(null);
  const laneRefs=useRef<(HTMLDivElement|null)[]>([]);

  const tickAt=(el:HTMLDivElement,x:number)=>x/PX_PER_BAR*bt;
  const onDown=(tidx:number,e:React.MouseEvent)=>{
    const el=laneRefs.current[tidx]!;const r=el.getBoundingClientRect();
    setDrag({x0:e.clientX-r.left,trackIdx:tidx,x1:e.clientX-r.left});
  };
  const onMove=(tidx:number,e:React.MouseEvent)=>{
    if(!drag)return;
    const el=laneRefs.current[tidx]!;const r=el.getBoundingClientRect();
    setDrag({...drag,x1:Math.max(0,Math.min(el.clientWidth,e.clientX-r.left))});
  };
  const onUp=(tidx:number)=>{
    if(!drag)return;
    const el=laneRefs.current[tidx]!;
    const a=tickAt(el,Math.min(drag.x0,drag.x1)),b=tickAt(el,Math.max(drag.x0,drag.x1));
    const sameTrack=drag.trackIdx===tidx;
    const trackIds=sameTrack?[p.tracks[tidx].id]:p.tracks.slice(Math.min(drag.trackIdx,tidx),Math.max(drag.trackIdx,tidx)+1).map(t=>t.id);
    // snap to whole bars
    const s=Math.floor(a/bt)*bt,e2=Math.max(s+bt,Math.ceil(b/bt)*bt);
    onSelect({trackIds,startTick:Math.max(0,s),endTick:Math.min(p.lengthBars*bt,e2)});
    setDrag(null);
  };

  return <div className="arrange">
    {p.tracks.map((t,ti)=><div className="arrrow" key={t.id}>
      <div className="label">
        <label className="checks" style={{display:'flex'}}>
          <input type="checkbox" checked={!t.muted} onChange={()=>onCommand('setMute',{trackId:t.id,muted:!t.muted})}/>
          {t.name}{t.locked?' 🔒':''}
        </label>
        <div style={{fontSize:10,opacity:.7}}>{t.instrumentId}</div>
      </div>
      <div className="arrlane" ref={el=>{laneRefs.current[ti]=el;}}
        style={{width:p.lengthBars*PX_PER_BAR}}
        onMouseDown={e=>onDown(ti,e)} onMouseMove={e=>onMove(ti,e)} onMouseUp={()=>onUp(ti)}>
        {Array.from({length:p.lengthBars},(_,i)=>
          <div key={i} style={{position:'absolute',left:i*PX_PER_BAR,top:0,bottom:0,width:1,background:'var(--line)'}}/>)}
        {t.notes.map(n=><div key={n.id} className="arrnote" style={{
          left:n.startTick/bt*PX_PER_BAR,width:Math.max(2,n.durationTicks/bt*PX_PER_BAR),
          background:COLORS[t.role]??'var(--accent)',opacity:n.locked?.4:.85}}/>)}
        {selection&&selection.trackIds.includes(t.id)&&
          <div className="arrsel" style={{left:selection.startTick/bt*PX_PER_BAR,
            width:(selection.endTick-selection.startTick)/bt*PX_PER_BAR}}/>}
        <div style={{position:'absolute',left:playheadTick/bt*PX_PER_BAR,top:0,bottom:0,width:2,background:'#fff',opacity:.8,pointerEvents:'none'}}/>
      </div>
      <button title={t.locked?'Unlock lane':'Lock lane'}
        onClick={()=>onCommand('setTrackLock',{trackIds:[t.id],locked:!t.locked})}>
        {t.locked?'🔒':'🔓'}</button>
    </div>)}
  </div>;
}

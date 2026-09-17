import {useCallback,useEffect,useRef,useState} from 'react';
import type {Note, ProjectFile, Track} from '@core/types.js';
import {barTicks} from '@core/time.js';
import {LANE_RANGES} from '@core/candidates.js';
import type {Toast} from '../App.js';

const ROW_H=14,PX_PER_TICK=1/30,KEY_W=48,VEL_H=56;
const roleColor=(r:string)=>r==='lead'?'#7c5cff':r==='bass'?'#3ddc97':r==='harmony'?'#f2a65a':'#ef6461';
const BLACK=new Set([1,3,6,8,10]);

interface Drag{kind:'move'|'resize'|'none';noteId:string|null;startX:number;startY:number;
  origStart:number;origMidi:number;origDur:number;moved:boolean}

/** Canvas piano roll: click select, drag move, right-edge resize, dblclick add,
 *  Delete removes, velocity strip edits selection, all through /commands. */
export function PianoRoll({project:p,trackId,playheadTick,onCommand,say}:
  {project:ProjectFile;trackId:string;playheadTick:number;
   onCommand:(op:string,args?:Record<string,unknown>)=>Promise<void>|void;
   say:(t:string,k?:Toast['kind'])=>void}){
  const track=p.tracks.find(t=>t.id===trackId);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const [selId,setSelId]=useState<string|null>(null);
  const dragRef=useRef<Drag|null>(null);
  const [dragState,setDragState]=useState<Drag|null>(null); // for render
  const [,force]=useState(0);
  const bt=barTicks(p.meter);
  const drums=track?.role==='drums';
  // pitch window: lane range padded by actual note extents (drums: used pitches or kit range)
  const range=track?(drums
    ?{low:track.notes.length?Math.min(...track.notes.map(n=>n.midi))-4:35,
      high:track.notes.length?Math.max(...track.notes.map(n=>n.midi))+4:70}
    :{low:Math.min(LANE_RANGES[track.role].low,...track.notes.map(n=>n.midi))-4,
      high:Math.max(LANE_RANGES[track.role].high,...track.notes.map(n=>n.midi))+4})
    :{low:36,high:84};
  const lo=Math.max(0,range.low),hi=Math.min(127,range.high);
  const rows=hi-lo+1;
  const width=KEY_W+p.lengthBars*bt*PX_PER_TICK,height=rows*ROW_H+VEL_H;

  const tickToX=(t:number)=>KEY_W+t*PX_PER_TICK;
  const xToTick=(x:number)=>Math.round((x-KEY_W)/PX_PER_TICK/10)*10;
  const yToMidi=(y:number)=>hi-Math.floor(y/ROW_H);
  const midiToY=(m:number)=>(hi-m)*ROW_H;

  const noteAt=(x:number,y:number):Note|null=>{
    if(!track)return null;
    const t=xToTick(x),m=yToMidi(y);
    for(let i=track.notes.length-1;i>=0;i--){
      const n=track.notes[i];
      if(t>=n.startTick&&t<n.startTick+n.durationTicks&&n.midi===m)return n;
    }
    return null;
  };

  const draw=useCallback(()=>{
    const cv=canvasRef.current;if(!cv||!track)return;
    const ctx=cv.getContext('2d')!;
    ctx.clearRect(0,0,width,height);
    // pitch rows
    for(let m=lo;m<=hi;m++){
      ctx.fillStyle=BLACK.has(m%12)?'#14171c':'#181c22';
      ctx.fillRect(KEY_W,midiToY(m),width-KEY_W,ROW_H);
      if(m%12===0){ctx.fillStyle='#5a6270';ctx.font='9px monospace';
        ctx.fillText(`C${m/12-1}`,4,midiToY(m)+10);}
      if(drums){ctx.fillStyle='#8b93a1';ctx.font='8px monospace';ctx.fillText(String(m),22,midiToY(m)+10);}
    }
    // bar/beat grid
    const beat=p.meter.denominator===8?480*1.5:480;
    for(let t=0;t<=p.lengthBars*bt;t+=t%bt===0?bt:0){
      const x=tickToX(t);
      ctx.strokeStyle='#2a2f38';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,rows*ROW_H);ctx.stroke();
      ctx.fillStyle='#5a6270';ctx.font='10px monospace';
      ctx.fillText(String(t/bt+1),x+3,10);
    }
    for(let t=0;t<p.lengthBars*bt;t+=beat){const x=tickToX(t);ctx.strokeStyle='#20242b';
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,rows*ROW_H);ctx.stroke();}
    // velocity strip separator
    ctx.strokeStyle='#2a2f38';ctx.beginPath();ctx.moveTo(0,rows*ROW_H);ctx.lineTo(width,rows*ROW_H);ctx.stroke();
    // notes (performed positions shown subtly when swung)
    const color=roleColor(track.role);
    for(const n of track.notes){
      const d=dragState&&dragState.noteId===n.id?dragState:null;
      const dispStart=d?(d as any).curStart??n.startTick:n.startTick;
      const dispMidi=d?(d as any).curMidi??n.midi:n.midi;
      const dispDur=d?(d as any).curDur??n.durationTicks:n.durationTicks;
      ctx.fillStyle=n.locked?'#4a4f58':color;
      ctx.globalAlpha=selId===n.id?1:.8;
      ctx.fillRect(tickToX(dispStart),midiToY(dispMidi)+1,Math.max(3,dispDur*PX_PER_TICK),ROW_H-2);
      if(selId===n.id){ctx.strokeStyle='#fff';ctx.lineWidth=1;
        ctx.strokeRect(tickToX(dispStart),midiToY(dispMidi)+1,Math.max(3,dispDur*PX_PER_TICK),ROW_H-2);}
      // velocity bar
      ctx.globalAlpha=.9;
      ctx.fillRect(tickToX(dispStart),rows*ROW_H+VEL_H-(n.velocity/127)*VEL_H+2,
        Math.max(3,dispDur*PX_PER_TICK),(n.velocity/127)*VEL_H-4);
      ctx.globalAlpha=1;
    }
    // playhead
    ctx.strokeStyle='#fff';ctx.beginPath();
    ctx.moveTo(tickToX(playheadTick),0);ctx.lineTo(tickToX(playheadTick),rows*ROW_H);ctx.stroke();
    if(track.locked){ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(KEY_W,0,width-KEY_W,rows*ROW_H);
      ctx.fillStyle='#8b93a1';ctx.font='13px sans-serif';ctx.fillText('lane locked — unlock in the arrangement to edit',KEY_W+12,20);}
  },[track,p.meter,p.lengthBars,bt,width,height,selId,dragState,playheadTick]);

  useEffect(()=>{draw();},[draw]);

  const onMouseDown=(e:React.MouseEvent)=>{
    if(!track||track.locked)return;
    const r=canvasRef.current!.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    if(y>rows*ROW_H){ // velocity strip
      const n=noteAt(x,rows*ROW_H-1)??track.notes.find(n=>{const t=xToTick(x);return t>=n.startTick&&t<n.startTick+n.durationTicks;});
      if(n){const v=Math.max(1,Math.min(127,Math.round((1-(y-rows*ROW_H)/VEL_H)*127)));
        onCommand('setVelocity',{noteIds:[n.id],velocity:v});}
      return;
    }
    const n=noteAt(x,y);
    if(!n){setSelId(null);return;}
    if(n.locked){say('Note is locked','warn');return;}
    setSelId(n.id);
    const nearRight=n.startTick+n.durationTicks-xToTick(x)<60;
    dragRef.current={kind:nearRight?'resize':'move',noteId:n.id,startX:x,startY:y,
      origStart:n.startTick,origMidi:n.midi,origDur:n.durationTicks,moved:false};
    setDragState(dragRef.current);
  };
  const onMouseMove=(e:React.MouseEvent)=>{
    const d=dragRef.current;if(!d)return;
    const r=canvasRef.current!.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    const dt=xToTick(x)-xToTick(d.startX),dm=yToMidi(y)-yToMidi(d.startY);
    if(Math.abs(x-d.startX)>3||Math.abs(y-d.startY)>3)d.moved=true;
    if(d.kind==='move'){(d as any).curStart=Math.max(0,d.origStart+dt);(d as any).curMidi=Math.max(0,Math.min(127,d.origMidi+dm));}
    else (d as any).curDur=Math.max(60,d.origDur+dt);
    setDragState({...d});
  };
  const onMouseUp=async()=>{
    const d=dragRef.current;dragRef.current=null;setDragState(null);
    if(!d||!d.moved)return;
    try{
      if(d.kind==='move')
        await onCommand('moveNotes',{noteIds:[d.noteId],dTicks:(d as any).curStart-d.origStart,dMidi:(d as any).curMidi-d.origMidi});
      else await onCommand('resizeNotes',{noteIds:[d.noteId],durationTicks:(d as any).curDur});
    }catch(e:any){say(e.message,'error');}
  };
  const onDblClick=async(e:React.MouseEvent)=>{
    if(!track||track.locked)return;
    const r=canvasRef.current!.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    if(y>rows*ROW_H||noteAt(x,y))return;
    try{await onCommand('addNote',{trackId:track.id,note:{startTick:xToTick(x),durationTicks:drums?120:240,midi:yToMidi(y),velocity:84}});}
    catch(e:any){say(e.message,'error');}
  };
  const onKey=async(e:React.KeyboardEvent)=>{
    if(e.key==='Delete'||e.key==='Backspace'){
      if(selId){await onCommand('deleteNotes',{noteIds:[selId]});setSelId(null);}
    }
  };

  if(!track)return <div className="dim" style={{padding:20}}>No track selected.</div>;
  return <canvas ref={canvasRef} width={width} height={height} tabIndex={0}
    style={{outline:'none'}}
    onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
    onDoubleClick={onDblClick} onKeyDown={onKey}/>;
}

/** Tone.js playback: one synth per track, performed (swing-materialized) timing,
 *  loop support, playhead callback. Network latency never gates musical time —
 *  everything is scheduled ahead on Tone.Transport. */
import * as Tone from 'tone';
import type {ProjectFile, Track, Note} from '@core/types.js';
import {performedNote, barTicks} from '@core/time.js';

export interface Engine {
  load(p:ProjectFile):void;
  play(fromTick?:number):Promise<void>;
  pause():void;
  stop():void;
  setLoop(on:boolean,startTick?:number,endTick?:number):void;
  dispose():void;
  readonly playing:boolean;
  onTick?:(tick:number)=>void;
}

const synthFor=(t:Track):Tone.PolySynth|Tone.MembraneSynth|Tone.NoiseSynth=>{
  if(t.role==='drums'){
    return new Tone.PolySynth(Tone.MembraneSynth,{volume:-6});
  }
  const inst=t.instrumentId;
  const osc:Tone.ToneOscillatorType=
    inst==='organ'?'sine':inst==='pluck'?'triangle':
    inst==='synth_bass'?'sawtooth':inst==='bright_lead'?'square':'triangle';
  const env=inst==='organ'?{attack:.02,decay:0,sustain:1,release:.1}
    :inst==='pluck'?{attack:.005,decay:.3,sustain:0,release:.05}
    :inst==='round_bass'||inst==='synth_bass'?{attack:.01,decay:.2,sustain:.6,release:.1}
    :{attack:.03,decay:.25,sustain:.4,release:.15};
  return new Tone.PolySynth(Tone.Synth,{oscillator:{type:osc},envelope:env});
};

export function createEngine():Engine {
  let project:ProjectFile|null=null;
  let synths=new Map<string,Tone.PolySynth|Tone.MembraneSynth|Tone.NoiseSynth>();
  let gainNodes=new Map<string,Tone.Gain>();
  let partIds:number[]=[];
  let raf=0;
  let loopStart=0,loopEnd=0,loopOn=false;
  const engine:Engine={
    get playing(){return Tone.Transport.state==='started';},
    load(p){
      engine.stop();
      project=p;
      for(const s of synths.values())s.dispose();
      for(const g of gainNodes.values())g.dispose();
      synths=new Map();gainNodes=new Map();
      for(const t of p.tracks){
        const s=synthFor(t).toDestination();
        const g=new Tone.Gain(Math.pow(10,(t.volumeDb??-10)/20)).toDestination();
        s.disconnect();s.connect(g);
        s.volume.value=t.muted?-Infinity:0;
        synths.set(t.id,s);gainNodes.set(t.id,g);
      }
      Tone.Transport.bpm.value=p.tempoBpm;
      Tone.Transport.swing=p.meter.denominator===8?0:p.swing.ratio>.5?(p.swing.ratio-.5)*2:0;
      Tone.Transport.swingSubdivision='8n';
      Tone.Transport.timeSignature=[p.meter.numerator,p.meter.denominator];
    },
    async play(fromTick=0){
      if(!project)return;
      await Tone.start();
      const p=project;
      engine.stop();
      const bt=barTicks(p.meter);
      const secPerTick=60/p.tempoBpm/480;
      // schedule everything ahead — deterministic, latency-free musical timing
      for(const t of p.tracks){
        const s=synths.get(t.id);if(!s)continue;
        for(const n of t.notes){
          const pn=performedNote(n,p.swing.ratio);
          const start=pn.startTick*secPerTick,dur=Math.max(.03,pn.durationTicks*secPerTick);
          if(pn.startTick<fromTick)continue;
          const freq=Tone.Frequency(n.midi,'midi').toFrequency();
          const id=Tone.Transport.schedule(time=>{
            s.triggerAttackRelease(freq,dur,time,Tone.dbToGain((n.velocity-70)/30));
          },start);
          partIds.push(id);
        }
      }
      const end=p.lengthBars*bt*secPerTick;
      if(loopOn){
        loopEnd=loopEnd||end;
        Tone.Transport.loop=true;
        Tone.Transport.loopStart=loopStart*secPerTick;
        Tone.Transport.loopEnd=loopEnd*secPerTick;
      } else {
        Tone.Transport.loop=false;
        partIds.push(Tone.Transport.schedule(()=>engine.stop(),end+.05));
      }
      Tone.Transport.start('+0',fromTick*secPerTick);
      const tickLoop=()=>{
        if(engine.playing&&project){
          engine.onTick?.(Tone.Transport.seconds/secPerTick);
          raf=requestAnimationFrame(tickLoop);
        }
      };
      raf=requestAnimationFrame(tickLoop);
    },
    pause(){Tone.Transport.pause();cancelAnimationFrame(raf);},
    stop(){
      Tone.Transport.stop();Tone.Transport.cancel(0);
      for(const id of partIds)Tone.Transport.clear(id);
      partIds=[];cancelAnimationFrame(raf);
      for(const s of synths.values())(s as any).releaseAll?.();
      engine.onTick?.(0);
    },
    setLoop(on,start=0,end=0){loopOn=on;loopStart=start;loopEnd=end;},
    dispose(){engine.stop();for(const s of synths.values())s.dispose();for(const g of gainNodes.values())g.dispose();},
  };
  return engine;
}

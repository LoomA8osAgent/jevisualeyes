/** Standard MIDI File format-1 writer + restricted parser oracle (explicit-status subset). */
import {ok, isInt} from './canon.js';
import {barTicks, performedNote} from './time.js';
import {validateProject} from './score.js';
import type {ProjectFile} from './types.js';

function vlq(n:number):number[]{ok(isInt(n,0,0x0fffffff),'MIDI delta out of range');const b=[n&127];while((n>>>=7)>0)b.unshift((n&127)|128);return b;}
function chunk(name:string,body:number[]|Buffer):Buffer{const h=Buffer.alloc(8);h.write(name,0,4,'ascii');h.writeUInt32BE(body.length,4);return Buffer.concat([h,Buffer.from(body)]);}
function textMeta(type:number,text:string):number[]{const bs=[...Buffer.from(text,'utf8')];return [255,type,...vlq(bs.length),...bs];}
interface Ev{tick:number;priority:number;seq:number;bytes:number[]}
function trackBytes(events:Ev[],totalTick:number):Buffer{
  events.sort((a,b)=>a.tick-b.tick||a.priority-b.priority||a.seq-b.seq);
  let last=0;const bs:number[]=[];
  for(const e of events){bs.push(...vlq(e.tick-last),...e.bytes);last=e.tick;}
  bs.push(...vlq(Math.max(last,totalTick)-last),255,47,0);return chunk('MTrk',bs);
}
/** Export project as SMF format 1, PPQ 480, performed (swing-materialized) ticks. */
export function encodeSMF(project:ProjectFile):Buffer{
  validateProject(project);const end=barTicks(project.meter)*project.lengthBars;
  const us=Math.round(60000000/project.tempoBpm),header=Buffer.alloc(6);
  header.writeUInt16BE(1,0);header.writeUInt16BE(project.tracks.length+1,2);header.writeUInt16BE(480,4);
  const conductor:Ev[]=[
    {tick:0,priority:0,seq:0,bytes:textMeta(3,project.title)},
    {tick:0,priority:0,seq:1,bytes:[255,81,3,(us>>>16)&255,(us>>>8)&255,us&255]},
    {tick:0,priority:0,seq:2,bytes:[255,88,4,project.meter.numerator,Math.log2(project.meter.denominator),24,8]}
  ];
  const tracks=[trackBytes(conductor,end)];
  for(const tr of project.tracks){
    let seq=0;const es:Ev[]=[{tick:0,priority:0,seq:seq++,bytes:textMeta(3,tr.name)}];
    if(tr.role!=='drums')es.push({tick:0,priority:1,seq:seq++,bytes:[192|tr.channel,tr.program]});
    for(const n of tr.notes){const pn=performedNote(n,project.swing.ratio);
      es.push({tick:pn.startTick,priority:3,seq:seq++,bytes:[144|tr.channel,pn.midi,pn.velocity]});
      es.push({tick:pn.startTick+pn.durationTicks,priority:2,seq:seq++,bytes:[128|tr.channel,pn.midi,0]});
    }
    tracks.push(trackBytes(es,end));
  }
  return Buffer.concat([chunk('MThd',header),...tracks]);
}
export interface ParsedSMF{format:number;ppq:number;tracks:{tick:number;type:string;metaType?:number;data?:number[];channel?:number;value?:number;midi?:number;velocity?:number}[][]}
/** Parser only for the explicit-status event subset emitted by encodeSMF. */
export function parseSMF(bytes:Buffer|Uint8Array):ParsedSMF{
  const b=Buffer.from(bytes);let i=0;
  const need=(n:number)=>ok(i+n<=b.length,'Truncated MIDI');
  const byte=()=>{need(1);return b[i++];};
  const u16=()=>{need(2);const v=b.readUInt16BE(i);i+=2;return v;};
  const u32=()=>{need(4);const v=b.readUInt32BE(i);i+=4;return v;};
  const label=()=>{need(4);const v=b.toString('ascii',i,i+4);i+=4;return v;};
  const variable=()=>{let v=0;for(let k=0;k<4;k++){const x=byte();v=(v<<7)|(x&127);if(!(x&128))return v;}throw new TypeError('Invalid VLQ');};
  ok(label()==='MThd'&&u32()===6,'Invalid MIDI header');const format=u16(),numTracks=u16(),ppq=u16();
  const tracks:ParsedSMF['tracks']=[];
  for(let t=0;t<numTracks;t++){
    ok(label()==='MTrk','Invalid track');const len=u32(),stop=i+len;ok(stop<=b.length,'Truncated track');let tick=0;const es:ParsedSMF['tracks'][number]=[];
    while(i<stop){tick+=variable();const status=byte();
      if(status===255){const type=byte(),n=variable();need(n);const data=[...b.subarray(i,i+n)];i+=n;es.push({tick,type:'meta',metaType:type,data});}
      else if((status&240)===192)es.push({tick,type:'program',channel:status&15,value:byte()});
      else if([128,144].includes(status&240)){const midi=byte(),velocity=byte();es.push({tick,type:(status&240)===128?'off':'on',channel:status&15,midi,velocity});}
      else throw new TypeError('Unsupported oracle event');
    }
    ok(i===stop,'Track length mismatch');tracks.push(es);
  }
  ok(i===b.length,'Trailing MIDI bytes');return {format,ppq,tracks};
}

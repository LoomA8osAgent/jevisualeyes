/** SSE event bus: persisted job_events with Last-Event-ID replay + heartbeats. */
import type {Response} from 'express';
import type {DB} from './db.js';

type Sink = (eventId:number,type:string,payload:unknown)=>void;

export class EventBus {
  private subs = new Map<string,Set<Sink>>();
  constructor(private db:DB) {}

  publish(jobId:string,eventId:number,type:string,payload:unknown):void {
    for(const s of this.subs.get(jobId)??[]) {
      try{s(eventId,type,payload);}catch{/* sink gone */}
    }
  }

  attach(jobId:string,lastEventId:number|null,res:Response):void {
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.write(': connected\n\n');
    // replay persisted events after Last-Event-ID
    const rows=this.db.prepare(
      'SELECT event_id,event_type,payload_json FROM job_events WHERE job_id=? AND event_id>? ORDER BY event_id')
      .all(jobId,lastEventId??-1) as {event_id:number;event_type:string;payload_json:string}[];
    for(const r of rows)
      res.write(`id: ${r.event_id}\nevent: ${r.event_type}\ndata: ${r.payload_json}\n\n`);
    const sink:Sink=(eventId,type,payload)=>{
      res.write(`id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    if(!this.subs.has(jobId))this.subs.set(jobId,new Set());
    this.subs.get(jobId)!.add(sink);
    const heartbeat=setInterval(()=>{try{res.write(': hb\n\n');}catch{}},15000);
    res.on('close',()=>{
      clearInterval(heartbeat);
      this.subs.get(jobId)?.delete(sink);
    });
  }
}

/** The run log. `job_events` rows are appended inside the commit transaction by the
 *  runner (they ARE the bake report); this bus notifies in-process listeners after.
 *
 *  THE SSE HALF IS GONE with the UI (`roadmap/jevisualeyes-rework.md` §1.2): `attach`,
 *  its keep-alive ping and the `Last-Event-ID` replay were the only Express coupling in
 *  the file, and jevisualeyes is a CLI tool that reports to stdout (§4). The persisted
 *  append survives; replay is `replay()` below, which reads the same rows a resumed run
 *  reads.
 */
import type {DB} from './db.js';

export type EventSink = (jobId:string,eventId:number,type:string,payload:unknown)=>void;

export class EventBus {
  private subs = new Set<EventSink>();
  constructor(private db:DB) {}

  /** Subscribe to every job's events; returns the unsubscribe. */
  subscribe(sink:EventSink):()=>void {
    this.subs.add(sink);
    return ()=>{this.subs.delete(sink);};
  }
  publish(jobId:string,eventId:number,type:string,payload:unknown):void {
    for(const s of this.subs){ try{s(jobId,eventId,type,payload);}catch{/* sink gone */} }
  }
  /** The persisted log for one job, after `afterEventId`. */
  replay(jobId:string,afterEventId=-1):{eventId:number;type:string;payload:unknown}[] {
    return (this.db.prepare(
      'SELECT event_id,event_type,payload_json FROM job_events WHERE job_id=? AND event_id>? ORDER BY event_id')
      .all(jobId,afterEventId) as {event_id:number;event_type:string;payload_json:string}[])
      .map(r=>({eventId:r.event_id,type:r.event_type,payload:JSON.parse(r.payload_json)}));
  }
}

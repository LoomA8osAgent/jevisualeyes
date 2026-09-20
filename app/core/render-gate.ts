/** render-gate.ts — THE EYE, INSIDE THE GENERATOR.
 *
 *  [specs/ai/decision-models.md §P2.10.6 VALIDITY · §P2.9 layer 1 · docs/PLAN.md I5.5]
 *
 *  OPERATOR, 2026-09-20 15:27, on the eleven composed SHADING looks that shipped:
 *  "only TWO render on the object, everything else is black."
 *
 *  WHY NOTHING CAUGHT IT. `constraints` (exported from the app's own visibility gates)
 *  answers ENUM COUPLING — which material model leaves which lamp sub dark. It cannot
 *  answer a knob VALUE: a look with shading opacity 0.27 and dim lamps is black by
 *  arithmetic and every enum in it is legal. And the app-side acceptance macro asserted
 *  that a slot's VALUES reach the engine, which is a true statement about the preset walk
 *  and says nothing about the picture.
 *
 *  SO VALIDITY GETS AN EYE, AND IT SITS WHERE VALIDITY LIVES. COMPOSER §1: validity is
 *  the GENERATOR's property, never a check on the answer. Every method here is called
 *  while a menu is being BUILT — a candidate that cannot be seen is never offered to
 *  Laya, never reaches a bank, and never ships.
 *
 *  THE RENDERER IS NOT HERE AND IS NEVER TRANSCRIBED. This module owns a child process
 *  running `<appRoot>/tools/render-shading-look.js --stdio` (the path comes from config,
 *  never a literal) — the A8os side composes the record through the app's OWN click-time
 *  path, renders headless on the app's OWN GL factory, and measures with the app's OWN
 *  frame metrics. This file only asks and records.
 */
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import type {JsonValue} from './types.js';

export interface FrameMetrics {
  avgLuma:number; darkFrac:number; satMean:number; colorFrac:number;
  hue12:number[]; diffEnergy:number|null;
}
export interface RenderVerdict {
  id:string; visible:boolean; reason:string; metrics:FrameMetrics|null;
  setParamFailed?:string[];
}
export interface GateSubject { id:string; label:string; file:string; matched?:number|null }
export interface GateThresholds {
  lumaFloor:number; lumaFloorRule:string;
  darkCeil:number; darkCeilRule:string;
  coverFloor:number; coverFloorRule:string;
  whiteLuma:number; whiteColorFrac:number;
  defaults:{avgLuma:number; darkFrac:number; satMean:number; colorFrac:number};
}
export interface GateLogEntry {
  id:string; visible:boolean; reason:string;
  params:Record<string,JsonValue>; avgLuma:number|null; darkFrac:number|null;
}

/** A gate that is NOT OPEN still answers — with `visible:true` and the reason `gate-off`.
 *  A composer that silently stopped filtering because a subprocess failed to start would
 *  be GATE-FAILS-OPEN in its purest form, so the artifact records `present:false` and the
 *  run says so in its own output rather than looking like a filtered run. */
export class RenderGate {
  readonly present:boolean;
  readonly subject:GateSubject|null = null;
  readonly thresholds:GateThresholds|null = null;
  readonly defaultMetrics:FrameMetrics|null = null;
  readonly log:GateLogEntry[] = [];
  requests = 0; rejected = 0;
  private proc:ChildProcessWithoutNullStreams|null = null;
  private buf = '';
  private waiting:((v:RenderVerdict)=>void)[] = [];
  private queue:Promise<unknown> = Promise.resolve();

  private constructor(present:boolean) { this.present = present; }

  static async open(appRoot:string, opts:{port?:number; record?:string; w?:number; h?:number} = {}):Promise<RenderGate> {
    const gate = new RenderGate(true);
    const tool = join(appRoot, 'tools', 'render-shading-look.js');
    const args = [tool, '--stdio', '--port', String(opts.port ?? 8097)];
    if (opts.record) args.push('--record', opts.record);
    if (opts.w) args.push('--w', String(opts.w));
    if (opts.h) args.push('--h', String(opts.h));
    const proc = spawn('node', args, {cwd: join(appRoot,'..'), stdio:['pipe','pipe','pipe']});
    gate.proc = proc;
    proc.stdout.setEncoding('utf8');
    let readyResolve:(v:unknown)=>void, readyReject:(e:Error)=>void;
    const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
    let gotReady = false;
    let stderrTail = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d:string) => { stderrTail = (stderrTail + d).slice(-2000); });
    proc.on('exit', (code) => {
      if (!gotReady) readyReject(new Error(`render gate exited ${code} before ready:\n${stderrTail}`));
      // A gate that dies MID-RUN must not leave callers hanging on a promise that can
      // never settle — every pending request gets an explicit failure verdict.
      while (gate.waiting.length) gate.waiting.shift()!({id:'', visible:false, reason:'gate-died', metrics:null});
    });
    proc.stdout.on('data', (chunk:string) => {
      gate.buf += chunk;
      const lines = gate.buf.split('\n'); gate.buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim(); if (!t) continue;
        let o:Record<string,unknown>;
        try { o = JSON.parse(t); } catch { continue; }
        if (o.ready) {
          gotReady = true;
          (gate as {subject:GateSubject}).subject = o.subject as GateSubject;
          (gate as {thresholds:GateThresholds}).thresholds = o.thresholds as GateThresholds;
          (gate as {defaultMetrics:FrameMetrics}).defaultMetrics = o.defaultMetrics as FrameMetrics;
          readyResolve(o);
          continue;
        }
        const w = gate.waiting.shift();
        if (w) w(o as unknown as RenderVerdict);
      }
    });
    await ready;
    return gate;
  }

  /** The gate a caller uses when the renderer is deliberately not running (a pure unit
   *  test, `--no-render-gate`). It never rejects and it SAYS SO on every verdict. */
  static off():RenderGate { return new RenderGate(false); }

  async check(id:string, params:Record<string,JsonValue>):Promise<RenderVerdict> {
    if (!this.present || !this.proc) return {id, visible:true, reason:'gate-off', metrics:null};
    const run = this.queue.then(() => new Promise<RenderVerdict>((resolve) => {
      this.waiting.push(resolve);
      this.proc!.stdin.write(JSON.stringify({id, params}) + '\n');
    }));
    this.queue = run.then(() => {}, () => {});
    const v = await run;
    this.requests++;
    if (!v.visible) this.rejected++;
    this.log.push({id, visible:v.visible, reason:v.reason, params,
      avgLuma: v.metrics ? v.metrics.avgLuma : null,
      darkFrac: v.metrics ? v.metrics.darkFrac : null});
    return v;
  }

  async close():Promise<void> {
    if (!this.proc) return;
    try { this.proc.stdin.write(JSON.stringify({bye:1}) + '\n'); this.proc.stdin.end(); } catch { /* already gone */ }
    await new Promise<void>((res) => {
      const t = setTimeout(() => { try { this.proc!.kill('SIGTERM'); } catch { /* gone */ } res(); }, 8000);
      this.proc!.on('exit', () => { clearTimeout(t); res(); });
    });
    this.proc = null;
  }
}

/** THE KNOB → REJECTION TABLE (the brief's step 4). NOTHING IS HARDCODED: no list of
 *  "opacity-ish" names exists anywhere here. Every knob that appeared in a rendered
 *  candidate is split at the MIDPOINT OF ITS OWN OBSERVED RANGE (booleans split on
 *  false/true) and the rejection rate is measured in each half. `separation` is the gap
 *  between the halves — a knob whose low half rejects far more often than its high half
 *  IS a knob whose low range is hostile, and that is a measurement, not a theory. */
export interface KnobRejection {
  knob:string; n:number; rejected:number; rejectionRate:number;
  kind:'number'|'bool'|'other';
  lowN:number; lowRejectionRate:number|null; lowRange:[number,number]|null;
  highN:number; highRejectionRate:number|null; highRange:[number,number]|null;
  separation:number|null;
}
export function knobRejectionTable(log:GateLogEntry[]):KnobRejection[] {
  const byKnob = new Map<string, {v:JsonValue; rejected:boolean}[]>();
  for (const e of log) for (const [k, v] of Object.entries(e.params)) {
    if (!byKnob.has(k)) byKnob.set(k, []);
    byKnob.get(k)!.push({v, rejected: !e.visible});
  }
  const out:KnobRejection[] = [];
  for (const [knob, obs] of byKnob) {
    const n = obs.length, rejected = obs.filter(o => o.rejected).length;
    const rate = (a:{rejected:boolean}[]) => a.length ? a.filter(o => o.rejected).length / a.length : null;
    const row:KnobRejection = {
      knob, n, rejected, rejectionRate: n ? rejected / n : 0, kind:'other',
      lowN:0, lowRejectionRate:null, lowRange:null,
      highN:0, highRejectionRate:null, highRange:null, separation:null,
    };
    const nums = obs.filter(o => typeof o.v === 'number') as {v:number; rejected:boolean}[];
    const bools = obs.filter(o => typeof o.v === 'boolean') as {v:boolean; rejected:boolean}[];
    if (nums.length === n && n > 1) {
      row.kind = 'number';
      const vals = nums.map(o => o.v);
      const min = Math.min(...vals), max = Math.max(...vals), mid = (min + max) / 2;
      const lo = nums.filter(o => o.v <= mid), hi = nums.filter(o => o.v > mid);
      row.lowN = lo.length; row.highN = hi.length;
      row.lowRange = [r4(min), r4(mid)]; row.highRange = [r4(mid), r4(max)];
      row.lowRejectionRate = rate(lo); row.highRejectionRate = rate(hi);
    } else if (bools.length === n && n > 1) {
      row.kind = 'bool';
      const lo = bools.filter(o => o.v === false), hi = bools.filter(o => o.v === true);
      row.lowN = lo.length; row.highN = hi.length;
      row.lowRange = [0,0]; row.highRange = [1,1];
      row.lowRejectionRate = rate(lo); row.highRejectionRate = rate(hi);
    }
    if (row.lowRejectionRate !== null && row.highRejectionRate !== null)
      row.separation = r4(Math.abs(row.lowRejectionRate - row.highRejectionRate));
    row.rejectionRate = r4(row.rejectionRate);
    if (row.lowRejectionRate !== null) row.lowRejectionRate = r4(row.lowRejectionRate);
    if (row.highRejectionRate !== null) row.highRejectionRate = r4(row.highRejectionRate);
    out.push(row);
  }
  // Sorted by how strongly the knob's own halves disagree — the hostile ranges first.
  return out.sort((a, b) => (b.separation ?? -1) - (a.separation ?? -1));
}
const r4 = (v:number) => Math.round(v * 1e4) / 1e4;

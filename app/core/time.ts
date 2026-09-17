/** Canonical musical time: integer score ticks, ppq=480. One swing materialization. */
import {ok, isInt} from './canon.js';
export const PPQ = 480;
export const STRAIGHT_SPANS = [120,160,240,320,480,720,960,1920];
export const SWING_SPANS = [120,240,480,720,960,1920];
export const DRUM_STRAIGHT_SPANS = [120,160,240,480,960];
export const DRUM_SWING_SPANS = [120,240,480,960];

export interface Meter {numerator:number;denominator:number}
export function barTicks(meter:Meter):number {
  ok([[4,4],[3,4],[6,8]].some(([n,d])=>meter?.numerator===n && meter?.denominator===d),'Unsupported meter');
  return meter.numerator*PPQ*4/meter.denominator;
}
/** One shared tick-warp applied to both starts and ends before playback/export. */
export function warpTick(t:number, ratio=.5):number {
  ok(isInt(t),'Invalid tick'); ok(Number.isFinite(ratio)&&ratio>=.5&&ratio<=.75,'Invalid swing');
  const q=Math.floor(t/PPQ), u=t-q*PPQ;
  return Math.round(q*PPQ+(u<=PPQ/2 ? 2*ratio*u : ratio*PPQ+2*(1-ratio)*(u-PPQ/2)));
}
export function performedNote<T extends {startTick:number;durationTicks:number}>(note:T, ratio=.5):T {
  const startTick=warpTick(note.startTick,ratio);
  const endTick=warpTick(note.startTick+note.durationTicks,ratio);
  return {...note,startTick,durationTicks:Math.max(1,endTick-startTick)};
}
export const ticksToSeconds = (ticks:number, bpm:number):number => ticks*60/(PPQ*bpm);
export const secondsToTicks = (seconds:number, bpm:number):number => seconds*PPQ*bpm/60;

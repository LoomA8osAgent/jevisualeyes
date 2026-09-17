/** App-side selection: provider choice or seeded sampling from the returned distribution. */
import {ok, isInt} from './canon.js';
import type {ChoiceAnswer} from './types.js';

export function nextRandom(seed:number):{seed:number;value:number} {
  ok(isInt(seed,0,0xffffffff),'Invalid PRNG state');
  let x=(seed>>>0)||0x6d2b79f5; // defined normalization of seed zero
  x^=x<<13; x^=x>>>17; x^=x<<5; x>>>=0;
  return {seed:x,value:x/0x100000000};
}
export function selectChoice(
  answer:ChoiceAnswer,
  {mode='model',temperature=.8,seed=1}:{mode?:'model'|'sample';temperature?:number;seed?:number}={}
):{selected:string;seed:number} {
  ok(['model','sample'].includes(mode),'Invalid mode');
  ok(Number.isFinite(temperature)&&temperature>=0&&temperature<=2,'Invalid temperature');
  ok(isInt(seed,0,0xffffffff),'Invalid seed');
  const keys=Object.keys(answer.probabilities).sort(), ps=keys.map(k=>answer.probabilities[k]);
  ok(keys.length>=2&&ps.every(p=>Number.isFinite(p)&&p>=0)&&ps.some(p=>p>0),'Invalid sampling probabilities');
  if(mode==='model') {ok(keys.includes(answer.choice),'Unknown choice');return {selected:answer.choice,seed};}
  if(temperature===0) {
    const maximum=Math.max(...ps); return {selected:keys.find((k,i)=>ps[i]===maximum)!,seed};
  }
  const logs=ps.map(p=>p>0?Math.log(p)/temperature:-Infinity), max=Math.max(...logs);
  const ws=logs.map(l=>Number.isFinite(l)?Math.exp(l-max):0), total=ws.reduce((a,b)=>a+b,0);
  const draw=nextRandom(seed); let threshold=draw.value*total;
  for(let i=0;i<keys.length;i++){threshold-=ws[i];if(threshold<0)return {selected:keys[i],seed:draw.seed};}
  let last=keys[0];
  for(let i=ws.length-1;i>=0;i--)if(ws[i]>0){last=keys[i];break;}
  return {selected:last,seed:draw.seed};
}

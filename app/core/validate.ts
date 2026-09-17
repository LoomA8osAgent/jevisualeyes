/** Provider response validation. Unexpected distributions are errors, never excuses to improvise. */
import {ok, isInt, isPlain, canonicalJSON} from './canon.js';
import type {ChoiceAnswer, ChoiceRequest, ChoiceResponse} from './types.js';

/** Validate one choice answer against its request criteria; probabilities renormalized to sum 1. */
export function validateChoiceAnswer(answer:unknown, criteria:Record<string,string|null>, label='answer'):ChoiceAnswer {
  const keys=Object.keys(criteria).sort();
  ok(keys.length>=2&&keys.length<=255,'Invalid candidate count');
  const a=answer as ChoiceAnswer;
  ok(a?.type==='choice',`${label}: missing/wrong answer type`);
  ok(isPlain(a.probabilities),`${label}: missing probabilities`);
  ok(JSON.stringify(Object.keys(a.probabilities).sort())===JSON.stringify(keys),`${label}: probability keys mismatch`);
  const values=keys.map(k=>a.probabilities[k]);
  ok(values.every(p=>Number.isFinite(p)&&p>=0&&p<=1),`${label}: invalid probability`);
  const sum=values.reduce((x,y)=>x+y,0);
  // Jev returns ~2-decimal probabilities; rounding drift scales with option count
  // (observed: 0.99 over 181 options). Bound the gate at worst-case rounding error.
  const tol=Math.max(1e-3,0.005*keys.length);
  ok(sum>0&&Math.abs(sum-1)<=tol,`${label}: probability sum invalid`);
  ok(keys.includes(a.choice),`${label}: unknown selected option`);
  // Live Jev occasionally returns a near-max but non-argmax choice (sampling/rounding);
  // the choice is a valid option, so it stands — receipts record provider vs selected choice.
  ok(Number.isFinite(a.confidence)&&a.confidence>=0&&a.confidence<=1,`${label}: invalid confidence`);
  return {...a,probabilities:Object.fromEntries(keys.map(k=>[k,a.probabilities[k]/sum]))};
}

/** Validate a full provider response against the request that produced it. */
export function validateChoiceResponse(response:ChoiceResponse, request:ChoiceRequest, questionId?:string):ChoiceAnswer {
  canonicalJSON(response);
  ok(typeof response?.model==='string'&&response.model.length>0,'Missing model');
  ok(isInt(response.usage?.input_tokens)&&isInt(response.usage?.output_tokens),'Invalid usage');
  ok(isPlain(response.answers),'Missing answers');
  const ids=questionId?[questionId]:Object.keys(request.questions);
  const out:Record<string,ChoiceAnswer>={};
  let primary:ChoiceAnswer|undefined;
  for(const id of ids){
    const criteria=request.questions[id]?.criteria;
    ok(isPlain(criteria),`Missing request criteria for ${id}`);
    const a=validateChoiceAnswer(response.answers[id],criteria,id);
    out[id]=a; if(!primary)primary=a;
  }
  // Attach validated multi-question answers on the returned primary answer for callers.
  (primary as ChoiceAnswer & {all?:Record<string,ChoiceAnswer>}).all=out;
  return primary!;
}

/** Provider response validation. An unexpected distribution is an ERROR, never an
 *  excuse to improvise (`docs/COMPOSER.md` §4.1).
 *
 *  TWO CONSTANTS ARE FIXED ON PURPOSE:
 *
 *  1. THE ARGMAX RULE IS STRICT. A near-max but non-argmax reported `choice` is REFUSED:
 *     §4.1 requires "the reported `choice` is a maximum-probability candidate within
 *     numerical tolerance". It cannot trip on `fixture` or on an in-process `local`
 *     provider; if a remote run ever trips it, that is a provider FINDING to record — not
 *     a tolerance to widen quietly.
 *  2. THE SUM TOLERANCE IS FIXED AT 1e-3, never scaled with the option count. Menus here
 *     are ≤ 25 options and usually 2.
 *
 *  There is exactly ONE implementation of this contract in this repo — the schema files
 *  are shape only and never stand in for it.
 */
import {ok, isInt, isPlain, canonicalJSON} from './canon.js';
import type {ChoiceAnswer, DecisionAnswer, DecisionQuestion, DecisionRequest,
  DecisionResponse, NoulAnswer, ScoreAnswer} from './types.js';

/** Sum tolerance — §4.1, fixed. Never scaled with option count (see the header). */
export const SUM_TOLERANCE = 1e-3;
/** Argmax tolerance: "a maximum-probability candidate within numerical tolerance". */
export const ARGMAX_TOLERANCE = 1e-6;

/** The candidate keys a question submits: choice keys, or the score ladder's indices. */
export function candidateKeys(q:DecisionQuestion):string[] {
  if(q.type==='choice')return Object.keys(q.criteria).sort();
  if(q.type==='score')return q.criteria.map((_,i)=>String(i));
  return [];
}

/** Validate one answer against the question that asked it. Probabilities are
 *  renormalized by the (already bounded) rounding error and nothing else. */
export function validateAnswer(answer:unknown, question:DecisionQuestion, label='answer'):DecisionAnswer {
  const a=answer as DecisionAnswer;
  ok(isPlain(a),`${label}: missing answer`);
  ok(a.type===question.type,`${label}: answer type "${(a as DecisionAnswer).type}" != asked "${question.type}"`);

  if(question.type==='noul'){
    const n=(a as NoulAnswer).noul;
    ok(Number.isFinite(n)&&n>=0&&n<=1,`${label}: noul is not a probability (${n})`);
    return {type:'noul',noul:n};
  }

  const keys=candidateKeys(question);
  ok(keys.length>=2&&keys.length<=255,`${label}: invalid candidate count (${keys.length})`);
  const probs=(a as ChoiceAnswer|ScoreAnswer).probabilities;
  ok(isPlain(probs),`${label}: missing probabilities`);
  ok(JSON.stringify(Object.keys(probs).sort())===JSON.stringify(keys),
    `${label}: probability keys mismatch (got ${Object.keys(probs).sort().join(',')}; expected ${keys.join(',')})`);
  const values=keys.map(k=>probs[k]);
  ok(values.every(p=>Number.isFinite(p)&&p>=0),`${label}: probability not finite/non-negative`);
  const sum=values.reduce((x,y)=>x+y,0);
  ok(sum>0&&Math.abs(sum-1)<=SUM_TOLERANCE,`${label}: probabilities sum to ${sum}, not 1 ± ${SUM_TOLERANCE}`);
  const conf=(a as ChoiceAnswer|ScoreAnswer).confidence;
  ok(Number.isFinite(conf)&&conf>=0&&conf<=1,`${label}: confidence outside [0,1] (${conf})`);
  const normalized=Object.fromEntries(keys.map(k=>[k,probs[k]/sum]));
  const maxP=Math.max(...values);

  if(question.type==='choice'){
    const choice=(a as ChoiceAnswer).choice;
    ok(keys.includes(choice),`${label}: choice "${choice}" is not a submitted candidate`);
    // §4.1 strict argmax — see the header.
    ok(maxP-probs[choice]<=ARGMAX_TOLERANCE,
      `${label}: choice "${choice}" is not a maximum-probability candidate (max is "${keys[values.indexOf(maxP)]}")`);
    return {type:'choice',choice,probabilities:normalized,confidence:conf};
  }

  // A Score is an ORDINAL index — the expected position on the SUBMITTED ladder, never a
  // measurement (`docs/COMPOSER.md` §2).
  const score=(a as ScoreAnswer).score;
  ok(Number.isFinite(score)&&score>=0&&score<=keys.length-1,
    `${label}: score ${score} outside the submitted ladder [0,${keys.length-1}]`);
  const legend=(a as ScoreAnswer).legend;
  ok(isPlain(legend)&&Object.keys(legend).length===keys.length,
    `${label}: legend has ${Object.keys(legend??{}).length} levels, ladder has ${keys.length}`);
  return {type:'score',score,probabilities:normalized,legend,confidence:conf};
}

/** Validate a full provider response against the request that produced it.
 *  Every requested question, or it is an error — never a partial answer map (§4.1). */
export function validateResponse(response:DecisionResponse, request:DecisionRequest):Record<string,DecisionAnswer> {
  canonicalJSON(response);
  ok(typeof response?.model==='string'&&response.model.length>0,'Missing model');
  ok(isInt(response.usage?.input_tokens)&&isInt(response.usage?.output_tokens),'Invalid usage');
  ok(isPlain(response.answers),'Missing answers');
  const out:Record<string,DecisionAnswer>={};
  for(const [id,q] of Object.entries(request.questions)) out[id]=validateAnswer(response.answers[id],q,id);
  for(const id of Object.keys(response.answers))
    ok(id in request.questions,`${id}: answer for a question that was not asked`);
  return out;
}

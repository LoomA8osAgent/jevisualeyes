/** The kernel suite: canonicalization, hashing, selection, and the three primitives.
 *
 *  The canon / hash / selection tests are the ones that prove those files behave exactly as
 *  `docs/COMPOSER.md` §4.4 and §5 describe. The validation tests cover the three primitives
 *  and the two constants that are fixed on purpose (`docs/COMPOSER.md` §4.1): the STRICT
 *  argmax rule, and a FIXED 1e-3 sum tolerance.
 */
import {test, assert} from 'vitest';
import {canonicalJSON} from '../core/canon.js';
import {hashJSON} from '../core/hash.js';
import {validateAnswer, validateResponse, candidateKeys, SUM_TOLERANCE} from '../core/validate.js';
import {nextRandom, selectChoice} from '../core/selection.js';
import {AXES, STACK_AXES, STACKS, RATE_LADDER, ROSTER_VERSION,
  axisQuestionId, parseAxisQuestionId, parseLookQuestionId} from '../core/axes.js';
import {buildAxisRequest, buildLookRequest, buildMotionRequest} from '../core/requests.js';
import type {ChoiceQuestion, DecisionRequest, DecisionResponse, LookCandidate, NoulQuestion,
  ScoreQuestion} from '../core/types.js';

const copy=(x:any)=>structuredClone(x);
const record={recordId:'waves/ocean',situation:'an open sea surface',family:'waves',
  tag:'motion:driving density:busy contrast:hard'};

const choiceQ:ChoiceQuestion={type:'choice',instructions:'pick',criteria:{a:'A',b:'B',c:'C'}};
const noulQ:NoulQuestion={type:'noul',instructions:'does it move'};
const scoreQ:ScoreQuestion={type:'score',instructions:'how fast',criteria:['slow','medium','fast']};

/* ── canon + hash ───────────────────────────────────────────────────────────────── */

test('canonical JSON: object key order irrelevant, array order significant',()=>{
  assert.equal(hashJSON({a:1,b:2}),hashJSON({b:2,a:1}));
  assert.notEqual(hashJSON([1,2]),hashJSON([2,1]));
});
test('canonical JSON: unsafe keys, cycles, nonfinite values rejected',()=>{
  assert.throws(()=>canonicalJSON(JSON.parse('{"__proto__":1}')));
  assert.throws(()=>canonicalJSON({x:Infinity}));
  const a:any={};a.a=a;assert.throws(()=>canonicalJSON(a));
});

/* ── selection ──────────────────────────────────────────────────────────────────── */

test('sampling: zero temperature tie-break is stable',()=>{
  const a={type:'choice' as const,choice:'b',probabilities:{b:.5,a:.5},confidence:.5};
  assert.equal(selectChoice(a,{mode:'sample',temperature:0,seed:2}).selected,'a');
});
test('sampling: model mode uses provider choice without advancing PRNG',()=>{
  assert.deepEqual(selectChoice({type:'choice' as const,choice:'b',probabilities:{a:.5,b:.5},confidence:1},
    {mode:'model',seed:7}),{selected:'b',seed:7});
});
test('sampling: same saved distribution and seed replay exactly',()=>{
  const a={type:'choice' as const,choice:'a',probabilities:{a:.7,b:.3,c:0},confidence:1};
  let s1=77,s2=77;
  for(let i=0;i<100;i++){
    const x=selectChoice(a,{mode:'sample',seed:s1}),y=selectChoice(a,{mode:'sample',seed:s2});
    assert.deepEqual(x,y);assert.notEqual(x.selected,'c');s1=x.seed;s2=y.seed;
  }
});
test('sampling: seed zero has defined nonzero normalization',()=>{
  assert.deepEqual(nextRandom(0),nextRandom(0));assert.notEqual(nextRandom(0).seed,0);
});

/* ── validation: the three primitives (docs/COMPOSER.md §4.1) ───────────────────── */

const choiceAnswer=(choice='a')=>({type:'choice' as const,choice,
  probabilities:{a:.7,b:.2,c:.1},confidence:.6});
const scoreAnswer=()=>({type:'score' as const,score:1.3,
  probabilities:{'0':.1,'1':.6,'2':.3},confidence:.5,
  legend:{'0':'slow','1':'medium','2':'fast'}});

test('validate: a complete choice answer validates and renormalizes',()=>{
  const a=validateAnswer(choiceAnswer(),choiceQ) as any;
  assert.equal(a.choice,'a');
  assert.closeTo(Object.values(a.probabilities).reduce((x:any,y:any)=>x+y,0) as number,1,1e-12);
});
test('validate: a noul is a probability, and nothing else is accepted',()=>{
  assert.equal((validateAnswer({type:'noul',noul:.93},noulQ) as any).noul,.93);
  for(const v of [-0.1,1.1,NaN,'0.5'])
    assert.throws(()=>validateAnswer({type:'noul',noul:v},noulQ));
});
test('validate: a score is an ORDINAL on the submitted ladder, with a full legend',()=>{
  assert.equal((validateAnswer(scoreAnswer(),scoreQ) as any).score,1.3);
  const over=copy(scoreAnswer());over.score=3;                       // ladder is [0,2]
  assert.throws(()=>validateAnswer(over,scoreQ));
  const short=copy(scoreAnswer());delete short.legend['2'];
  assert.throws(()=>validateAnswer(short,scoreQ));
});
test('validate: candidate keys are the choice keys / the ladder indices',()=>{
  assert.deepEqual(candidateKeys(choiceQ),['a','b','c']);
  assert.deepEqual(candidateKeys(scoreQ),['0','1','2']);
  assert.deepEqual(candidateKeys(noulQ),[]);
});
test('validate: answer type must match the question that asked it',()=>{
  assert.throws(()=>validateAnswer(choiceAnswer(),noulQ));
  assert.throws(()=>validateAnswer({type:'noul',noul:.5},choiceQ));
});
test('validate: unknown selected key is rejected',()=>{
  assert.throws(()=>validateAnswer(choiceAnswer('invented'),choiceQ),/not a submitted candidate/);
});
test('validate: missing, extra, negative and nonfinite probabilities are rejected',()=>{
  const miss=copy(choiceAnswer());delete miss.probabilities.c;
  assert.throws(()=>validateAnswer(miss,choiceQ),/probability keys mismatch/);
  const extra=copy(choiceAnswer());extra.probabilities.d=0;
  assert.throws(()=>validateAnswer(extra,choiceQ),/probability keys mismatch/);
  for(const v of [-.1,NaN]){
    const bad=copy(choiceAnswer());bad.probabilities.b=v;
    assert.throws(()=>validateAnswer(bad,choiceQ));
  }
});
// §4.1 constant 1 — a near-max but non-argmax reported choice is refused.
test('validate: a non-argmax reported choice is REFUSED (the strict rule)',()=>{
  assert.throws(()=>validateAnswer(choiceAnswer('b'),choiceQ),/maximum-probability candidate/);
});
test('validate: a tie is within tolerance, so either tied key may be reported',()=>{
  const tied={type:'choice' as const,choice:'b',probabilities:{a:.5,b:.5,c:0},confidence:.5};
  assert.equal((validateAnswer(tied,choiceQ) as any).choice,'b');
});
// §4.1 constant 2 — a FIXED 1e-3 bound, never scaled with the option count.
test('validate: the sum tolerance is fixed at 1e-3 regardless of menu width',()=>{
  assert.equal(SUM_TOLERANCE,1e-3);
  const drift=copy(choiceAnswer());drift.probabilities.a=.7+9e-4;     // inside 1e-3
  assert.doesNotThrow(()=>validateAnswer(drift,choiceQ));
  const wide=copy(choiceAnswer());wide.probabilities.a=.7+5e-3;       // a scaled bound would pass
  assert.throws(()=>validateAnswer(wide,choiceQ),/sum/);
});
test('validate: a response answering only some of its questions is an error',()=>{
  const request:DecisionRequest={model:'m',state:'s',questions:{q1:choiceQ,q2:noulQ}};
  const response:DecisionResponse={model:'m',answers:{q1:choiceAnswer()},
    usage:{input_tokens:1,output_tokens:0}};
  assert.throws(()=>validateResponse(response,request),/q2/);
});
test('validate: an answer to a question that was not asked is an error',()=>{
  const request:DecisionRequest={model:'m',state:'s',questions:{q1:choiceQ}};
  const response:DecisionResponse={model:'m',
    answers:{q1:choiceAnswer(),q9:choiceAnswer()},usage:{input_tokens:1,output_tokens:0}};
  assert.throws(()=>validateResponse(response,request),/not asked/);
});
test('validate: a missing model or a nonintegral usage count is an error',()=>{
  const request:DecisionRequest={model:'m',state:'s',questions:{q1:choiceQ}};
  const base:DecisionResponse={model:'m',answers:{q1:choiceAnswer()},usage:{input_tokens:1,output_tokens:0}};
  const noModel=copy(base);noModel.model='';
  assert.throws(()=>validateResponse(noModel,request),/model/);
  const badUsage=copy(base);badUsage.usage.input_tokens=-1;
  assert.throws(()=>validateResponse(badUsage,request),/usage/);
});

/* ── the axis roster + the request builders ─────────────────────────────────────── */

test('roster: every axis carries an `any` option, and every stack answers real axes',()=>{
  for(const axis of Object.values(AXES)){
    assert.ok(axis.options.some(o=>o.id==='any'),`${axis.id} has no unrestricted option`);
    assert.ok(axis.options.length>=3);
    assert.equal(new Set(axis.options.map(o=>o.id)).size,axis.options.length);
  }
  for(const stack of STACKS)
    for(const a of STACK_AXES[stack]) assert.ok(AXES[a],`${stack} names an unknown axis ${a}`);
});
test('roster: no menu anywhere carries a substrate, route or family word',()=>{
  // SUBSTRATE-LEAKS-INTO-USER-TAXONOMY, structurally: the menus are axes, so a
  // substrate word can only arrive by someone typing one into the roster.
  const banned=/\b(sdf|raymarch|parametric|glsl|isf|mesh|shader|fragment|p5j|css)\b/i;
  for(const axis of Object.values(AXES))
    for(const o of axis.options){
      assert.notMatch(o.id,banned);assert.notMatch(o.label,banned);
    }
  for(const level of RATE_LADDER) assert.notMatch(level,banned);
});
test('roster: question ids round-trip through their parsers',()=>{
  for(const stack of STACKS)
    for(const axis of STACK_AXES[stack])
      assert.deepEqual(parseAxisQuestionId(axisQuestionId(stack,axis)),{stack,axis});
  assert.equal(parseAxisQuestionId('axis_shape_nonsense'),null);
  assert.equal(parseLookQuestionId('look_shape'),'shape');
  assert.equal(parseLookQuestionId('look_nonsense'),null);
});
test('requests: the axis request asks exactly one choice per (stack, axis)',()=>{
  const r=buildAxisRequest('m',record,['shape','fx']);
  assert.deepEqual(Object.keys(r.questions).sort(),
    ['axis_fx_contrast','axis_fx_motion','axis_shape_contrast','axis_shape_density','axis_shape_order']);
  for(const q of Object.values(r.questions)){
    assert.equal(q.type,'choice');
    assert.ok(Object.keys((q as ChoiceQuestion).criteria).length>=3);
  }
});
test('requests: a look menu of fewer than two options is not a decision and is skipped',()=>{
  const looks:LookCandidate[]=[{id:'l1',description:'one',params:{}}];
  const two:LookCandidate[]=[...looks,{id:'l2',description:'two',params:{a:1}}];
  const r=buildLookRequest('m',record,{},{shape:looks,fx:two});
  assert.deepEqual(Object.keys(r.questions),['look_fx']);
  assert.deepEqual(Object.keys((r.questions.look_fx as ChoiceQuestion).criteria),['l1','l2']);
});
test('requests: motion asks WHETHER first, then HOW only for the params that moved',()=>{
  const params=[{name:'twist',situation:'the fold angle'},{name:'gain',situation:'the amplitude'}];
  const whether=buildMotionRequest('m',record,{},params);
  assert.deepEqual(Object.keys(whether.questions).sort(),['moving_gain','moving_twist']);
  assert.ok(Object.values(whether.questions).every(q=>q.type==='noul'));
  const how=buildMotionRequest('m',record,{},params,
    {forParams:['twist'],waveforms:[{id:'sine',label:'Sine'},{id:'ramp',label:'Ramp'}]});
  assert.deepEqual(Object.keys(how.questions).sort(),['rate_twist','waveform_twist']);
  assert.equal(how.questions.rate_twist.type,'score');
  assert.deepEqual((how.questions.rate_twist as ScoreQuestion).criteria,RATE_LADDER);
});
test('roster: the version is stated, so a changed question can never be invisible',()=>{
  assert.match(ROSTER_VERSION,/^a8os\.jev\.roster\./);
});

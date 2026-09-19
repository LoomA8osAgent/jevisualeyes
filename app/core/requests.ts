/** Request builders — one function per decision kind, string-valued criteria throughout.
 *
 *  The instructions and their version ids are NOT declared here — they are read from the
 *  roster (`axes.ts`), because that is the one versioned home (`docs/COMPOSER.md` §12) and
 *  a question whose text lives in two places is a question that can change in one of them.
 *
 *  Nothing here samples anything. Candidates arrive as arguments: code enumerates, the
 *  model picks one id, code renders (`docs/COMPOSER.md` §1). The samplers that produce them
 *  are `app/core/samplers.ts`.
 */
import type {DecisionQuestion, DecisionRequest, LookCandidate, StackId} from './types.js';
import {AXES, INSTRUCTIONS, RATE_LADDER, STACK_AXES, STACK_LABELS,
  axisQuestionId, lookQuestionId, movingQuestionId, rateQuestionId, waveformQuestionId} from './axes.js';

/** The state every PART 2 request carries: descriptors only, never a whole file (L6). */
export interface RecordState {
  recordId:string;
  /** The record's own situation sentence — what this shape IS. */
  situation:string;
  family:string;
  /** The requested coordinate for this unit, as words: the tag (rework §2.2). */
  tag:string;
}

const stateFor = (record:RecordState, task:string, extra:Record<string,unknown>={}) => ({
  task, shape:{id:record.recordId, family:record.family, situation:record.situation},
  requestedLook:record.tag, ...extra
});

const axisCriteria = (axisId:string):Record<string,string> =>
  Object.fromEntries(AXES[axisId].options.map(o=>[o.id,o.label]));

/** CALL 1a — the axis coordinate. One independent sub-question per (stack, axis).
 *  Chunked by the caller at ≤6 per request: the encoder re-emits the state into every
 *  row, so above ~6 questions a bundle costs MORE than separate calls
 *  (`docs/COMPOSER.md` §7.1). */
export function buildAxisRequest(model:string, record:RecordState, stacks:StackId[]):DecisionRequest {
  const questions:Record<string,DecisionQuestion>={};
  for(const stack of stacks)
    for(const axis of STACK_AXES[stack])
      questions[axisQuestionId(stack,axis)]={
        type:'choice',
        instructions:`${INSTRUCTIONS.axes} Aspect: ${AXES[axis].label.toLowerCase()} of ${STACK_LABELS[stack]}.`,
        criteria:axisCriteria(axis)
      };
  return {model,state:stateFor(record,'Place the requested look on the image axes'),questions};
}

/** CALL 2 — one N-way Choice per stack over COMPLETE sampled looks. Never a decomposition
 *  into independently-picked parts: twelve individually-plausible values are routinely an
 *  incoherent look (`docs/COMPOSER.md` §1). */
export function buildLookRequest(
  model:string, record:RecordState,
  coordinate:Partial<Record<StackId,Record<string,string>>>,
  candidates:Partial<Record<StackId,LookCandidate[]>>
):DecisionRequest {
  const questions:Record<string,DecisionQuestion>={};
  for(const [stack,looks] of Object.entries(candidates) as [StackId,LookCandidate[]][]){
    if(!looks||looks.length<2)continue; // a single-option menu is not a decision
    questions[lookQuestionId(stack)]={
      type:'choice',
      instructions:`${INSTRUCTIONS.looks} Part: ${STACK_LABELS[stack]}.`,
      criteria:Object.fromEntries(looks.map(l=>[l.id,l.description]))
    };
  }
  return {model,state:stateFor(record,'Choose one complete setting for each part of the image',
    {coordinate}),questions};
}

/** CALL 1b/3 — motion. A Noul per candidate moving param (is it animated at all), and,
 *  for the params that moved, a waveform Choice plus an ordinal rate Score over the real
 *  modulator roster, which the CALLER supplies — this module never transcribes it. */
export function buildMotionRequest(
  model:string, record:RecordState, coordinate:Partial<Record<StackId,Record<string,string>>>,
  params:{name:string;situation:string}[],
  opts:{waveforms?:{id:string;label:string}[]; forParams?:string[]}={}
):DecisionRequest {
  const questions:Record<string,DecisionQuestion>={};
  const moving=opts.forParams??null;
  for(const p of params){
    if(!moving)
      questions[movingQuestionId(p.name)]={type:'noul',
        instructions:`${INSTRUCTIONS.motionMoving} Parameter: ${p.situation}`};
    else if(moving.includes(p.name)){
      if(opts.waveforms&&opts.waveforms.length>=2)
        questions[waveformQuestionId(p.name)]={type:'choice',
          instructions:`${INSTRUCTIONS.motionWaveform} Parameter: ${p.situation}`,
          criteria:Object.fromEntries(opts.waveforms.map(w=>[w.id,w.label]))};
      questions[rateQuestionId(p.name)]={type:'score',
        instructions:`${INSTRUCTIONS.motionRate} Parameter: ${p.situation}`,
        criteria:RATE_LADDER.slice()};
    }
  }
  return {model,state:stateFor(record,
    moving?'Choose how the moving parameters move':'Choose which parameters move',
    {coordinate}),questions};
}

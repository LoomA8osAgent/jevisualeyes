/** ChoiceRequest builders for every decision kind. String-valued criteria throughout. */
import type {ChoiceRequest, EventCandidate, HarmonySlot, JsonValue, LaneRole, Note, PlanState, ProjectFile, Section, Track} from './types.js';
import {criteriaFor, INSTRUMENTS, noteName} from './candidates.js';
import {barCriteriaFor, isBarCandidate, type AnyCandidate, type BarCandidate} from './barpatterns.js';
import {DENSITIES, ENERGY_ARCS, FEELS, FORMS, HARMONIC_VOCAB, LANE_SUBSETS, METERS, TEMPO_RANGE, TONICS, LENGTH_OPTIONS, progressionsFor, spellDegree} from './plan.js';
import {NOTE_NAMES} from './candidates.js';
import {barTicks} from './time.js';
import {GROOVE_AXES} from './grooves.js';
import type {ParsedExplicit} from './plan.js';

export const PROMPT_VERSIONS = {
  plan:'plan.v1', harmony:'harmony.v2', phraseIntent:'phrase.v1', groove:'groove.v1', nextEvent:'event.v2', editIntent:'edit.v1'
};
export const INSTRUCTIONS = {
  plan:'Choose the specified musical planning attribute for the user request. Respect explicit constraints. Use a coherent supported default when the request is vague. Do not assume that an independent question sees another answer.',
  harmony:'Choose the chord progression for this section given the original request, the plan, and what earlier sections used. The chosen progression tiles across the section bars. Real harmonic motion is expected — a static tonic for a whole piece is almost never the right answer. A return section may reuse the theme progression.',
  phraseIntent:'Choose the next phrase intention given its section role and the actual previous motif notes. A recognizable return and a contrasting idea are different choices.',
  groove:'Set this rhythmic parameter for the lane, given the original request and the section role. The parameters jointly define the lane\'s groove; pick values that together realize the requested style rather than any single safe default. A contrasting section may change parameters while a return usually keeps the theme\'s values. Choose "Unrestricted" only when the style truly leaves this parameter free.',
  nextEvent:'Choose the complete next bar for this lane as ONE option. Each option lists the full bar contents — notes/rests/holds with tick durations at PPQ 480 — continuing from the cursor. Read the original user request, applicable edits, recent notes, the completed-sections summary (earlier material you can develop or return to), harmony, phrase intention, meter, position and boundaries. Choose bars that continue the phrase and fit the section role: vary rhythm and contour across bars, do not mechanically repeat the same option. Preserve recognizable motifs where requested. Silent and sustained bars are valid choices.',
  editIntent:'Resolve the requested operation and scope from the supported alternatives. Preserve selected/locked notes unless the user explicitly unlocks them. Do not turn a tempo or instrument edit into note regeneration. Musical requests that are not a mechanical op — busier, jazzier, darker, more energy, different melody — belong to regenerate, not unsupported. Reserve unsupported for requests outside instrumental MIDI entirely (vocals, lyrics, real audio, effects). Choose ambiguous only when the request is contradictory or unclear.'
};

const crit = (pairs:[string,string][]):Record<string,string> => Object.fromEntries(pairs);

/** Planning pass 1: independent plan fields against the same prompt. */
export function buildPlanRequest(model:string, prompt:string, explicit:ParsedExplicit):ChoiceRequest {
  const questions:ChoiceRequest['questions']={
    meter:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: meter.',
      criteria:crit(METERS.map(m=>[`M_${m.numerator}_${m.denominator}`,`${m.numerator}/${m.denominator} time`]))},
    tonic:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: tonic pitch class.',
      criteria:crit(TONICS.map(t=>[`K_${t}`,`Tonic ${NOTE_NAMES[t]} (pitch class ${t})`]))},
    harmonicVocabulary:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: harmonic vocabulary.',
      criteria:crit(HARMONIC_VOCAB.map(v=>[v,v.replaceAll('_',' ')]))},
    feel:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: rhythmic feel.',
      criteria:crit(FEELS.map(f=>[f,f.replaceAll('_',' ')]))},
    form:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: overall form.',
      criteria:crit(FORMS.map(f=>[f,f.replaceAll('_',' ')]))},
    density:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: note density.',
      criteria:crit(DENSITIES.map(d=>[d,d]))},
    energyArc:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: energy arc.',
      criteria:crit(ENERGY_ARCS.map(e=>[e,e.replaceAll('_',' ')]))},
    lanePresence:{type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: which instrument lanes are present.',
      criteria:crit(LANE_SUBSETS.map(s=>[`L_${s}`,`Lanes: ${s.replaceAll('+',', ')}`]))}
  };
  if(explicit.tempoBpm===undefined)
    questions.tempo={type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: tempo in BPM (quarter notes per minute).',
      criteria:crit(TEMPO_RANGE.map(t=>[`T_${t}`,`${t} BPM`]))};
  if(explicit.lengthBars===undefined)
    questions.lengthBars={type:'choice',instructions:INSTRUCTIONS.plan+' Attribute: composition length in bars.',
      criteria:crit(LENGTH_OPTIONS.map(l=>[`B_${l}`,`${l} bars`]))};
  return {model,state:{task:'Plan an instrumental composition',originalPrompt:prompt,
    explicit:{tempoBpm:explicit.tempoBpm??null,lengthBars:explicit.lengthBars??null},
    supported:{meters:['4/4','3/4','6/8'],tempoBpm:[40,220],lengthBars:LENGTH_OPTIONS}},questions};
}

/** Planning pass 2: one instrument question per selected lane, conditioned on the plan. */
export function buildInstrumentRequest(model:string, prompt:string, plan:PlanState):ChoiceRequest {
  const questions:ChoiceRequest['questions']={};
  for(const role of plan.lanes){
    const opts=INSTRUMENTS.filter(i=>i.roles.includes(role));
    if(opts.length<2)continue; // single-option lanes (e.g. drums) get the fallback in the commit
    questions[`instrument_${role}`]={type:'choice',
      instructions:`Choose the instrument for the ${role} lane. ${INSTRUCTIONS.plan}`,
      criteria:crit(opts.map(o=>[o.id,`${o.name}: ${o.description}`]))};
  }
  return {model,state:{task:'Choose instruments',originalPrompt:prompt,plan:{
    meter:[plan.meter.numerator,plan.meter.denominator],tempoBpm:plan.tempoBpm,
    tonicPitchClass:plan.tonicPitchClass,harmonicVocabulary:plan.harmonicVocabulary,
    feel:plan.feel,form:plan.form,density:plan.density,energyArc:plan.energyArc,
    lengthBars:plan.lengthBars,lanes:plan.lanes}},questions};
}

/** One progression choice per section; code expands it to per-bar slots. */
export function buildHarmonyRequest(model:string, prompt:string, plan:PlanState,
    section:Section|null, span:{startTick:number;endTick:number}, nSlots:number,
    prior:{sectionId:string;id:string;chords:string[]}[]):ChoiceRequest {
  const pairs:[string,string][]=progressionsFor(plan.harmonicVocabulary).map(p=>[p.id,
    p.degrees===null?'No harmony — leave this section without a chord'
    :`${p.degrees.map(d=>spellDegree(plan.harmonicVocabulary,d,plan.tonicPitchClass,NOTE_NAMES)).join(' – ')}`+
     ` (${p.degrees.join('–')}${p.degrees.length<nSlots?`, tiled across ${nSlots} bars`:''})`]);
  return {model,state:{task:'Choose harmonic progression',originalPrompt:prompt,
    plan:{tonicPitchClass:plan.tonicPitchClass,harmonicVocabulary:plan.harmonicVocabulary,form:plan.form},
    section:section?{name:section.name,role:section.role,bars:nSlots,startTick:section.startTick,endTick:section.endTick}
      :{name:'Whole piece',role:'whole',bars:nSlots},
    priorProgressions:prior.map(p=>({sectionId:p.sectionId,progression:p.id,chords:p.chords}))},
    questions:{harmony_progression:{type:'choice',instructions:INSTRUCTIONS.harmony,criteria:crit(pairs)}}};
}

/** One groove-parameter question per lane per axis, asked once per section.
 * Jev composes the lane's rhythmic character from universal axes (kick
 * placement, bass pitch logic, …); code then samples bar renderings from
 * that parameter point — styles are coordinates, not authored genres. */
export function buildGrooveRequest(model:string, prompt:string, plan:PlanState,
    section:Section|null, lanes:{id:string;role:LaneRole;instrumentId:string}[]):ChoiceRequest {
  const questions:ChoiceRequest['questions']={};
  for(const l of lanes){
    for(const axis of GROOVE_AXES[l.role]??[])
      questions[`groove_${l.id}_${axis.id}`]={type:'choice',
        instructions:`${INSTRUCTIONS.groove} Lane: ${l.role} (${l.instrumentId}). Parameter: ${axis.label}.`,
        criteria:crit(axis.options.map(o=>[o.id,o.label]))};
  }
  return {model,state:{task:'Set groove parameters per lane',originalPrompt:prompt,
    plan:{tonicPitchClass:plan.tonicPitchClass,harmonicVocabulary:plan.harmonicVocabulary,
      form:plan.form,density:plan.density,energyArc:plan.energyArc,feel:plan.feel},
    section:section?{name:section.name,role:section.role}:null},questions};
}

export const PHRASE_INTENTS=['introduce','repeat_recognizably','vary_ending','contrast','build','resolve','return'];
export function buildPhraseIntentRequest(model:string, prompt:string, section:Section,
    motif:{midi:number;startTick:number;durationTicks:number}[]|null):ChoiceRequest {
  return {model,state:{task:'Choose phrase intention',originalPrompt:prompt,
    section:{name:section.name,role:section.role,startTick:section.startTick,endTick:section.endTick},
    referenceMotif:motif},
    questions:{phrase_intent:{type:'choice',instructions:INSTRUCTIONS.phraseIntent,
      criteria:crit(PHRASE_INTENTS.map(i=>[i,i.replaceAll('_',' ')]))}}};
}

/** The per-event decision. Full context: prompt, plan, score tuples, harmony, intent. */
export function buildEventRequest(model:string, args:{
  prompt:string; editInstruction:string|null; project:ProjectFile; track:Track;
  cursorTick:number; boundaryTick:number; candidates:AnyCandidate[];
  harmony:HarmonySlot|null; phraseIntent:string|null; section:Section|null;
  plan:PlanState; generatedNoteIds:Set<string>;
}):ChoiceRequest {
  const {project,track,cursorTick,boundaryTick,candidates}=args;
  // Rolling context: the model only sees the recent bars plus the theme motif.
  // Resending the whole score every call grows each request linearly until it
  // exceeds the provider's context limit (HTTP 400 max_tokens_exceeded).
  const bt=barTicks(project.meter);
  const winStart=Math.max(0,cursorTick-4*bt), winEnd=boundaryTick+2*bt;
  const theme=project.sections.find(s=>s.role==='theme');
  const motifStart=theme?theme.startTick:-1, motifEnd=theme?Math.min(theme.startTick+2*bt,theme.endTick):-1;
  const scoreSoFar:[string,string,number,number,number,number,string][]=[];
  for(const t of project.tracks)for(const n of t.notes){
    const inWindow=n.startTick>=winStart&&n.startTick<winEnd;
    const isMotif=t.role==='lead'&&motifStart>=0&&n.startTick>=motifStart&&n.startTick<motifEnd;
    if(!inWindow&&!isMotif)continue;
    scoreSoFar.push([n.id,t.id,n.startTick,n.durationTicks,n.midi,n.velocity,
      isMotif&&!inWindow?'motif':args.generatedNoteIds.has(n.id)?'generated':(n.startTick>=cursorTick?'future_immutable':'accepted')]);
  }
  scoreSoFar.sort((a,b)=>a[2]-b[2]);
  // Bounded long-range memory: one compact line per earlier section, so the
  // model can develop/return to ideas it can no longer see in scoreSoFar.
  const sectionSummaries=project.sections
    .filter(s=>s.startTick<cursorTick&&s.endTick<=cursorTick)
    .map(s=>{
      const inS=(n:Note)=>n.startTick>=s.startTick&&n.startTick<s.endTick;
      const chords=project.harmonicPlan
        .filter(h=>h.startTick>=s.startTick&&h.startTick<s.endTick)
        .map(h=>h.rootPitchClass===null?'·':NOTE_NAMES[h.rootPitchClass]);
      const laneNotes=(role:LaneRole)=>project.tracks.find(t=>t.role===role)?.notes.filter(inS)??[];
      const lead=laneNotes('lead');
      const entry:Record<string,JsonValue>={name:s.name,role:s.role,
        bars:Math.round((s.endTick-s.startTick)/bt),harmony:chords.join(' ')};
      if(lead.length){
        const midis=lead.map(n=>n.midi);
        entry.lead=`${Math.min(...midis)}-${Math.max(...midis)} range, ${lead.length} notes, opens ${lead.slice(0,4).map(n=>noteName(n.midi)).join(' ')}`;
      }
      const drums=laneNotes('drums');
      if(drums.length)entry.drums=`${drums.length} hits`;
      return entry;
    });
  return {model,state:{
    task:'Compose the next musical event',originalPrompt:args.prompt,
    editInstruction:args.editInstruction,ppq:480,
    meter:[project.meter.numerator,project.meter.denominator],tempoBpm:project.tempoBpm,
    swing:{mode:project.swing.mode,ratio:project.swing.ratio},
    plan:{tonicPitchClass:args.plan.tonicPitchClass,harmonicVocabulary:args.plan.harmonicVocabulary,
      form:args.plan.form,density:args.plan.density,energyArc:args.plan.energyArc},
    section:args.section?{name:args.section.name,role:args.section.role}:null,
    phraseIntent:args.phraseIntent,completedSections:sectionSummaries,
    lane:{id:track.id,role:track.role,instrument:track.instrumentId},
    cursorTick,boundaryTick,
    currentHarmony:args.harmony?{rootPitchClass:args.harmony.rootPitchClass,quality:args.harmony.quality}:null,
    harmonicPlan:project.harmonicPlan
      .filter(h=>h.endTick>winStart-4*bt&&h.startTick<winEnd+2*bt)
      .map(h=>({startTick:h.startTick,endTick:h.endTick,
        chord:h.rootPitchClass===null?'no_chord':`${NOTE_NAMES[h.rootPitchClass]} ${h.quality}`})),
    scoreSoFar},
    questions:{next_event:{type:'choice',instructions:INSTRUCTIONS.nextEvent,
      criteria:candidates.length&&isBarCandidate(candidates[0])
        ?barCriteriaFor(candidates as BarCandidate[],cursorTick)
        :criteriaFor(candidates as EventCandidate[],cursorTick)}}};
}

/** Edit-intent resolution: bounded classifier over supported operations. */
export function buildEditIntentRequest(model:string, project:ProjectFile, instruction:string,
    selection:{trackIds:string[];startTick:number;endTick:number}|null):ChoiceRequest {
  const bt=barTicks(project.meter);
  const lanePairs:[string,string][]=project.tracks.map(t=>[t.id,`${t.name} (${t.role})`]);
  lanePairs.push(['ALL','All lanes'],['NONE','No specific lane']);
  return {model,state:{
    task:'Resolve an edit request to a supported operation',originalPrompt:project.prompt,
    instruction,lengthBars:project.lengthBars,barTicks:bt,
    explicitSelection:selection,
    lanes:project.tracks.map(t=>({id:t.id,role:t.role,instrument:t.instrumentId,locked:t.locked,
      noteCount:t.notes.length}))},
    questions:{
      operation:{type:'choice',instructions:INSTRUCTIONS.editIntent+' Field: operation.',
        criteria:crit([
          ['setTempo','Change playback tempo only; notes unchanged'],
          ['setInstrument','Swap a lane instrument/program; notes unchanged'],
          ['setTrackGain','Change lane volume; notes unchanged'],
          ['setMute','Mute or unmute a lane; notes unchanged'],
          ['transpose','Shift pitches by semitones in a scope'],
          ['setLocks','Lock or unlock tracks/notes'],
          ['regenerate','Re-compose notes in a scope with new decisions'],
          ['duplicateRegion','Copy a region to another position'],
          ['unsupported','Request cannot be done by supported operations'],
          ['ambiguous','Request is contradictory or unclear']
        ])},
      targetLane:{type:'choice',instructions:INSTRUCTIONS.editIntent+' Field: primary target lane.',
        criteria:crit(lanePairs)},
      scope:{type:'choice',instructions:INSTRUCTIONS.editIntent+' Field: region scope.',
        criteria:crit([['selection','The current explicit selection'],['whole','The entire composition'],
          ['first_half','Bars 1 to midpoint'],['second_half','Midpoint to end'],
          ['first_quarter','Opening quarter'],['last_quarter','Final quarter']])},
      direction:{type:'choice',instructions:INSTRUCTIONS.editIntent+' Field: magnitude/direction if applicable.',
        criteria:crit([['less','Smaller/calmer/slower'],['same','Keep amount'],['more','Bigger/busier/faster'],['exact','An explicit numeric value is given in the instruction'],['none','Not applicable']])}
    }};
}

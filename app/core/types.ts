/** Application contracts. No dependency on the provider SDK or browser framework. */
export type LaneRole = 'lead' | 'bass' | 'harmony' | 'drums';
export type SourceKind = 'jev' | 'manual' | 'derived' | 'fixture';
export interface Source { kind: SourceKind; decisionIds: string[]; parentNoteIds: string[] }
export interface Note {
  id: string; startTick: number; durationTicks: number; midi: number;
  velocity: number; locked: boolean; source: Source;
}
export interface Track {
  id: string; name: string; role: LaneRole; instrumentId: string;
  program: number; channel: number; volumeDb: number; pan: number;
  muted: boolean; solo: boolean; locked: boolean; notes: Note[];
}
export interface Scope { trackIds: string[]; startTick: number; endTick: number }
export interface Section { id: string; name: string; role: string; startTick: number; endTick: number }
export interface HarmonySlot {
  startTick: number; endTick: number; rootPitchClass: number | null;
  quality: 'major'|'minor'|'dominant7'|'major7'|'minor7'|'diminished'|'sus2'|'sus4'|'no_chord';
}
export interface ProjectFile {
  schemaVersion: 'jev-music.project.v1'; id: string; revisionId: string; title: string;
  createdAt: string; updatedAt: string; prompt: string; ppq: 480; tempoBpm: number;
  meter: {numerator: 3|4|6; denominator: 4|8};
  swing: {mode:'straight'|'light'|'shuffle'|'custom'; ratio:number};
  lengthBars: number; sections: Section[]; harmonicPlan: HarmonySlot[]; tracks: Track[];
  generation: {
    provenance:'live'|'fixture'|'mixed'|'manual'; model:string; candidateVersion:string;
    contextMode:'full'|'explicit_rolling';
    selection:{mode:'model'|'sample';temperature:number;seed:number};
    partial:boolean; requestedLengthBars:number;
    history:{instruction:string;baseRevisionId:string}[];
  };
}
export interface EventCandidate {
  id: string; kind:'note'|'rest'|'hold'; pitches:number[];
  stepTicks:number; gateTicks:number; targetNoteIds?:string[];
}
export interface Meter {numerator:3|4|6;denominator:4|8}
export type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface ChoiceQuestion {
  type:'choice'; instructions:string|JsonValue[]|{[key:string]:JsonValue};
  criteria:Record<string,string|null>;
}
export interface ChoiceRequest { model:string; state:string|JsonValue[]|{[key:string]:JsonValue}; questions:Record<string,ChoiceQuestion> }
export interface ChoiceAnswer {
  type:'choice'; choice:string; probabilities:Record<string,number>; confidence:number;
}
export interface ChoiceResponse {
  model:string; answers:Record<string,ChoiceAnswer>;
  usage:{input_tokens:number;output_tokens:number};
}
export interface ProviderReceipt {
  response:ChoiceResponse; rawResponseHash:string; latencyMs:number;
  httpStatus:number; providerRequestId?:string;
}
export interface DecisionProvider {
  evaluate(request:ChoiceRequest, signal:AbortSignal):Promise<ProviderReceipt>;
}
export interface DecisionReceipt {
  schemaVersion:'jev-music.receipt.v1'; id:string; jobId:string; decisionIndex:number;
  attemptIndex:number; requestHash:string; candidateHash:string; model:string;
  questionId:string; providerChoice:string; selectedChoice:string;
  selectionMode:'model'|'sample'; seedBefore:number; seedAfter:number;
  usage:{inputTokens:number;outputTokens:number;complete:boolean}; latencyMs:number;
  provenance:'live'|'synthetic';
}
export type JobStatus='queued'|'planning'|'composing'|'pausing'|'paused'|'retry_wait'|'interrupted'|'failed'|'cancelled'|'completed';
export interface PendingDecision {
  decisionId:string; decisionIndex:number; epoch:number; request:ChoiceRequest;
  requestHash:string; candidates:EventCandidate[]; candidateHash:string;
  laneId:string; cursorTick:number; attemptCount:number;
  kind:string; extra?:JsonValue;
}
export interface GenerationJob {
  id:string; projectId:string; baseRevisionId:string; status:JobStatus; epoch:number;
  mode:'compose'|'variation'|'regenerate'|'edit'; phase:string; instruction:string;
  scope:Scope; draft:ProjectFile; laneCursors:Record<string,number>;
  decisionIndex:number; samplerState:number; attemptCount:number; attemptLimit:number;
  pending:PendingDecision|null; completedThroughTick:number;
  lastEventId:number; errorCode?:string;
  plan?:PlanState;
}
/** Structured plan chosen during the planning phase. */
export interface PlanState {
  meter:{numerator:3|4|6;denominator:4|8}; tempoBpm:number; tonicPitchClass:number;
  harmonicVocabulary:string; feel:'straight'|'light_swing'|'shuffle';
  form:string; density:string; energyArc:string; lengthBars:number;
  lanes:LaneRole[]; instruments:Record<string,string>;
  warnings:string[]; explicit:{tempoBpm?:number;lengthBars?:number};
}
export type ResolvedEdit =
 | {type:'setTempo';bpm:number}
 | {type:'setInstrument';trackId:string;instrumentId:string}
 | {type:'setTrackGain';trackId:string;volumeDb:number}
 | {type:'setMute';trackId:string;muted:boolean}
 | {type:'transpose';scope:Scope;semitones:number}
 | {type:'setLocks';trackIds:string[];noteIds:string[];locked:boolean}
 | {type:'regenerate';scope:Scope;instruction:string;preserveTrackIds:string[];variation?:'less'|'same'|'more'}
 | {type:'duplicateRegion';scope:Scope;destinationStartTick:number};

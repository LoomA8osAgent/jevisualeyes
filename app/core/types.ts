/** Application contracts. No dependency on the provider SDK or a browser framework.
 *
 *  Two things are load-bearing here, both from `docs/COMPOSER.md`:
 *   · the THREE primitives (§2) — `noul`, `choice` and `score`, because every question
 *     class of the pipeline (§7) needs them and the local provider answers all three.
 *   · the provider carries `id` / `modelId` / `providerClass` / `isRetryable` (§3), so a
 *     receipt can never read as calibrated when a DECODE provider made it.
 */

export type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};

/* ── the three primitives (docs/COMPOSER.md §2) ─────────────────────────────────── */

export type Instructions = string|JsonValue[]|{[key:string]:JsonValue};

/** Yes/no, answered as a probability in [0,1]. High = yes; near 0.5 is UNCERTAIN, and it
 *  is never interpolated as a magnitude (`docs/COMPOSER.md` §2). */
export interface NoulQuestion { type:'noul'; instructions:Instructions }
/** One option from a NAMED, CLOSED set, with a probability per option. */
export interface ChoiceQuestion { type:'choice'; instructions:Instructions; criteria:Record<string,string|null> }
/** A position on an ORDERED ladder of named levels. The number is an ordinal index, never
 *  a measurement (`docs/COMPOSER.md` §2). */
export interface ScoreQuestion { type:'score'; instructions:Instructions; criteria:string[] }
export type DecisionQuestion = NoulQuestion|ChoiceQuestion|ScoreQuestion;

export interface NoulAnswer { type:'noul'; noul:number }
export interface ChoiceAnswer { type:'choice'; choice:string; probabilities:Record<string,number>; confidence:number }
export interface ScoreAnswer { type:'score'; score:number; probabilities:Record<string,number>; legend:Record<string,string>; confidence:number }
export type DecisionAnswer = NoulAnswer|ChoiceAnswer|ScoreAnswer;

export interface DecisionRequest { model:string; state:Instructions; questions:Record<string,DecisionQuestion> }
export interface DecisionResponse {
  model:string; answers:Record<string,DecisionAnswer>;
  usage:{input_tokens:number;output_tokens:number};
}

/* ── the provider (docs/COMPOSER.md §3) ─────────────────────────────────────────── */

/** §3.1 — what a provider's NUMBER means. Only TRAINED may arm a confidence band. */
export type ProviderClass = 'TRAINED'|'DECODE'|'DIFFUSION'|'FIXTURE';

export interface ProviderReceipt {
  response:DecisionResponse; rawResponseHash:string; latencyMs:number;
  httpStatus:number; providerRequestId?:string;
}
export interface DecisionProvider {
  id:string;
  modelId:string;
  providerClass:ProviderClass;
  /** `synthetic` for the fixture; `live` for anything that actually inferred (§5). */
  provenance:'live'|'synthetic';
  decide(request:DecisionRequest, signal:AbortSignal):Promise<ProviderReceipt>;
  /** The provider's own error classification; the retry POLICY lives in the runner (§4.3). */
  isRetryable(err:unknown):boolean;
}

/* ── receipts (docs/COMPOSER.md §5) ─────────────────────────────────────────────── */

export interface DecisionReceipt {
  schemaVersion:'a8os.jev.receipt.v1'; id:string; jobId:string;
  decisionIndex:number; attemptIndex:number;
  requestHash:string; candidateHash:string;
  providerId:string; providerClass:ProviderClass;
  /** What the provider RETURNED, never what was sent (§5). */
  model:string;
  promptTemplateVersion:string; candidateMapVersion:string; rosterVersion:string;
  questionId:string; answerType:DecisionAnswer['type'];
  /** Choice only; null for noul/score — there is nothing to select from a scalar. */
  providerChoice:string|null; selectedChoice:string|null;
  /** The raw answer value: the noul probability, the score ordinal, or the choice key. */
  answerValue:string|number;
  confidence:number;
  selectionMode:'model'|'sample'; seedBefore:number; seedAfter:number;
  usage:{inputTokens:number;outputTokens:number;complete:boolean}; latencyMs:number;
  provenance:'live'|'synthetic';
}

/* ── the composed artifact (docs/COMPOSER.md §7) ────────────────────────────────── */

/** One part of a card the composer sets as a whole (`docs/COMPOSER.md` §9). */
export type StackId = 'shape'|'mathops'|'shade'|'layers'|'fx'|'modulation';

/** An axis coordinate: axis id → the chosen situation word (docs/COMPOSER.md §6). */
export type AxisCoordinate = Record<string,string>;

/** One complete sampled look for one stack. Its `params` ARE its recorded effect —
 *  the model's returned key is LOOKED UP here and never interpreted (§4.2). */
export interface LookCandidate {
  id:string;
  /** One readable line, e.g. "dense regular field, hard edges, two folds, cool palette". */
  description:string;
  params:Record<string,JsonValue>;
  /** The knobs this look declined to move because they carry no situation sentence
   *  (`docs/COMPOSER.md` §8): held at DEFAULT and NAMED, never silently omitted. Sorted. */
  skipped?:string[];
}

/** A modulation candidate for one moving param: a waveform id + an ordinal rate level. */
export interface MotionState { moving:boolean; waveform?:string; rateLevel?:number }

/** The unit of composition: ONE (record, tag). A preset is not a sequence, so nothing
 *  inside a unit chains except the two real menu-rebuilds (`docs/COMPOSER.md` §7). */
export interface CompositionDraft {
  schemaVersion:'a8os.jev.composition.v1';
  recordId:string; tag:string;
  /** stack id → its axis coordinate. */
  coordinate:Partial<Record<StackId,AxisCoordinate>>;
  /** stack id → the committed look. */
  stacks:Partial<Record<StackId,{lookId:string;params:Record<string,JsonValue>}>>;
  /** param name → its committed motion. */
  motion:Record<string,MotionState>;
  generation:{
    provenance:'live'|'synthetic'|'mixed';
    providerId:string; providerClass:ProviderClass; model:string;
    rosterVersion:string; candidateMapVersion:string;
    selection:{mode:'model'|'sample';temperature:number;seed:number};
    partial:boolean;
  };
}

/* ── the job journal (docs/COMPOSER.md §4.3 + §5) ───────────────────────────────── */

export type DecisionKind = 'axes'|'looks'|'motion';
export type JobStatus='queued'|'composing'|'pausing'|'paused'|'retry_wait'|'interrupted'|'failed'|'cancelled'|'completed';

export interface PendingDecision {
  decisionId:string; decisionIndex:number; epoch:number; kind:DecisionKind;
  request:DecisionRequest; requestHash:string;
  /** The persisted candidate map: question id → its candidates (§4.2). */
  candidates:Record<string,LookCandidate[]>; candidateHash:string;
  extra?:JsonValue;
}

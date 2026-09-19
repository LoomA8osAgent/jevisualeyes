/** Application contracts. No dependency on the provider SDK or a browser framework.
 *
 *  THE DECISION HALF of the upstream `types.ts` survives; its domain half — eleven
 *  types describing the upstream tool's own subject matter — is deleted, file by file,
 *  per `roadmap/jevisualeyes-rework.md` §1.1.
 *
 *  Two substantive extensions over upstream, both from `specs/ai/jev.md`:
 *   · the THREE primitives (§1.2) — upstream shipped `choice` only; `noul` and `score`
 *     join it, because every §P2.2 question class needs them and the reference runtime
 *     answers all three (§9.4).
 *   · the provider carries `id` / `modelId` / `providerClass` / `isRetryable` (§3.1 +
 *     §3.1a), so a receipt can never read as calibrated when a DECODE provider made it.
 */

export type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};

/* ── the three primitives (jev.md §1.2) ─────────────────────────────────────────── */

export type Instructions = string|JsonValue[]|{[key:string]:JsonValue};

/** Yes/no, answered as a probability in [0,1]. High = yes; never a magnitude (L12). */
export interface NoulQuestion { type:'noul'; instructions:Instructions }
/** One option from a NAMED, CLOSED set, with a probability per option. */
export interface ChoiceQuestion { type:'choice'; instructions:Instructions; criteria:Record<string,string|null> }
/** A position on an ORDERED ladder of named levels. The number is an ordinal index (L4). */
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

/* ── the provider (jev.md §3.1) ─────────────────────────────────────────────────── */

/** §3.1a — what a provider's NUMBER means. Only TRAINED may arm a confidence band. */
export type ProviderClass = 'TRAINED'|'DECODE'|'DIFFUSION'|'FIXTURE';

export interface ProviderReceipt {
  response:DecisionResponse; rawResponseHash:string; latencyMs:number;
  httpStatus:number; providerRequestId?:string;
}
export interface DecisionProvider {
  id:string;
  modelId:string;
  providerClass:ProviderClass;
  /** `synthetic` for the fixture; `live` for anything that actually inferred (§8). */
  provenance:'live'|'synthetic';
  decide(request:DecisionRequest, signal:AbortSignal):Promise<ProviderReceipt>;
  /** The provider's own error classification; the retry POLICY lives in the runner (§10.4). */
  isRetryable(err:unknown):boolean;
}

/* ── receipts (jev.md §8) ───────────────────────────────────────────────────────── */

export interface DecisionReceipt {
  schemaVersion:'a8os.jev.receipt.v1'; id:string; jobId:string;
  decisionIndex:number; attemptIndex:number;
  requestHash:string; candidateHash:string;
  providerId:string; providerClass:ProviderClass;
  /** What the provider RETURNED, never what was sent (§2.9). */
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

/* ── the composed artifact (jev.md §P2.1, rework plan §2.2/§2.7) ────────────────── */

/** A stack of a card — the lane's replacement (rework §2.1). */
export type StackId = 'shape'|'mathops'|'shade'|'layers'|'fx'|'modulation';

/** An axis coordinate: axis id → the chosen situation word (jev.md §6). */
export type AxisCoordinate = Record<string,string>;

/** One complete sampled look for one stack. Its `params` ARE its recorded effect —
 *  the model's returned key is LOOKED UP here and never interpreted (§10.2). */
export interface LookCandidate {
  id:string;
  /** One readable line, e.g. "dense regular field, hard edges, two folds, cool palette". */
  description:string;
  params:Record<string,JsonValue>;
  /** The knobs this look declined to move because they carry no situation sentence
   *  (`jev.md` §P2.4): held at DEFAULT and NAMED, never silently omitted. Sorted. */
  skipped?:string[];
}

/** A modulation candidate for one moving param: a waveform id + an ordinal rate level. */
export interface MotionState { moving:boolean; waveform?:string; rateLevel?:number }

/** The unit of composition: ONE (record, tag). A preset is not a sequence (rework §2.2). */
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

/* ── the job journal (jev.md §10.4 + rework §1.6) ───────────────────────────────── */

export type DecisionKind = 'axes'|'looks'|'motion';
export type JobStatus='queued'|'composing'|'pausing'|'paused'|'retry_wait'|'interrupted'|'failed'|'cancelled'|'completed';

export interface PendingDecision {
  decisionId:string; decisionIndex:number; epoch:number; kind:DecisionKind;
  request:DecisionRequest; requestHash:string;
  /** The persisted candidate map: question id → its candidates (§10.2). */
  candidates:Record<string,LookCandidate[]>; candidateHash:string;
  extra?:JsonValue;
}

/** THE EYE'S TYPED SHAPE — what the video verdict pipeline writes, and what the composer may
 *  do with it. `docs/COMPOSER.md` §5.1.
 *
 *  Operator, 2026-09-20 00:27 (ratified, ordered after the 0.4.0 release): "the stack has no
 *  eye. decision models are text-in; the vision is another component." The eye lives in a
 *  SIBLING repository (`~/gits/visualeyes`, `agent-reports/video-pipeline-v1.md`): layer 1
 *  measures a captured frame sequence in pure arithmetic (`tools/lib/frame-metrics.js`), layer
 *  2 asks a decision model four typed questions about those numbers
 *  (`app/tools/_look-roster.js` / `tools/judgment/look-verdict.js`), and both land in a watch
 *  receipt. This module is what makes that receipt a typed input HERE, in the composer's own
 *  repository, so a composed coordinate can be checked against what a rendered look actually
 *  did — never so that it can act on that check.
 *
 *  ⚠ REPORT, NEVER RESAMPLE (`docs/COMPOSER.md` §10, item 4 — "deterministic edits never reach
 *  the model at all", and the video pipeline's own §6: "A report, never an auto-resample").
 *  `judgeAgainstCoordinate` below returns findings. It does not touch a `CompositionDraft`, it
 *  does not requeue a decision, and it does not lock or unlock anything. Nothing in this file
 *  calls `JobRunner` or `Composer`.
 *
 *  ⚠ THE MOTION FINDING IS BARRED, NAMED AS BARRED, EVERY TIME IT FIRES
 *  (`agent-reports/video-pipeline-v1.md` §5's falsification, §7 conflict 2). The pipeline's own
 *  measurement: `motion_feeling` answered "steady" at p 0.3355 (concentration 0.0710) on a
 *  genuinely moving record AND at p 0.2443 (concentration 0.0292) on a hand-built dead-black,
 *  fully-frozen flow — near-uniform over its seven options in both directions, the SAME word
 *  winning on a picture that is not moving at all. "The seam is SENSITIVE and NOT CALIBRATED."
 *  So every finding this module derives from `motion_feeling` carries `barred: true` and a
 *  `reason` naming that measurement, and `judgeAgainstCoordinate` NEVER lets a `motion_feeling`
 *  finding read as actionable — the field exists so a reader can see what the seam said, not so
 *  a caller can act on it. `has_motion` and `something_wrong` are Nouls with their own
 *  measured limits (§5's falsification: neither crossed its placeholder cut on the dead-black
 *  case either) and are reported the same way — advisory, with `p`, never as a verdict a
 *  caller trusts uncontested.
 *
 *  ⚠ THE VOCABULARY OWNS BOTH SIDES OF THIS SEAM AND MUST NOT DRIFT (`SHARED-CANON-DUPLICATED-
 *  PER-ENGINE`, declared and un-cured at the pipeline's layer — its own header says so). The
 *  seven `MOTION_FEELING` keys (`app/core/axes.ts`) are the canonical side; `assertMotionKeys`
 *  below checks a copy transcribed by the OTHER repo (`_look-roster.js`) against this one's own
 *  live keys, so a divergence is a thrown, named error rather than a silently different
 *  translation.
 */
import {ok} from './canon.js';
import {MOTION_FEELING} from './axes.js';
import type {AxisCoordinate, StackId} from './types.js';

/* ── the receipt's shape, as the pipeline writes it ─────────────────────────────────────── */

/** One frame's measurement (`tools/lib/frame-metrics.js summarize` per-frame input; the
 *  per-frame array itself is not carried here — only the flow SUMMARY the look-verdict tool
 *  reads, because that is the only part this repo has a use for). */
export interface FrameMetricsSummary {
  schema:'a8os.frame-metrics.v1';
  frames:number;
  spanMs:number|null;
  luma:{mean:number; min:number; max:number; trendPerFrame:number};
  dark:{mean:number; max:number};
  motion:{mean:number; max:number; pairs:number; stillPairs:number}|null;
  flicker:{crossings:number; perSec:number|null}|null;
  color:{satMean:number; colorFrac:number; hue12:number[];
    dominant:{bin:number; name:string; degrees:number; frac:number}|null; spreadBins:number}|null;
  rafMaxGap:number|null;
  thresholds:Record<string,number>;
}

/** One Noul's read (`_look-roster.js noulVerdict`). `flagged` is the seam's OWN advisory band
 *  (a 0.5 placeholder, per the source) — reported, never trusted as calibrated. */
export interface LookNoulVerdict {
  value:number|null; flagged:boolean; answered:boolean; findingAt:'high'|'low'; word:string;
}
/** The `motion_feeling` Choice's read (`_look-roster.js choiceVerdict`). */
export interface LookChoiceVerdict {
  word:string|null; p:number|null; confidence:number|null; answered:boolean; certain:boolean;
  distribution:Record<string,number>|null;
}

/** The four verdicts, exactly as `tools/judgment/look-verdict.js` assembles `out.answers`. */
export interface LookAnswers {
  has_motion:LookNoulVerdict;
  motion_feeling:LookChoiceVerdict;
  look_changed?:LookNoulVerdict;
  something_wrong:LookNoulVerdict;
}

/** The look-verdict record (`a8os.look-verdict.v1`, written beside the frames). This is the
 *  artifact `readLookReceipt` loads — NOT the raw watch receipt (`design/watch-receipts/
 *  <hash>.json`), which carries many flows and no verdict at all until this tool has read it.
 *  A reader wanting the raw metrics without a model in the loop reads `metrics` here, which is
 *  the exact `FrameMetricsSummary` the watch receipt's `macros[].watch.metrics` field carries. */
export interface LookVerdictRecord {
  schema:'a8os.look-verdict.v1';
  rosterVersion:string;
  promptTemplateVersion:string;
  metricsSchema?:string;
  provenance:{
    receipt:string; treeHash:string; backend:string; timestamp:string;
    flow:string; ok:boolean; frames:number; frameSha256:string[];
    sheet:{file:string; sha256:string; cols:number; rows:number; cells:number;
      sampledFrom:number; cellW:number; cellH:number}|null;
    vs:{receipt:string; treeHash:string; flow:string}|null;
  };
  metrics:FrameMetricsSummary;
  state:string;
  pairState:string|null;
  providerId:string; model:string|null;
  usage:{input_tokens:number; output_tokens:number}|null;
  latencyMs:number;
  answers:LookAnswers;
  advisory:true;
  bands:{advise:number; choiceAt:number; calibrated:boolean};
}

/* ── the loader ──────────────────────────────────────────────────────────────────────────── */

export class LookReceiptError extends Error {
  constructor(message:string, public readonly path:string) { super(message); this.name = 'LookReceiptError'; }
}

/** Validate shape and version; FAIL CLOSED on anything that is not this contract
 *  (`docs/COMPOSER.md` §3.2's rule applied to a file read instead of a network call — a
 *  receipt missing `metricsSchema` predates layer 1, per the pipeline's own
 *  `look-verdict.js pickFlow`: "A FLOW WITH NO METRICS IS NOT A FLOW THIS TOOL CAN READ". A
 *  loader that guessed at a partial shape would be exactly the failure mode `docs/COMPOSER.md`
 *  §3.2 forbids for a provider — never quietly degrade). */
export function readLookReceipt(json:unknown, path='<unknown>'):LookVerdictRecord {
  ok(json !== null && typeof json === 'object', `not an object: ${path}`);
  const r = json as Record<string,unknown>;
  if (r.schema !== 'a8os.look-verdict.v1')
    throw new LookReceiptError(
      `not a look-verdict record (schema "${String(r.schema)}", wanted "a8os.look-verdict.v1"): ${path}`, path);
  const metrics = r.metrics as Record<string,unknown>|undefined;
  if (!metrics || metrics.schema !== 'a8os.frame-metrics.v1')
    throw new LookReceiptError(
      `no metricsSchema — this receipt predates layer 1 (frame-metrics) and carries no measured ` +
      `frame summary to judge: ${path}`, path);
  if (!r.answers || typeof r.answers !== 'object')
    throw new LookReceiptError(`no answers — advisory verdicts were never produced for this flow: ${path}`, path);
  if (r.advisory !== true)
    throw new LookReceiptError(
      `advisory !== true — this repo consumes only the advisory contract; a receipt claiming ` +
      `to be anything else is a version this loader does not know: ${path}`, path);
  return r as unknown as LookVerdictRecord;
}

/** `_look-roster.js`'s own `assertMotionKeys` on the OTHER side of this seam checks the
 *  transcribed copy against `MOTION_FEELING`'s live keys; this is the reverse direction — a
 *  caller here that has read a fresh copy of that file's `motionFeelingKeys` export can check
 *  it against THIS repo's own canonical table, so a drift is caught wherever it is looked for
 *  first. Neither file imports the other (cross-repo, no path) — this is the check, not a cure. */
export function assertMotionKeys(transcribed:string[]):true {
  const live = Object.keys(MOTION_FEELING).slice().sort().join(',');
  const got = (transcribed || []).slice().sort().join(',');
  if (live !== got)
    throw new Error(
      `look-verdict: the motion vocabulary has drifted. This repo's MOTION_FEELING declares ` +
      `[${Object.keys(MOTION_FEELING).join(', ')}]; the transcribed list was ` +
      `[${(transcribed || []).join(', ')}]. Update BOTH sides and re-run the labeled set — ` +
      `never only one of the two.`);
  return true;
}

/* ── the report ──────────────────────────────────────────────────────────────────────────── */

export type FindingKind =
  | 'motion-axis-mismatch'      // has_motion vs the coordinate's `motion` value
  | 'motion-feeling-barred'     // motion_feeling always surfaces this, never as actionable
  | 'bind-bracket-suspect'      // flicker.perSec / motion.max vs a declared modulation
  | 'look-changed'              // the A/B leg, when a second receipt is given
  | 'something-wrong-reported'; // the seam's own something_wrong Noul, verbatim

export interface Finding {
  kind:FindingKind;
  /** the probability the finding rests on — never omitted, per the pipeline's own rule that a
   *  reader must meet the measurement before the phrasing. */
  p:number|null;
  /** true when this finding is barred from being read as actionable (currently: every
   *  motion-feeling finding, unconditionally — see the module header). A barred finding is
   *  still reported; `judgeAgainstCoordinate` never omits it, it only refuses to let it drive
   *  anything. */
  barred:boolean;
  reason:string;
  detail:string;
}

export interface LookVerdictReport {
  stack:StackId|null;
  recordId:string|null;
  tag:string|null;
  findings:Finding[];
  /** the two receipts compared, when this report came from `judgeAgainstCoordinate(a, coord, b)`. */
  compared:{a:string; b:string}|null;
}

/** Compare a look-verdict record against the axis coordinate the composer sampled it for.
 *  Returns a REPORT — findings, each carrying its own `p` and `barred` state. Never mutates,
 *  never resamples, never touches a `CompositionDraft`, a lock, or a bracket. `docs/COMPOSER.md`
 *  §10 item 4: "Deterministic edits never reach the model at all" — and neither does this.
 *
 *  `stack` names which stack's coordinate `coordinate` is, for the finding text only; it is not
 *  otherwise interpreted. `modulationHint`, when given, is the declared operating window for a
 *  MotionState this stack's modulation carries (`docs/COMPOSER.md` §9's "curated bracket" —
 *  `PendingDecision`'s own shape, not re-derived here), used only for the bind-bracket check.
 *  A second receipt (`vs`) adds the A/B leg (`look_changed`), read from `vs`'s own `answers`. */
export function judgeAgainstCoordinate(
  receipt:LookVerdictRecord,
  coordinate:Partial<Record<StackId,AxisCoordinate>>,
  opts:{stack?:StackId; recordId?:string; tag?:string;
        modulationHint?:{waveformMax?:number}; vs?:LookVerdictRecord} = {}
):LookVerdictReport {
  const findings:Finding[] = [];
  const stack = opts.stack ?? null;
  const coord = stack ? (coordinate[stack] ?? {}) : undefined;

  /* ── motion axis vs has_motion / motion_feeling ── */
  const wantMotion = coord?.motion;
  const ha = receipt.answers.has_motion;
  if (ha && ha.answered && wantMotion && wantMotion !== 'any') {
    const measuredMoving = ha.value !== null && ha.value >= 0.5;
    const wantsMoving = wantMotion !== 'still';
    if (measuredMoving !== wantsMoving) {
      findings.push({
        kind:'motion-axis-mismatch', p:ha.value, barred:false,
        reason:`coordinate says motion="${wantMotion}" (wants ${wantsMoving ? 'movement' : 'stillness'}), ` +
               `the measured flow reads has_motion=${ha.value} (${measuredMoving ? 'moving' : 'still'})`,
        detail:'a description and a picture that disagree — report only, never an auto-resample ' +
               '(video-pipeline-v1.md §6 item 1)',
      });
    }
  }

  // motion_feeling is ALWAYS surfaced when answered, and ALWAYS barred — see the module header
  // and video-pipeline-v1.md §5's falsification. There is no threshold at which this becomes
  // actionable in this module; that changes only if the calibration run finds a cut, which is
  // a change to THIS file's rule, never to a caller's judgment.
  const mf = receipt.answers.motion_feeling;
  if (mf && mf.answered) {
    findings.push({
      kind:'motion-feeling-barred', p:mf.p, barred:true,
      reason:`the seam answered "${mf.word}" but is measured SENSITIVE and NOT CALIBRATED — the ` +
             'same word won on a genuinely moving record (p 0.3355) and on a dead-black, fully ' +
             'frozen flow (p 0.2443), near-uniform over its seven options both times',
      detail:'video-pipeline-v1.md §5\'s falsification; no consumer may read this as the composer\'s ' +
             'motion coordinate until a cut is measured, or the calibration finds there is none',
    });
  }

  /* ── bind-bracket check: flicker.perSec + motion.max vs the declared operating window ── */
  const mo = receipt.metrics.motion, fl = receipt.metrics.flicker;
  if (opts.modulationHint && typeof opts.modulationHint.waveformMax === 'number' && mo) {
    if (mo.max > opts.modulationHint.waveformMax) {
      findings.push({
        kind:'bind-bracket-suspect', p:null, barred:false,
        reason:`measured motion.max=${mo.max} exceeds the declared bracket max ` +
               `${opts.modulationHint.waveformMax} — the sampled bracket may have left the ` +
               'operating window the modulation declared',
        detail:`flicker.perSec=${fl ? fl.perSec : null}, motion.mean=${mo.mean}`,
      });
    }
  }

  /* ── something_wrong, verbatim ── */
  const sw = receipt.answers.something_wrong;
  if (sw && sw.answered) {
    findings.push({
      kind:'something-wrong-reported', p:sw.value, barred:false,
      reason:sw.flagged
        ? `the seam flagged something_wrong (p ${sw.value})`
        : `the seam did not flag something_wrong (p ${sw.value})`,
      detail:'advisory only — this Noul is also measured un-calibrated (video-pipeline-v1.md §5); ' +
             'the mechanical black-frame/hang/console/fps verdicts are what refuse a commit, not this',
    });
  }

  /* ── the A/B leg ── */
  if (opts.vs) {
    const lc = receipt.answers.look_changed ?? opts.vs.answers.look_changed;
    if (lc && lc.answered) {
      findings.push({
        kind:'look-changed', p:lc.value, barred:false,
        reason:lc.value !== null && lc.value >= 0.5
          ? `look_changed reads YES (p ${lc.value}) — the two receipts read as different pictures`
          : `look_changed reads NO (p ${lc.value}) — the two receipts read as the same picture`,
        detail:'VISIBLE-CONTROL-VISIBLE-EFFECT asked rather than asserted (video-pipeline-v1.md §6 item 3)',
      });
    }
  }

  return {
    stack, recordId:opts.recordId ?? null, tag:opts.tag ?? null, findings,
    compared:opts.vs ? {a:receipt.provenance.receipt, b:opts.vs.provenance.receipt} : null,
  };
}

# 02 — Composition engine

## 2.1 Meaning of “Jev composes”

For each new generated unit, ordinary code enumerates legal concrete alternatives. One live Choice response selects a unit (or supplies the distribution from which the app explicitly samples). At bar-aligned cursors the unit is a **complete bar** for one lane — each option is a full bar rendering sampled from the lane's groove parameter point (see 2.5). At mid-bar cursors (partial regeneration, protected boundaries) the unit is a single atomic event instead. The selection is rendered into notes, advances one lane's cursor, and becomes part of the next request. Jev does not emit arbitrary MIDI files, prose scores, or code.

A bar option is a sequence of note/rest/hold segments with tick durations. An atomic pitched event is a note plus its duration; a rest is also an event; a hold extends the immediately sustained prior sound. A harmony event may select a specified chord voicing; a percussion event may select a specified simultaneous hit group. Multiple sounding notes from one decision share one source decision — this is honest grouping, not a hidden prerecorded phrase.

`number of fresh decisions` is the primary sequential-request count — one per lane-bar at bar-aligned cursors — not necessarily the number of MIDI note-on messages. Planning/groove/harmony calls and retries are additional. User-requested duplicate, transpose, and instrument changes are ordinary editor operations and are separately labeled.

## 2.2 Canonical musical time

Use integer **score ticks**, with `ppq = 480` ticks per quarter note. This is an application choice. Tempo is quarter-notes per minute, including in 6/8; label the unit in advanced settings. One fixed BPM and meter per revision in P0.

`barTicks = numerator * 480 * 4 / denominator` gives 1920 for 4/4 and 1440 for both 3/4 and 6/8. Store zero-based absolute ticks and zero-based bar indices internally; display bars starting at 1. All regions are half-open `[startTick, endTick)`.

Straight-grid event spans: `[120, 160, 240, 320, 480, 720, 960, 1920]`. This covers straight and selected triplet/dotted values without floating-point beat arithmetic. Filter by the remaining legal interval. For a manually edited boundary leaving a smaller/different gap, add that exact positive remainder as a ninth duration, replacing 1920 if necessary to keep at most eight; label the boundary-sized option honestly. Never insert a zero-duration event or quantize a protected note secretly.

In shuffle/swing mode use `[120, 240, 480, 720, 960, 1920]` before boundary adjustment. Do not apply both triplet timing and swing to the same rhythmic grid. 6/8 defaults to straight timing; the compound grouping is described to the model. P0 restricts swing to 4/4 and 3/4.

New pitched note gate equals its selected span by default. A hold adds to that gate without retriggering. Explicit user staccato edits can shorten gates afterward while leaving onset spacing intact. Later expressive passes may vary these independently. Do not describe velocity or articulation as model-generated when it was chosen by a deterministic renderer.

## 2.3 Plan construction from arbitrary wording

Keep the raw prompt throughout the run. Validate length (maximum 4,000 Unicode code points in P0); render as text, never HTML. Recognize unambiguous numeric forms such as `80 BPM`, explicit bar counts, and named UI parameters with deterministic parsing. Record the parser rule and explicit spans; do not infer broad semantics with an ever-growing keyword-only genre switch.

Use focused Jev questions to choose a plan from application-defined alternatives. Suggested first pass, independent against the same prompt:

| Field | Concrete alternatives or operation |
|---|---|
| meter | 4/4, 3/4, 6/8 |
| tempo | integer 40–220 BPM (181 choices), overridden by an explicit valid number |
| tonic | 12 pitch classes |
| harmonic vocabulary | major, minor, blues/dominant, modal, chromatic/ambiguous |
| feel | straight, light swing, shuffle (normalize incompatible meter explicitly) |
| form | theme/contrast/return, AABA, blues chorus, buildup/drop, sparse evolving |
| density | sparse, medium, busy |
| energy arc | steady, rising, rise/fall, restrained/return |
| length | 4, 8, 12, 16, 24, 32, 48, 64 bars; explicit valid count wins |
| lane presence | nonempty subset of lead, bass, harmony, drums |

Choose concrete instruments in a second pass conditioned on accepted lane presence and plan; do not ask dependent choices to see unseen same-call answers. Two pitched lanes may use the same instrument, e.g. piano melody and piano chords. No fictional natural-language title generation is needed: use a trimmed prompt as the initial name, editable by the user.

Override precedence: explicit UI values/locks → exact user parameters → resolved semantic request → planner choices → defaults. Persist conflicts and the chosen normalization in a short plan warning. For unsupported meters/tempo bounds, ask or offer a supported adaptation; do not claim exact fulfillment. A vague prompt takes defaults without a questionnaire.

Structural sections are compiled by ordinary code from the chosen form. For 16 bars, theme/contrast/return can be 4+4+4+4 with roles intro/theme/contrast/return, except use a brief intro only if the chosen lane plan allows enough time for a theme. A blues form defaults to two 12-bar choruses when length is unspecified. An explicit 16 bars with blues vocabulary is a 16-bar arrangement, not a falsely labeled strict 12-bar form. Section boundaries and roles are metadata, not stored melodies.

The selected plan is user-visible and reversible. It is not claimed to be optimal. Store the original text as well as the structured plan; semantic details not captured by fields remain available in subsequent event instructions.

## 2.4 Harmonic plan

Before note events, Jev selects one labeled chord-progression template per section, conditioned on the original prompt and the section role. Templates come from per-vocabulary tables (major, minor, blues/dominant, modal, chromatic/ambiguous — 7–11 named progressions each, plus `no_chord`) and materialize deterministically into bar-length harmony slots with concrete roots and qualities, the degree pattern tiled across the section's bars. The template is an explicit, auditable plan choice; it supplies harmony only, not finished melody or rhythm. Prior sections' progressions are shown so later choices can contrast or return deliberately.

Manual chord edits and locked pitched material are hard context. When only a melody/bass/drum region is regenerated, harmony is retained. Reharmonization is a separate, explicit operation and outside the first natural-language edit set. Do not unexpectedly change accompaniment because an unrelated request mentions mood.

## 2.5 Phrase memory and intentions

At each section/phrase boundary, an optional single Choice chooses a phrase intent: introduce, repeat-recognizably, vary-ending, contrast, build, resolve, or return. Supply actual earlier motif notes rather than only “motif A”. First completed lead phrase (normally 2 or 4 bars) becomes a reference motif; a later section can cite it.

Every new bar is still selected live. A “return” instruction conditions decisions on the original motif, rather than copying a finished loop silently. Exact repetition is allowed if deliberately selected and recorded; an explicit user Duplicate command uses code. Do not optimize away model calls with repeated-bar memoization in the baseline implementation.

**Groove parameters.** Once per section, one Choice carries a sub-question per lane per axis, and Jev sets universal rhythmic parameters — kick/snare/hat/accent layers for drums, rhythm × pitch logic for bass, attack × voicing density for harmony, density × syncopation for lead. There are no named genres in the system: styles are coordinates in this parameter space, and code samples concrete bar renderings from the chosen point. `any` leaves an axis unconstrained.

## 2.6 Decision scheduling across lanes

Use one decision loop per job, not one concurrent loop per track. Each active lane has a cursor. Choose the lane with the smallest cursor; ties use stable role order **drums → harmony → bass → lead**. This allows an accompaniment decision at the same onset to be visible to the later lead decision. It is an implementation choice, not an assertion of globally optimal musical coordination.

A lane can start later or be inactive in a section due to the accepted arrangement plan. Structural silence advances that lane deterministically to the next active interval and is recorded as `arrangement_silence`, not a provider-selected rest. Otherwise ask for every bar/event decision. Stop at the selected scope endpoint.

For each decision:

1. Check cancellation, request ceiling, provider cooldown, and base revision compatibility.
2. Find the next editable, active interval; skip protected content without modifying it.
3. Determine the next hard boundary: earliest bar end, harmony-slot end for harmony voicings, scope end, or protected note/region start.
4. Enumerate candidates for that lane; ensure 2–255 options and positive legal spans. At bar-aligned cursors each option is a complete bar sampled from the lane's groove parameter point; mid-bar cursors get atomic note/rest/hold events instead. A singleton genuinely forced case is represented as an explicit deterministic forced transition with a reason, or evaluated if the provider accepts it after verification; do not invent a second musically invalid choice.
5. Build full structured state including the original prompt, applicable edits, plan, a bounded rolling context (the last ~4 bars of notes plus the theme motif and compact completed-section summaries — never the entire score), cursors, next boundary, and concrete candidates.
6. Persist the exact pending payload, its hash, candidate map/version, job epoch, decision index, and attempt reservation before the network call.
7. Call Jev; validate the response; select an option using the recorded selection policy.
8. In one durable transaction, record the receipt, apply the selected bar or event, advance the cursor, update PRNG state, and append a job event. Then notify the browser.
9. Recompute the minimum cursor/frontier and expose only complete-bar preview snapshots.

Pseudocode:

```ts
while (!allScopesComplete(job)) {
  await guardCanContinue(job);
  const turn = nextEditableLane(job);
  const candidates = enumerateConcreteCandidates(turn, job.draft); // bars or atomic events
  const pending = await persistPending(buildRequest(job, turn, candidates));
  const receipt = await provider.evaluate(pending.payload, pending.abortSignal);
  const selected = validateAndSelect(receipt, pending, job.samplerState);
  await commitOnce(job.id, pending.decisionId, selected); // notes + cursor + receipt
}
```

## 2.7 Atomic candidate construction (mid-bar cursors)

The atomic event machinery in this section and the next applies at mid-bar cursors — partial regenerations and protected-note boundaries where a complete bar cannot be committed. At bar-aligned cursors the candidates are complete bars sampled from the lane's groove parameters instead (see 2.5/2.6).

Lead/bass: enumerate a chromatic window of at most 24 contiguous MIDI pitches within the instrument lane's supported range. Center near the previous pitch, with the plan register as the initial anchor. For a range of at least 24 pitches: `start = clamp(anchor - 12, low, high - 23)` and include `start..start+23`. For narrower ranges include all pitches. Allow chromatic choices; scale membership is descriptive context unless the user explicitly imposed a strict scale.

For each pitch and permitted span, create `{kind:'note', pitches:[midi], stepTicks, gateTicks:stepTicks}`. Add rest options for every span. Add hold options only when the previous sounding event ends exactly at the cursor, is fully editable, and is not percussion. The hold points to existing note IDs, not merely the same pitch.

At eight spans and 24 pitches, the maximum is `24*8 + 8 rests + 8 holds = 208`, below 255. Boundary adjustment must not increase the duration list beyond eight. Candidate IDs are stable and describe the full event: `N_69_240`, `R_240`, `H_240`; harmony chords use sorted MIDI tuples. The model sees readable names and string descriptions with pitch names, MIDI numbers, interval/context tags, and tick lengths. Never rely on the question ID conveying meaning.

All alternatives are complete events. Pitch and duration are not separate independently sampled questions; that could combine choices the model never evaluated jointly.

## 2.8 Harmony and percussion events

Harmony uses the same event machinery but note candidates contain a concrete voicing (up to four MIDI pitches) of the accepted current chord. Enumerate inversions and octave placements within the lane range, deduplicate, and cap at 24. Sort by deterministic proximity to the prior voicing, then lexicographically; this only chooses the candidate vocabulary, not the selected next chord event. Include rests and eligible holds. Log the vocabulary version.

Percussion P0 uses explicit masks over MIDI drum pitches. Candidate masks: `[36]`, `[38]`, `[42]`, `[46]`, `[39]`, `[49]`, `[36,42]`, `[38,42]`, `[36,46]`, `[38,46]`, `[36,38]`, `[36,38,42]`, `[36,49]`, `[38,49]`, `[36,38,49]`. Do not include open and closed hi-hat simultaneously. Cross masks with legal spans from `[120,160,240,480,960]` in straight mode, omitting 160 in swing mode; add exact boundary remainder if needed while keeping at most eight durations. Add rest choices. No holds. Every group is one visible decision; its notes share provenance. A minimum 60-tick percussion gate can be clipped to span; the synthesizer has its own fixed drum envelope.

These are application vocabulary decisions. General MIDI export has conventional program/kit mappings; browser timbres are not guaranteed to match an external GM synthesizer [S09, S10].

## 2.9 Full context and growth

Baseline state sends the raw prompt and **all accepted notes in the current draft/retained base** as compact tuples, with lane/instrument context and explicit note IDs. During region edits, retained future notes are allowed context and labeled future/immutable. Notes selected earlier in this job are labeled generated. Do not replace notes with prose summaries silently.

Use compact tuples `[id, laneId, startTick, gateTicks, midi, velocity]`, not duplicate fully expanded note JSON in multiple fields. Include only relevant bounded edit history but retain every still-applicable instruction and reference. Preserve metadata required to interpret pitch/rhythm/sections.

Provider context/token capacity is not assumed from the docs checked. The request context is bounded by design — a rolling window (about the last 4 bars of notes, plus the theme motif and compact completed-section summaries), never the entire score — because unbounded score replay grows requests linearly until the provider rejects them (`max_tokens_exceeded`). Additionally, a configurable application payload-byte ceiling, initially 2 MiB — **not a provider limit** — counts actual UTF-8 bytes. If a request still cannot fit or the provider rejects size, checkpoint and surface the failure honestly; stale oversized pending payloads are rebuilt from current state rather than replayed. The rolling context never drops the original prompt, selected region, locks, motif, or current boundary.

## 2.10 Selection, variety, and reproducibility

Provider Choice reports a selected option and option distribution [S02]. Offer advanced modes:

- **Model choice:** commit the provider's valid selected option.
- **Varied:** seeded, app-side sampling from a validated distribution, with a documented temperature transform. Default variation temperature 0.8. This is an application sampling control, not an undocumented Jev request parameter.

For positive p, use weights proportional to `exp(log(p)/T - maxLogWeight)`. Zero probabilities remain zero. `T=0` selects deterministically using maximum probability and stable lexical tie-break. Reject empty, nonfinite, negative, mismatched-key, or grossly nonnormal distributions. Allow sum error ≤1e-3 and renormalize that rounding error only. Record the provider choice AND the app-selected choice when they differ. Confidence is a distribution statistic, not a music rating [S05].

Use the explicit PRNG algorithm in the reference kernel and persist its state atomically with each accepted decision. Same stored responses + same initial PRNG state replay exactly. **Same prompt/seed alone does not guarantee the same live model responses**, especially with the mutable alias `jev-latest`.

## 2.11 Important limits and failure behavior

Code guarantees bounded candidates, correct ticks, no protected edits, finite jobs, and parseable exports. It cannot guarantee memorable melodies, faithful style, good rhythm, or a musical ending. A score consisting entirely of rests is valid structurally but fails the listening gate; show it honestly and offer another variation, not a hidden baseline replacement.

Rest/hold/note spans always advance time. A job is finite under its scope and span bounds; additionally enforce an operator-configurable generous request ceiling (default 12,000 attempts/job). This prevents runaway/retry bugs, not ordinary accepted use. A ceiling hit pauses and can be extended explicitly; it must not fill the remaining score with prerecorded music.

No real-time playback depends on waiting for a decision. No dependency on another LLM is permitted in P0. The model is not asked to hear audio unless a separately verified future capability explicitly supports that input.

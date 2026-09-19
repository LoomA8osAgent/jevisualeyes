# 08 — Sources, assumptions, and architectural decisions

## 8.1 Evidence boundary

Documentation checked on **17 September 2026**. The links below support provider/library behavior, not Jev's musical competence. Product defaults, event palettes, scheduler order, storage architecture, UI, sampling, job limits, and acceptance tests in this specification are **design decisions**. No live API calls were made when preparing this package. Synthetic examples must remain labeled.

No exact account price, context window, throughput quota, deterministic-seed guarantee, or musical quality claim was established. Recheck these against official documentation/account access during implementation. Do not scrape pricing from unrelated providers or rely on earlier conversational guesses.

## 8.2 Primary-source references

| ID | Source and URL | Used for |
|---|---|---|
| S01 | TypeSafe HTTP API — https://docs.typesafe.ai/api | Endpoint, authentication, top-level fields, response/error shape |
| S02 | TypeSafe Choice — https://docs.typesafe.ai/primitives/choice | Choice alternatives, returned distribution, 255-option bound, question independence |
| S03 | TypeSafe State — https://docs.typesafe.ai/concepts/state | Text/object/array state and shared-state independent questions |
| S04 | TypeSafe JavaScript SDK — https://docs.typesafe.ai/sdk/javascript | Actual SDK package and method naming |
| S05 | TypeSafe Confidence — https://docs.typesafe.ai/confidence | Confidence derives from probabilities, not musical-quality assessment |
| S06 | Tone.js — https://tonejs.github.io/ and https://tonejs.github.io/docs/15.1.22/index.html | Browser audio instruments, effects, scheduling; versioned docs are an inspected reference, not a latest-version claim |
| S07 | MDN Web Audio best practices — https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices | User-gesture audio activation and browser considerations |
| S08 | MDN Server-sent events — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events | Event stream/reconnection concepts |
| S09 | Tonejs/Midi repository — https://github.com/Tonejs/Midi | MIDI read/write capabilities; validate actual locked dependency |
| S10 | MIDI Association General MIDI — https://midi.org/general-midi | Standardized instrument playback context; browser sounds need not match external rendering |
| S11 | Tonejs/Midi Header source — https://github.com/Tonejs/Midi/blob/master/src/Header.ts | Observed 480 PPQ default and getter; recheck against locked release |
| S12 | Tonejs/Midi Encode source — https://github.com/Tonejs/Midi/blob/master/src/Encode.ts | Observed format-1 encoding and event handling; same-tick tests still required |
| S13 | TypeSafe introduction — https://docs.typesafe.ai/introduction | Typed-decision interface rather than free-text composition output |
| S14 | TypeSafe retries — https://docs.typesafe.ai/sdk/python/api/retries | SDK retry concepts; our raw-HTTP retry defaults are application-defined |

Do not copy vendor documentation wholesale into the repository. Link to it, keep the narrow adapter contract, and add live integration tests. This document does not bundle vendor code, models, samples, or fonts.

## 8.3 Decisions already made for the build agent

**ADR-001: Live event composition.** The owner explicitly accepts many calls. No precompilation; optimize fidelity to the requested interaction before caching.

**ADR-002: No hidden second composer.** Jev chooses concrete events; code provides vocabulary, validates, and renders. A baseline exists only for comparison.

**ADR-003: Prompt-first progressive disclosure.** Musical controls are available after a one-prompt start. No mandatory theory setup.

**ADR-004: Finite jobs, not hard-real-time inference.** Browser playback consumes completed score snapshots. Network calls do not set note timing.

**ADR-005: Full symbolic context initially.** Send the score in compact tuples. Stop on a real context issue; do not silently replace it with a tiny feature summary.

**ADR-006: Structured candidates, string criteria.** Keep concrete candidate objects in the app and describe them with verified simple Choice strings. This avoids a documentation schema ambiguity.

**ADR-007: App-side variety is explicit.** Preserve provider choice and app-sampled choice separately. Exact replay uses saved distributions/responses, not an imagined provider seed.

**ADR-008: Single persistent runner.** SQLite + one local job runner provides controllable calls and recovery. No cluster or serverless-per-note design.

**ADR-009: Immutable revisions and hard locks.** AI drafts cannot overwrite unrelated or protected music. Undo never invokes the model.

**ADR-010: Original score ticks, one swing materialization.** UI, playback, and export share one musical timeline. Avoid double swing and duration-vs-endpoint bugs.

**ADR-011: Synthesized sound bank first.** No diffusion or external sample-rights dependency. Clearly distinguish synthetic timbres from acoustic realism.

**ADR-012: Evidence before quality claims.** Passing schemas/tests proves engineering properties only. Listening and live tests establish separate, limited claims.

## 8.4 Questions that remain empirical, not blockers to implementation

Does Jev choose useful symbolic notes? Which option vocabulary balances expressive freedom with coherent phrasing? How much does full-score context help? Does a phrase-intent call improve motif development? Do app-side sampled choices sound better than provider argmax? What are actual account limits and musical generation times? Are the sound patches good enough to evaluate composition fairly?

Build instrumentation and controlled tests for those questions. Do not ask the owner to decide them theoretically. Record failures as well as successes and keep the app functional under an honestly labeled experimental model capability.

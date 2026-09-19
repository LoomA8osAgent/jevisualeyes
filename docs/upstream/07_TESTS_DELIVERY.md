# 07 — Implementation milestones, tests, and delivery

## 7.1 Milestone order

### M0 — Runnable shell and contracts

Create the application workspace, lint/type/test commands, SQLite migrations, provider settings, project schema import/export, and the minimal initial page. Port/integrate reference primitives and tests. Create explicit live and fixture provider modes. No live request runs during installation or normal tests.

Exit: application starts locally, loads a visibly hand-authored fixture, and has no secret in browser assets/logs. It can export/reimport the project. A disconnected initial screen explains setup without a broken Compose button.

### M1 — Actual monophonic composition

Build the raw HTTP provider adapter, concrete candidate generation, prompt/score context, and a sequential short lead-only job over an explicit harmonic plan. Persist every accepted choice/cursor. Display real progress and listen to completed bars. Add the opt-in one-call live smoke test before a multi-event run.

Exit: a live note/rest/hold response affects the actual score; the next request includes that accepted result; no hidden generator produces the melody. Tests can inspect exact request bodies and count decisions.

### M2 — Reliable jobs and playback

Finish pause/cancel/retry, pending payload persistence, SSE replay, restart recovery, safe preview snapshots, audio clock scheduling, stop/seek/loop cleanup, and export. These are necessary before long four-lane runs.

Exit: restart/reconnect does not duplicate notes or silently restart billing; playback is rhythmically unchanged when the network is slow. Stop prevents new requests and late mutations. MIDI schedule matches the browser schedule.

### M3 — Prompt-to-arrangement

Add real plan questions, lane/instrument selection, harmony slots, section/phrase intent, motif context, and multitrack event scheduling. Add a curated instrument bank and prompt-first defaults. Use the bounded rolling context (recent bars + motif + completed-section summaries) by default. Test blues, lo-fi, and electronic prompts without mapping all of them to one tune.

Exit: short vague input works without a questionnaire; the result has the requested supported length and multiple intended sections. Music quality remains a measured test gate, not inferred from valid JSON.

### M4 — Powerful editing without a complicated front page

Add a functioning piano roll, track/region selection, locks, natural-language supported edits, deterministic editing commands, preview revisions, Keep/Discard, undo/redo, and project saving.

Exit: “keep melody, change bass” preserves exact lead note fields; a local note edit influences the following model request; a rejected draft does not alter the original. All visible controls are implemented, not decorative.

### M5 — Quality, security, and packaging

Run the complete test matrix, listening evaluation, browser checks, and export interoperability checks. Document supported instruments/styles, actual observed limits, remaining weaknesses, and deployment security. Build screenshot coverage and a reproducible demo without claiming synthetic examples are live.

Exit: all P0 acceptance gates pass or each failure is explicitly reported. Do not claim the app is complete merely because the UI compiles. Optional P1 features do not compensate for missing P0 behavior.

## 7.2 Kernel/unit tests

Required unit cases include: exact bar lengths and half-open regions; 208-option maximum pitched palette; all options within boundaries; boundary-sized spans; chromatic choices; rest and hold behavior; no zero duration; valid/invalid distributions; stable app-side sampling; exact replay from stored responses; canonical request hashes; cancellation epoch rejection; locking; swing applied to starts and ends exactly once; correct integer export timing; explicit MIDI channels/programs; note-off ordering; project schema/semantic validation; unsafe keys and nonfinite numbers.

The supplied suite covers a subset as an executable starting point. Extend it to the planner, job runner, piano roll, actual library integration, and every fixed bug. Fixture-only success must not be presented as proof of Jev's musical ability.

## 7.3 Provider and integration tests

Use a local fake provider whose responses deliberately vary by score prefix. Prove that request N+1 contains event N and that the scheduler never asks dependent future notes in the same call. Test complete candidate descriptions, exact returned choice use, sampled-vs-model choice logging, and generated-note provenance.

Inject 401, 422, 429 + Retry-After, 529, invalid JSON, missing answer, unknown chosen option, NaN/negative/mismatched probabilities, timeout, late success after cancellation, and a dropped connection after the provider performed work. Verify bounded retries, secret redaction, usage uncertainty, and no hidden prerecorded fallback.

Crashes: before request, after attempt reservation, after provider response but before local commit, after local commit but before SSE, during pause, and during Keep. Check saved results, PRNG position, duplicate handling, and no automatic paid restart. A local unique key can prevent duplicate score commits but cannot prove one provider bill.

Base revision conflicts: a manual edit/new accepted revision must prevent an old draft from overwriting it. Imported fake live provenance remains unverified. Browser calls cannot supply arbitrary provider endpoints or bypass server candidate/lock validation.

## 7.4 Browser and UX acceptance tests

Use Playwright or an equivalent browser test runner; never use screenshots as the only correctness check.

- Empty screen: exactly one clear primary Compose path; key missing vs configured states; example chips only populate text.
- Vague prompt: “a blues music” starts a job using defaults. No theory form blocks it.
- Generation: actual stage/bar progress; expanding activity; pause/resume; safe completed-bar preview; no autoplay on completion.
- Ready: play, stop, seek, loop; no duplicate/stuck notes after 20 start/stop cycles; instrument change affects sound, not score.
- Lock + regenerate: preserve Lead exactly while Bass changes; unselected bars unchanged; crossing protected notes untouched.
- Revision: Keep/Discard and Undo/Redo reproduce saved music without new API calls.
- Piano roll: add/move/resize/delete plus numeric/keyboard alternatives; manually modified notes appear in subsequent request state.
- Export: JSON save/reload preserves required musical fields; exported MIDI opens in an independent parser/player and retains tempo, track separation, percussion mapping, and swing.
- Failure: reconnect tab to same job; server restart shows interrupted rather than restarting; invalid import has a useful message.
- Responsive: inspect 1440×900, 1024×768, 390×844, and 320px width; no page-level overflow; critical controls remain reachable.
- Accessibility: labels, focus, contrast, reduced motion, meaningful progress announcements, no keyboard interception in text fields.

Measure local UI responsiveness, scroll performance, and job progress separately from provider latency. Set a target of sub-100ms feedback for mechanical editing on a representative 16-bar fixture, then record the actual hardware/browser/result. Do not present a target as a measured guarantee.

## 7.5 Musical evaluation (mandatory, not a promised win)

First compare 4-bar lead phrases over identical accompaniment. Then compare 12–24-bar full arrangements. Use the same candidate vocabulary, sound bank, master gain, and prompt set when comparing Jev with handwritten/random baselines. A baseline is a test harness only, not a silent production substitute. Save provider model string, prompt/candidate versions, request counts, tokens, and rendered score for every run.

Suggested prompts: slow blues; sparse minor piano; warm lo-fi; driving electronic build/drop; relaxed 3/4; restrained 6/8; a tune that returns to its opening motif. Include edits: less busy drums, keep melody/change bass, replace instrument, regenerate middle, and return to theme.

Listeners rate phrase coherence, rhythmic intention, motif continuity, request fit, and usefulness of the revision. Prefer blinded pairwise comparison and save all outcomes, including ties and failures. At least three independently generated examples per supported starter style are needed before a release claim. Do not cherry-pick one attractive seed while discarding many broken scores from the report.

A release requires human listening signoff that the composer is useful enough for the intended experiment, plus no structural/lock/export/security failures. Do not invent a quantitative “better than baseline” threshold or claim unless the study actually measures it. If Jev performs poorly, report that and investigate candidate coverage, instructions, context, phrase hierarchy, or timbre—without changing the core architecture secretly.

## 7.6 Definition of done

All of the following are necessary:

1. A working local web app, not a design mockup or static sample player.
2. A real Jev integration behind server-side credentials, with traceable event decisions.
3. Prompt-first planning, finite multitrack composition, and playable complete results.
4. Piano-roll editing, supported conversational edits, locks, non-destructive versions, and undo/redo.
5. Correct browser audio scheduling and interoperable MIDI/project exports.
6. Persistent progress, bounded retries, pause/cancel/resume, and crash/reconnect handling.
7. Security gates for public exposure, validated imports, secret redaction, and no surprise live test spending.
8. Passing automated tests plus separately reported live and human listening validation.
9. Complete setup/deployment/user docs, screenshots, pinned dependencies, known limitations, and honest fixture labels.

When a live key is unavailable, items requiring it remain **not run**, not passed. Finish all implementable pieces and deliver that boundary explicitly. Do not use missing access as a reason to skip local application testing.

## 7.7 Required implementation deliverables

Provide source and a lockfile; `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run test:e2e`, `npm run test:live`; `.env.example`; migration instructions; local/hosted deployment guide; user quickstart; data/export documentation; verified dependency/license inventory; screenshots for initial/generating/ready/editor/error/mobile; automated test reports; sanitized live smoke/phrase receipts; listening notes; and `KNOWN_LIMITATIONS.md`.

Explain how to rotate a key, stop an active job, recover a project, export without a live connection, remove stored data, and disable public exposure. Do not imply this handoff itself has built or validated those application features.

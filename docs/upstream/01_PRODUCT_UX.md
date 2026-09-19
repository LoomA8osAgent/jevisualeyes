# 01 — Product and user experience

## 1.1 Product thesis

**Describe music → listen to an editable composition → keep shaping the same piece.**

The central experiment is whether a general typed-decision model can make good symbolic musical choices when repeatedly given the original request, an evolving score, and concrete possible next musical units — complete bar renderings at bar-aligned cursors, atomic note/rest/hold events mid-bar. The application should make that experiment useful to someone who does not understand music theory.

The owner explicitly accepts one API request per newly selected event. This is a live composition project, superseding the earlier offline-brain and cellular-automaton ideas. Building an offline policy compiler is out of scope.

Music is represented as MIDI-like note events, not generated audio. Instruments render that score using conventional synthesis. The initial product makes instrumental compositions. Sung vocals, realistic performance cloning, and arbitrary acoustic realism are not promised.

## 1.2 Product principles

- **Prompt first, defaults second.** Infer a reversible plan from a short request. Do not require tempo, key, instrumentation, chord names, or a genre taxonomy.
- **Music first, diagnostics second.** The primary experience is listening and editing, not reading logs or watching token counters.
- **One evolving piece.** An edit modifies a defined part of an existing project. New variations preserve the original until explicitly accepted.
- **Musical requests and mechanical edits are different.** “More surprising melody” invokes Jev. “Set tempo to 80” and instrument swaps are deterministic after intent resolution.
- **No hidden substitutions.** Fixtures are fixtures; hand-authored sounds are playback instruments; rules are constraints; live model selections are recorded as such.
- **Long generation must remain controllable.** Persistent progress, preview, pause, stop, recovery, and partial export are P0, not polish.

## 1.3 P0 scope

P0 includes prompt-based planning; live sequential event composition; 4–64 bars; fixed tempo per revision; meters 4/4, 3/4 and 6/8; one optional lane per role (lead, bass, harmony, drums); conventional browser instruments; region/track regeneration; supported plain-English revisions; track and note locks; a functional piano roll; playback/looping; non-destructive versions; local/personal-server persistence; project JSON and multitrack MIDI export; validated project import; cancel/resume; protected API credentials; and visible fixture/live provenance.

The lead and bass lanes generate monophonically. Harmony and percussion events can contain multiple simultaneous notes. Manually created overlapping pitched notes are allowed for playback/export, but AI regeneration of a lead/bass region returns that lane to monophonic generation inside the selected, unlocked region.

P1: arbitrary MIDI import with normalization, more independent lanes, higher-quality licensed samples, WAV export, velocity/articulation generation passes, note-level conversational constraints, and synchronized two-version audition.

P2: collaboration, marketplace, public free hosting, audio-to-MIDI, live keyboard recording, changing meters/tempo maps within a song, microtonality/MPE, infinite live jamming, user plug-ins, and automatic agent orchestration. Do not let these delay P0.

## 1.4 Initial screen

Working title **Jevthoven**, one calm sentence (“Describe a piece. Make it yours.”), one multiline prompt field, one primary **Compose** button. Three small example chips fill the field without starting a paid job:

- “A slow blues instrumental with piano and bass.”
- “Warm lo-fi keys with a simple melody and room to breathe.”
- “Dirty acid-house instrumental with a clear buildup and a drop.”

There is a quiet Open project action and Settings access. There is no giant dashboard, mandatory signup in local mode, animated waveform unrelated to audio, or technical configuration form in the main view. Optional collapsed controls: length, instrument preferences, variation, and model connection status. Enter submits only with an explicit keyboard shortcut such as Cmd/Ctrl+Enter; ordinary Enter inserts a newline.

If the owner configured a key, the user sees no key step. Without a key, Compose is disabled with a concise setup route; an optional “Open demonstration project” is explicitly labeled **Hand-authored demo — no Jev generation**. Do not silently switch Compose to fixtures.

Default length is 16 bars. The planner may choose 12 or 24 for a blues form when the user did not specify length. Default tempo is 100 BPM only when the plan has no better supported choice. These are editable application defaults, not musical laws or vendor behavior.

## 1.5 Generation screen

Preserve the prompt at the top. Reveal a transport and a compact arrangement as actual events arrive. Use truthful stages: **Choosing a plan**, **Choosing harmony**, **Composing bar 3 of 16**, **Saving composition**. Display the current bar/lane and a completed-bar count. Never use a fabricated percentage or predetermined timer. Planning progress is phase-based; event progress is the actual completed musical extent, not the unknown total count of future API calls.

Show separate controls **Pause generation**, **Stop**, and **Play completed bars**. A play action is a user gesture; generation completion never automatically starts sound. A small expandable activity panel exposes event choices, request counts, reported tokens, missing-usage warnings, and connection errors. Do not display provider confidence as “musical quality”.

The bar-level preview is a snapshot of fully completed bars across all active lanes. It is never the partially changing live score. Incomplete lanes remain visible but shaded. The user can optionally solo a committed lane fragment in the inspector, clearly labeled partial. Network timing never sets musical timing.

Pause finishes or records the current response then stops before the next request. Stop aborts the outstanding attempt where possible and halts new calls. Neither deletes the original revision. See document 04 for authoritative job semantics.

## 1.6 Ready screen

Desktop arrangement:

```text
Jevthoven                     [Project name]       [Open] [Save] [Settings]
[Original prompt / brief ...............................................]
[Play] [Stop] [Loop]   [100 BPM] [Key] [16 bars]      [Undo] [Redo] [Export]
                  Intro       Theme        Contrast       Return
Lead     [M S Lock]  ░░░░  ──notes────────  ───notes───   ──notes────
Bass     [M S Lock]  ───────────notes───────────────────────────────
Harmony  [M S Lock]  ═══════════chord events═══════════════════════
Drums    [M S Lock]  · · · · · · · · · · · · · · · · · · · · · ·
[What would you change? ...................................] [Apply]
[Edit notes] [Versions]                            [More controls]
```

The piano roll appears below only when requested or when a lane/region is selected. The original prompt is editable as a new composition brief, but changing its text alone does not regenerate existing notes. Provide clear actions **New variation** and **Apply edit** rather than a single ambiguous Regenerate button.

Make chord/key/theory labels secondary. A person should be able to listen, lock a part, and say “make the middle less repetitive” without opening the piano roll.

## 1.7 Editing scenarios and exact outcomes

### A. First composition

User writes “a blues music” and presses Compose. The app selects a supported plan, displays its settings as editable chips, and begins actual event decisions. It produces a finite arrangement with a theme and a later reference/variation, not merely a 2-bar loop duplicated to the requested length. Quality is evaluated, not assumed. It may use a 12/24-bar form and synthesized keys; it must not claim a realistic guitar recording.

### B. Keep the melody

User locks Lead, then writes “make the bass more syncopated”. Resolve target Bass, preserve Lead/Harmony/Drums note records byte-for-byte, create a draft Bass revision, and present **Original / Preview** plus **Keep / Discard**. The lock prevents a code path from modifying Lead even if the model asks to.

### C. Simpler mechanical changes

“Slower” resolves to a tempo adjustment, not new notes. Default relative multiplier 0.9; “much slower” 0.8. Expose the selected BPM before/after. “Set it to 80 BPM” is exactly 80 when supported. “Replace the lead with an organ” changes a playback instrument/program only. Neither action changes note pitch, position, duration in score ticks, or melody identity. Intent resolution may require one Jev call; the operation itself needs none.

### D. Edit a selected passage

User selects bars 9–12 and writes “less repetition, then return to the main tune”. The selected region and target lanes become explicit request context. Only unlocked notes wholly inside that region are replaceable. Crossing notes and locked notes are preserved. New events must not spill across the protected boundary. The following original section is available as context but not editable.

### E. Manual + model editing

User drags a note, then regenerates the next phrase. The accepted manual change is in the new base revision and supplied score. It is not regenerated from an obsolete model-only history. Region selection has a keyboard equivalent and numeric bar controls.

### F. Unsupported or conflicting requests

“Add realistic sung vocals” shows **Instrumental MIDI only. Add a lead melody instead?** before spending on an adaptation. A niche style is accepted as descriptive context but not falsely claimed as a supported sound library. A locked target shows **This part is locked** with explicit Unlock/Cancel. “Delete all music but keep every note unchanged” prompts one focused clarification; do not guess away contradictions.

### G. Interruption

Closing/reopening the tab reconnects to the same persisted job. It does not start the composition again. A server restart marks unfinished jobs interrupted and awaits Resume. Network recovery never duplicates a note or opens overlapping generation loops.

## 1.8 Editing controls, minimum behavior

Transport: play/pause, stop/return to start, playhead seeking, loop selected bars, volume, no stuck notes. Lanes: mute, solo, instrument, volume, lock, region selection. Piano roll: add, select, move pitch/start, resize end, delete, multi-select, duplicate selection, quantize selected notes, velocity numeric input, undo/redo. Include numeric editors for pitch/start/length/velocity; no essential action requires dragging.

Selection starts as all unlocked lanes; visible chips show the current scope before Apply. Ambiguous “that” resolves to the explicit selection if present, otherwise requires a target only when an operation would be destructive or materially different. Model decisions never get arbitrary filesystem, network, or JavaScript execution privileges.

## 1.9 Versions and autosave

Autosave the accepted project after every committed command. A composition job works on a draft based on an immutable revision ID. Generation from an empty project is accepted on successful completion; edits to existing music remain drafts until Keep. New variation creates a sibling, not an overwrite. Keep is one undo step, regardless of event count. Discard preserves the accepted score. No compare button may silently mix two versions at once.

A separate draft can be saved without accepting it. Save project includes score, plan, instruments, locks, prompt history, generation settings, and provenance summaries. Full provider traces are optional explicit exports and may contain the user’s musical brief.

## 1.10 Visual and accessibility requirements

Calm neutral workspace, one accent for selections, distinct restrained lane colors, ample space, no overdecorated AI aesthetic. System fonts, clear labels, no tiny controls, dark/light support. Desktop primary target; at 390px show lane cards and locally scrollable timeline, not a squashed desktop. At 320px no page-level horizontal overflow. Project controls remain available without opening a separate app page.

Use semantic buttons, visible focus, ARIA labels, live announcements throttled to stage/bar boundaries, 44px touch targets, and reduced-motion support. Piano-roll visual information also has a note-list/numeric-editor representation. Keyboard shortcuts apply only when the editor has focus and never swallow text entry. Audio is user-initiated [S07].

## 1.11 Explicit nonclaims

Do not promise any genre, acoustically realistic instrumentation, instant full songs, novel scientific capability, or guaranteed aesthetic improvement. Do promise honest state, editable results, no silent model replacement, reversible operations, and an auditable event loop. User-facing descriptions should be concise; reserve these technical qualifications for help/docs where relevant.

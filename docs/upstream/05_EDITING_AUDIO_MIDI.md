# 05 — Editing, playback, and MIDI

## 5.1 One canonical score

Use the same accepted score model for the piano roll, plain-language edits, playback, project persistence, and MIDI export. Notes store integer start ticks, gate duration, MIDI pitch, velocity (1–127), stable ID, lock state, and provenance. Rests are decisions but not MIDI notes; their spacing is expressed by later starts. Holds extend existing note durations and add a decision ID rather than retriggering a same-pitch note.

A visual note resize must modify `durationTicks`, not an unrelated pixel field. A tempo edit changes the seconds-per-tick mapping, not tick positions. The audio engine consumes a frozen materialized schedule from a specific revision; it is never the canonical editor state.

## 5.2 Edit intent and scope

Represent resolved edits as a discriminated union with explicit target and preservation policy. Supported operations: setTempo, setInstrument, setTrackGain, setMute, transpose, setLocks, regenerate, and duplicateRegion. User text is input to intent resolution, not executable code.

Scope priority: explicit selected lanes/bars → explicit named lanes/region in the instruction → safe operation default. A new full variation must be an explicit action, not the default result of every musical adjective. Separate operations that can be applied deterministically from regenerated music. Give each an understandable preview label.

Example: “keep the melody but make the drums busier” resolves to regeneration of Drums only, with all Lead notes immutable. “Keep this melody” in a note-selection context can lock those selected note IDs rather than the whole lane; show the result. On uncertainty about a destructive operation, ask one specific question. Do not create an invented multi-step edit program.

## 5.3 Locks and boundary rules

A track lock protects its note set: no addition, removal, pitch change, timing change, velocity change, or reordering that changes note identity. Mixer changes, instrument choice, and global tempo are permitted because the lock means “keep these notes”, not “freeze their rendered sound”. Explain that distinction in the lock tooltip. Locking an instrument is a separate future capability.

A note lock protects the complete note object except nonmusical view metadata. Region regeneration preserves:

- every note in an unselected lane;
- every locked note or note in a locked lane;
- every note whose onset is outside the selected half-open interval;
- every note intersecting but not wholly contained in the editable interval.

The last rule avoids silently truncating notes that enter/leave the region. Crossing protected notes occupy that lane until their end; candidates cannot overlap them in monophonic generated lanes. Do not split a crossing note automatically. Provide an explicit manual Split command later if needed.

Before accepting a draft, compare immutable notes by stable ID and canonical musical fields and verify no unexpected added notes on a locked/unselected track. This check is server-side and independent of model instructions. Reject a conflict rather than repairing it silently.

## 5.4 Non-destructive revision commands

Commands carry baseRevisionId and unique commandId. Apply each once in a transaction. A stale base returns 409 with the current revision ID. Undo/redo moves through accepted revision history or creates an inverse command; it must not restart API calls. Redo of a generation uses the saved accepted result, not a new inference.

New variation/regeneration writes a draft. Keep validates locks/scope and atomically advances the accepted revision. Discard never changes the accepted revision. Manual editing is disabled on an active draft unless the job is explicitly stopped and converted into an editable branch. No late provider response can overwrite a manually edited score.

Deterministic transpose operates only on selected unlocked pitches and is validated against MIDI 0–127 and declared lane range. Do not clamp individual out-of-range notes into a different melody. Reject the move or explicitly offer an octave-safe alternative. Drums are excluded from pitched transposition.

## 5.5 Piano-roll interaction details

Pitched editor: pitches on Y, score ticks/bars on X. Grid snap defaults to an eighth note, with quarter/eighth/sixteenth/triplet/off choices. Add note by double click/tap-plus button at a snapped location; default duration equals the current snap value. Move/resize commits on release as one undo step. Escape cancels the gesture. Selection boxes and numeric start/end/pitch/velocity fields are required.

Drum editor replaces pitch labels with named kit rows. Multiple hits at one onset are separate note records grouped by source event. Moving a hit to a different drum row changes its MIDI pitch intentionally. A chord can be edited note by note; after manual modification it remains actual score context even if it no longer matches the harmonic label. Mark the chord label “manually altered” or recompute a deterministic descriptive label; do not forcibly correct the notes.

P0 forbids overlapping notes of the same MIDI pitch on the same lane, even in manual editing; different-pitch polyphony is allowed. Reject that conflict or offer an explicit merge, never silently collapse it. This keeps separate note releases unambiguous in the initial MIDI export design.

Quantize affects selected unlocked onsets/durations according to an explicit target grid, then validates positive duration and overlap policy. Off-grid protected notes remain unchanged. Zoom/pan are view state. For keyboard entry and accessibility, an editable note list provides the same operations without dragging.

## 5.6 Local instrument palette

Use conventional synthesis in P0; no generated audio model, external sound subscription, or questionable sample corpus is required. Tone.js provides synthesizers, samplers, effects, and event scheduling [S06]. Start with curated, tested sounds:

| ID | Intended sound | Suggested rendering | Export program (0-based) |
|---|---|---|---:|
| electric_keys | mellow electric keys | polyphonic FM/sine-based keys | 4 |
| soft_keys | soft keyed tone | polyphonic harmonic synth, explicitly synthetic | 0 |
| organ | sustained organ-like tone | additive/harmonic poly synth | 16 |
| pluck | short plucked tone | filtered pluck/poly synth | 24 |
| round_bass | rounded bass | monophonic low-pass synth | 33 |
| synth_bass | electronic bass | monophonic saw/square with filter envelope | 38 |
| soft_lead | rounded melody voice | mono/poly synth | 80 |
| bright_lead | cutting electronic melody voice | filtered saw lead | 81 |
| drum_kit | basic kick/snare/hats/clap/crash | membrane/noise/metal-style synthesis | percussion |

Program numbers are export mappings, not claims that browser synthesis reproduces the named GM sound. Verify mapping constants against the chosen MIDI tooling and an external player. Label acoustic approximations honestly; do not advertise a realistic piano/guitar recording from a basic oscillator.

Version the instrument bank. Ship complete patches with sensible envelopes, voice caps, track gains, and master headroom. No placeholder pure sine tone for every track. Default master attenuation and a limiter prevent obvious clipping, but also test rendered output rather than assuming the limiter makes all mixes pleasant. Mute/solo apply smoothly; release/kill all active voices on stop, seek, revision swap, or audio-context reset. The browser must not leak an ever-growing graph of oscillators/effects.

## 5.7 Scheduling and swing

Initialize/resume audio only from a user action [S07]. Use Tone transport or Web Audio clock scheduling, never `setInterval` as the musical clock. UI animation can use requestAnimationFrame to display the transport position.

Canonical score time is straight. Define one shared tick-warp for swing and apply it exactly once to both note starts AND ends before playback/export. For a quarter-note pair length `P=480`, `q=floor(t/P)`, `u=t-qP`, ratio `r`:

```text
W(t) = qP + 2r*u                      when u <= P/2
W(t) = qP + rP + 2(1-r)*(u-P/2)       otherwise
```

Round the absolute warped tick to the nearest integer. Straight `r=0.5`; light swing `r=0.58`; shuffle `r=2/3`. Clamp UI ratio to [0.5,0.75]. A note's performed duration is `max(1, W(start+duration)-W(start))`, NOT a separate warp of its duration. This preserves notes across pair boundaries. Do not also enable Tone's built-in swing. Changing swing does not rewrite canonical notes.

Convert performed ticks to seconds using `seconds = ticks * 60 / (480 * bpm)` at the fixed P0 tempo. On a tempo change during playback, stop and restart at a preserved logical playhead boundary or rebuild the schedule safely; do not leave already scheduled notes at the old time. Simpler acceptable P0 behavior is pause, apply tempo, resume from the same bar with a clear action.

Looping releases any sustained voices at the boundary and reschedules inside the loop; notes crossing the loop edge are clipped in the playback view only, never destructively trimmed in the project. Seeking cancels prior scheduled events and releases voices before scheduling the new interval. At the end, allow a bounded effect tail but no infinite ringing.

## 5.8 MIDI export

P0 exports Standard MIDI File format 1 at PPQ 480: conductor metadata plus one track for each musical lane. Include fixed tempo at tick 0, meter at tick 0, track names, program changes, note events, and optional section markers. Assign distinct channels to pitched lanes and zero-based channel 9 to percussion. Project velocities 1–127 map explicitly to the writer's expected representation; do not accidentally scale twice.

Use absolute performed ticks from the same swing-materialization function as playback. Sort each track deterministically. At the same tick and channel/pitch, write note-off before note-on so repeated notes retrigger correctly. MIDI does not contain the app's instrument patches/effects; say so in the export menu. Do not export API keys, prompts, or detailed inference traces as MIDI text by default.

`@tonejs/midi` is a supported implementation option [S09]. Its inspected Header source defaults to PPQ 480 and exposes it as a getter; do not blindly assign to a nonexistent writable property [S11]. Its current encoding source builds a format-1 file [S12]. Regardless of library, parse exported bytes independently and test timing/order/programs. If the library fails a same-tick ordering case, use an explicit event writer or fix ordering before accepting the export—not a promise that “the library handles everything”.

Always allow export of all project lanes independent of current mute/solo audition state; optionally expose “audible lanes only” as a clear separate choice. MIDI does not automatically retain locks, draft history, selected notes, or Jev provenance. JSON project export retains these application features.

## 5.9 Project files and import

Extension suggestion: `.jev-music.json`. It contains the versioned score contract, prompt/plan, generation settings, instrument bank IDs, locks, history, and provenance summaries. No credentials, executable functions, raw HTML, or remote asset URLs. Import validates schema plus semantic invariants, assigns a fresh local project ID, and records origin as unverified import. Unknown schema versions fail with a supported-version message; do not guess a migration.

File cap 16 MiB, maximum 50,000 notes, at most four P0 roles, JSON depth limit 32. Reject nonfinite numbers, duplicate note IDs, illegal channels/programs, invalid boundaries, unsupported meter, out-of-range notes, illegal duration, or unsafely named keys. Import is not consent to call the provider. On success the user may play/edit/export immediately, then explicitly request a new generation.

## 5.10 Audio and music quality checks

Unit tests cannot establish musical quality. Use common timbres/gain settings for model/baseline comparisons, save blinded renders, and ask listeners about coherence, requested style, rhythm, variation, and whether they would keep a passage. Track generation failures and constraint violations separately from preference scores.

The app should sound intentionally curated even on fixtures. Verify in at least Chromium and Safari/WebKit where available, including first-play autoplay restrictions, long-loop cleanup, multiple stop/start cycles, high-density chords, and no clipping or stuck notes. Screenshots alone are not audio validation.

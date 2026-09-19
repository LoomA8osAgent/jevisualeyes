# Known limitations

Honest boundaries of this build. None of these are disguised.

## Musical quality is not asserted

- Unit/integration tests prove **structure, determinism, and protocol correctness** — not taste.
  Whether live Jev output is *good music* is an open question the spec itself flags; the fixture
  provider exists so the whole pipeline can be exercised without pretending otherwise.
- Fixture-mode compositions are synthetically generated and labeled `fixture` everywhere
  (UI badge, `generation.provenance`, exports). They are never presented as live output.

## Cost and latency

- Live mode is deliberately sequential: one HTTP request per lane-bar plus planning.
  A 16-bar, 4-lane piece is roughly **75–80 provider calls** — minutes of wall time and
  real credit spend. The job UI shows truthful progress (decisions, requests, tokens)
  rather than a fake bar.
- Requests carry a bounded rolling context (recent bars, motif, harmony plan), not the
  full score; very long compositions still accumulate token cost, but context size per
  request is capped by design.

## Provider behavior

- Only `jev-latest` (TypeSafe System One `choice` questions) is supported.
- Transient provider failures retry with backoff up to a per-decision bound; jobs surface
  `retry_wait`/`paused`/`failed` states honestly instead of swallowing errors.
- No streaming provider responses — each decision is one request/response.

## Editing scope

- Natural-language edits map to a fixed intent vocabulary (tempo, instrument, gain, mute,
  transpose, locks, duplicate region, regenerate). Musical requests outside the
  mechanical ops fall back to `regenerate`; only requests outside the MIDI medium
  (vocals, audio effects, mastering) are refused as unsupported.
- Undo/redo walks the accepted-revision chain; it does not snapshot the piano roll's
  transient selection state.
- Region regeneration replaces only editable (unlocked, in-scope) notes; locked content
  is never modified — crossing locked notes are skipped, not split.

## Audio

- Browser synthesis via Tone.js approximates General MIDI programs with a handful of synth
  timbres. Exported `.mid` files carry the real program/channel data for a proper renderer.
- Velocity is flat (84) for generated notes in this build; expressive dynamics passes are
  unimplemented.
- Playback is MIDI-style synthesis, not audio rendering — no mixing, effects buses, or stems.

## Platform

- Single-user local server (`127.0.0.1` by default). No auth, no multi-tenancy; do not expose
  the port to a network you don't trust.
- SQLite, single-process job runner. Concurrent jobs per project are refused by design.
- E2E tests require Playwright browsers (`npx playwright install`); the live smoke test is
  opt-in and billable (`LIVE_JEV=1` + `TYPESAFE_API_KEY`).

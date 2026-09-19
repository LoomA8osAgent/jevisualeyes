# 06 — Data contracts and invariants

## 6.1 Authority

`reference/contracts.ts` describes the intended application types. `schemas/` validates the portable external shapes. `reference/core.mjs` implements selected arithmetic/selection/editing primitives. These are contracts to integrate, not proof that the full application exists.

`schemaVersion` is mandatory on portable application documents. Provider request/response JSON uses the provider's shape and must not include invented schemaVersion fields. A new application file version requires an explicit tested migration. Never infer code or executable behavior from imported values.

## 6.2 Canonical entities

**ProjectFile** contains the accepted score snapshot, settings, and provenance summary. It is portable. **Revision** adds parent/base identity and a canonical hash in server storage. **GenerationJob** is an internal resumable operation, not automatically portable across installations. **DecisionReceipt** is an internal audit record tying a specific context/candidate map to an accepted event. **Note** is actual music; a rest appears in a receipt/cursor history, not as a fake pitch-0 note.

Primary note fields: `id`, `startTick`, `durationTicks`, `midi`, `velocity`, `locked`, and `source`. `source.kind` is `jev`, `manual`, `derived`, or `fixture`. `source.decisionIds` identifies selecting/holding decisions; `parentNoteIds` identifies editor-derived changes. A new live note needs a source receipt in trusted server storage. Imported source fields are not trusted attestation.

Track fields include role, instrument ID, zero-based MIDI program/channel, volume, pan, mute, solo, lock, and notes. P0 roles are unique; two roles may use the same instrument. Percussion channel is 9; pitched channels are distinct and not 9. UI order need not equal scheduler priority or MIDI track order, so store/use stable lane IDs.

## 6.3 Required semantic checks beyond JSON Schema

1. Allowed meter pairs are exactly 4/4, 3/4, and 6/8. Do not accept all Cartesian combinations of enum values.
2. `totalTicks = lengthBars * barTicks`; every note ends by totalTicks; section/chord intervals are positive and inside it.
3. Section coverage is continuous, ordered, and nonoverlapping. Harmonic plan coverage is continuous when harmonic guidance is enabled; `no_chord` is an explicit slot, not an accidental gap.
4. Track IDs, section IDs, and note IDs are unique at their respective scopes; note IDs are globally unique within a project.
5. Notes have finite integer MIDI/tick/velocity values. Program/channel and pitch ranges are valid. Note velocity 0 is not a sounding note; use a rest instead.
6. Generation never overlaps monophonic notes or protected notes in its lane. Manual polyphony is permitted and must be preserved outside regenerated regions.
7. A generated hold targets exactly the immediately sustained editable note group; its source IDs and durations change together. No hold follows a rest or extends a locked note.
8. Provider distributions match all candidate keys, have nonnegative finite values, and sum to one within tolerance. Local selected key always resolves to a concrete persisted event.
9. A job's cursor and decision index increase monotonically after commits. Receipts, note updates, sampler state, and job-event append are transactional.
10. Scope/lock preservation is checked again before accepting a draft. UI disabling is not sufficient.
11. Same saved score/settings produces the same MIDI schedule. Same model prompt/seed is not an exact live-generation guarantee.
12. A file claiming live provenance is displayed as unverified on import unless matched to trusted local receipts.

A successful partial draft may contain fewer than four bars. Portable files allow 1–64 bars; the normal new-composition control begins at four. Preserve a `partial` flag and original requested length in generation metadata when cropping a partial result.

## 6.4 Hashing and canonicalization

Use deterministic JSON serialization with recursively sorted object keys, preserved array order, finite numbers, and rejection of unsafe keys/non-JSON values. UTF-8 bytes are hashed with SHA-256. This is an application canonicalization scheme named `jev-json-v1`, not a claim of implementing a particular external canonical-JSON standard.

Hashes serve different purposes: request hash identifies exact provider input; candidate hash identifies its concrete effects; base revision hash detects stale edits; score hash supports replay/integrity. A file hash is not evidence that music is good or that a provider produced it. Never hash a key into a portable file as an ersatz secret identifier.

## 6.5 Boundaries and extension policy

Unknown top-level project fields are rejected in v1. Provider responses may have harmless additional fields; validate and use only the expected result. Persist optional raw responses in debug/audit storage under a size limit, not in normal user exports. Use string-valued criteria until the provider's structured-option schema is reverified.

The SQL is a layout sketch, not the entire persistence implementation. The build agent must supply migrations, transaction boundaries, ownership checks, replay pruning, recovery logic, and tests. The reference kernel similarly does not implement the complete planner, UI, renderer, or production job runner.

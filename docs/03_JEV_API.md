# 03 — Jev integration and prompt contracts

## 3.1 Verified provider contract

Checked 17 September 2026 against TypeSafe's official HTTP, Choice, State, and SDK documentation [S01–S04]. The documented endpoint is:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <server-side API key>
Content-Type: application/json
```

Use top-level `model`, `state`, and `questions`. Initial configurable model value: `jev-latest`. Choice questions use `type: "choice"`, `instructions`, and a `criteria` map. Answers are keyed by the application's question ID and contain `choice`, `probabilities`, and `confidence`; reported usage contains input/output token counts. Questions in one call share the same state but are evaluated independently. This endpoint is not a chat-completions or streaming-note endpoint.

The documentation's detailed Choice page describes structured criteria, while the HTTP reference presents string/null values. **Use string-valued descriptions initially**, including serialized musical attributes in readable sentences. This avoids relying on that documentation discrepancy. Keep the actual candidate objects in application state and the persisted candidate map.

Use raw server-side `fetch` in one small provider adapter for the initial integration. The official JavaScript package is `@typesafe-ai/sdk`, with `TypeSafeClient.systemOne` [S04]; it is an acceptable replacement only after matching this contract and disabling duplicate retry layers. Never expose a key in browser code, source maps, URLs, exported project files, or logs.

## 3.2 Example decision request

The complete executable fixture in `app/fixtures/jev-request.json` contains a generated finite candidate list. This shorter illustration shows the shape only; its three alternatives are intentionally not the full production vocabulary. At bar-aligned cursors the criteria are complete-bar options (`B_*`); mid-bar cursors get atomic `N_*`/`R_*`/`H_*` events instead.

```json
{
  "model": "jev-latest",
  "state": {
    "task": "Compose the next musical event",
    "originalPrompt": "A slow blues melody with room to breathe",
    "ppq": 480,
    "meter": [4, 4],
    "tempoBpm": 84,
    "lane": {"id": "lead", "role": "lead", "instrument": "electric_keys"},
    "cursorTick": 0,
    "boundaryTick": 1920,
    "currentHarmony": {"rootPitchClass": 9, "quality": "dominant7"},
    "harmonicPlan": [{"startTick": 0, "endTick": 1920, "chord": "A dominant7"}],
    "scoreSoFar": [["n1", "lead", 0, 480, 69, 84, "generated"]],
    "completedSections": [],
    "phraseIntent": "introduce"
  },
  "questions": {
    "next_event": {
      "type": "choice",
      "instructions": "Choose the complete next bar for this lane as ONE option. Each option lists the full bar contents — notes/rests/holds with tick durations at PPQ 480 — continuing from the cursor. Read the original user request, applicable edits, recent notes, the completed-sections summary, harmony, phrase intention, meter, position and boundaries.",
      "criteria": {
        "B_r1_arch": "G4 480; A4 240; C5 240; E5 960 — full bar from tick 0, 1920 ticks, PPQ 480.",
        "B_r5_desc": "E5 480; D5 480; C5 480; A4 480 — full bar from tick 0, 1920 ticks, PPQ 480.",
        "B_hold": "hold 1920 — sustain the previous note for the full bar."
      }
    }
  }
}
```

All note values and outcomes supplied with this handoff are invented test data. They are not receipts from a model run.

## 3.3 Adapter interface

```ts
interface DecisionProvider {
  evaluate(request: ChoiceRequest, signal: AbortSignal): Promise<ProviderReceipt>;
}
```

`ProviderReceipt` includes the parsed answer, raw response hash, normalized usage, measured latency, HTTP status, returned model string, and provider request ID only when a real documented/observed header supplies one. Unknown provider fields are preserved only in optional debug storage; never used as executable instructions.

Always verify: answer exists for the requested ID; type matches; chosen key exists; probability keys equal the candidate keys; numbers are finite/nonnegative; total is within 1e-3 of one; confidence is within [0,1]; reported usage is nonnegative integers. Check that the reported choice is a maximum-probability candidate within numerical tolerance. Unexpected distributions are errors, not permission to select a random note. Maintain a bounded raw-response size and reject malformed JSON safely.

Persist stable candidate IDs and their concrete effects. The selected key is looked up in that map; do not parse model-supplied strings as music code, JavaScript, SQL, or shell syntax.

## 3.4 Prompt templates

`PROMPT_VERSIONS` and `INSTRUCTIONS` in `app/core/requests.ts` contain the versioned instructions for plan, harmony, phrase intent, groove, next event, and edit intent. They are starting specifications to evaluate, not claimed optimal prompts. Keep version IDs in receipts so a changed prompt does not become an invisible product change.

Every next-event state includes:

- raw original prompt and current applicable edit request;
- accepted plan, exact tempo/meter/PPQ/swing interpretation, sections and phrase goal;
- lane register/instrument and legal boundary;
- a bounded rolling context — recent-bar score tuples from all lanes (about the last 4 bars), the theme motif flagged `motif`, retained future notes flagged `future_immutable` when editing — never the entire score;
- compact `completedSections` summaries so earlier material can be developed or returned to;
- harmonic plan around the cursor and relevant motifs as actual notes;
- explicit constraints/locks and the full concrete candidate list (complete-bar options at bar-aligned cursors, atomic events mid-bar).

Do not ask for prose rationale that the interface cannot produce. A user-visible explanation can say “selected E5 for half a beat” because that is a fact. It cannot say “Jev felt nostalgic” or invent a private reasoning narrative. Diagnostic musical tags are computed from the selected event and state, not presented as a model explanation.

## 3.5 Planning and edit routing without a second LLM

Use multiple closed-set questions where independent. For raw text edits, first resolve operation(s), target lanes/scope, and explicit parameter direction/value. The code applies validated results. If a command has two dependent parts, resolve the second after the first is accepted or build a finite set of complete combined edits; do not pretend an independently sampled pair is a coherent plan.

Supported initial edit intents: tempo, instrument, volume/mute, deterministic transpose, regenerate selected lane/region, change density/variation for regeneration, preserve/lock a target, and create a new variation. For exact BPM values or interval numbers, parse explicit numbers deterministically and let Jev choose how the referenced value should be used. Vague changes map to documented defaults, shown in a preview.

A bounded classifier cannot invent arbitrary executable edit programs. Musical requests outside the mechanical ops (style changes, “busier”, “darker”) resolve to `regenerate` — a route-level keyword floor corrects obvious misclassifications before trusting a refusal; `unsupported`/`ambiguous` is reserved for requests outside the MIDI medium (vocals, audio rendering, effects). A compound sentence such as “keep the melody, make the drums busier” resolves to a protected Lead constraint plus regeneration of Drums, not permission to rewrite the entire song.

## 3.6 Errors, retrying, rate limits

The official API documents 401, 422, 429, and 529 [S01]. Retry connection failures and transient 408/429/500/502/503/504/529 responses under the application's bounded policy. Never automatically retry 400/401/403/404/422 until the cause is changed. A model name not available to this account is a setup error, not a fallback to another provider.

Initial policy: 45-second attempt timeout; at most 4 total attempts for one logical decision; exponential backoff starting at 1 second, capped at 30 seconds, with jitter; honor Retry-After when present. An excessively long cooldown pauses the job with a resume time rather than spinning. One retry layer only. These are application defaults, not provider guarantees. Abort signals must propagate through backoff and fetch.

A timeout may occur after the provider already did billable work. Do not assume provider idempotency: it was not established in the checked contract. Retrying an identical request can cost again or return a different answer. Guarantee only one **local commit** per logical decision, while showing attempt and usage uncertainty separately.

## 3.7 Credits, limits, and diagnostics

The owner has credits; do not optimize away the sequential decision loop (no batching decisions to save calls). Still impose a configurable attempt ceiling and a Stop button to prevent bugs draining a key. Initial ceiling 12,000 HTTP attempts per job, including planning and retries; larger allowed by explicit owner configuration. A count of planned decisions is an estimate because Jev selects bar and event durations.

Sum returned token usage across observed attempts, not just accepted notes. Record missing usage for attempts without a receipt. Exact dollar cost is unknown unless account-specific prices are independently verified/configured; do not invent a price or infer one from tokens. The default UI shows requests and reported tokens in an expandable panel, not intimidating spending warnings on every note.

Do not assume model context size, latency, quotas, cache behavior, request determinism, or musical competence. Measure on the configured account. Limit concurrent jobs per owner to one initially and concurrent calls per job to one. Credits do not remove rate limits.

## 3.8 Safe live smoke test

`app/scripts/live-smoke.mjs` sends exactly one Choice request only when both `LIVE_JEV=1` and `TYPESAFE_API_KEY` are set. It validates the response and prints a sanitized summary. It must not run during install, build, normal tests, or opening a demo. The implementing agent should add separate controlled tests for a short phrase and full arrangement; do not represent the one-call test as a quality benchmark.

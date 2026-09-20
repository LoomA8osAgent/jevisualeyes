# THE COMPOSER CONTRACT

> The canonical contract for this repository. Everything a reader needs is here or in a
> public URL; nothing in it depends on a private tree.

**jevisualeyes is an offline, author-time preset composer driven by a *decision model*.** A
decision model is a classifier, not a generator: it answers typed questions about a state
with calibrated probabilities. It writes no text, no GLSL, no JSON, and no artifact of any
kind. It picks one option from a menu this code built, and this code renders the pick.

**The consumer is A8os**, a multi-format real-time visual compositor. Its *records* (a shape
and its declared knobs) and its *shared rosters* (screen-space math operators, raymarch
shading operators, layer modes, the FX manifest, the LFO waveforms) are what the composer
composes for and reads from — never a copy held here. A composed unit leaves this tool
immediately and lands in the consumer's own source-keyed preset bank through the consumer's
own write path; a bake whose results only existed in its own database would be a second
writer for state the app owns.

**The emission dialect** a composed record must eventually carry is ISF2:
<https://github.com/LoomA8osAgent/ISF2>. Its `DESCRIPTION` field and the endpoint sentence
form of §8 are that standard's, not this repo's invention.

Sections: **§1** the spine · **§2** the primitives and the wire · **§3** providers,
engagement, fail-closed · **§4** validation and selection · **§5** receipts (**§5.1** the eye) ·
**§6** axes and the user vocabulary · **§7** the pipeline · **§8** the descriptor requirement ·
**§9** the stacks and their rosters · **§10** locks and regenerate-unlocked · **§11** what the
model is never asked · **§12** the versioned unit.

Measurement attribution: every number below marked *measured* was measured on the A8os corpus
and on an Apple M4, 2026-09-19.

---

## §1 The spine — code enumerates, the model picks one, code renders

The single load-bearing rule. Everything else is a consequence of it.

```
code  →  enumerates 2–255 COMPLETE, VALID, CONCRETE options, each with a stable id
         and one readable line                          (the menu bounds what can exist)
model →  returns one id + a probability per id           (the state steers which wins)
code  →  looks the id up in the persisted candidate map and applies its recorded effect
```

**Never decompose one artifact into independently-sampled parts.** Asking a separate question
per knob produces a parameter vector nobody ever judged as a whole: twelve individually
plausible values are routinely an incoherent look. So the unit the model picks is a *complete*
option — a full parameter vector for one stack, a whole layer state, a whole effect chain —
sampled and bounds-checked by code before the model sees it.

Corollaries, all mechanical:

- **A candidate is valid by construction.** Every sampled value is drawn inside its knob's
  declared `[MIN, MAX]` (`app/core/samplers.ts:69`) and the finished look is re-checked before
  it is offered (`assertLookInBounds`, `app/core/samplers.ts:292`). Validity is a property of
  the *sampler*, never of the answer — so no validator and no model is ever load-bearing for
  it.
- **Ids are stable and meaningless to the model**; the readable description carries the
  meaning (`app/core/candidates.ts:36`).
- **A menu with fewer than 2 options is not a decision and is not asked** — and the fact that
  it was not asked is *reported*, because a stack silently missing from a bundle is how a
  capability disappears without anyone noticing (`notAsked`, `app/core/candidates.ts:62`).
- **If an option is not on a menu, no state can produce it.** Coverage is a code question.

## §2 The three primitives and the wire

One endpoint, one state, N questions. **Questions in one request share the state and are
evaluated INDEPENDENTLY** — they cannot see one another's answers. That property is the whole
basis of §7.

```
POST <base>/v1/systemone
Content-Type: application/json
Authorization: Bearer <key>            # remote provider only; the local default has no key

{ "state": <string | object | array>, "questions": { … }, "model": "<pinned model>" }
→ 200 { "answers": { … }, "model": "<model>", "usage": { … } }
```

| Primitive | Question | Answer | Type |
|---|---|---|---|
| **Noul** | a yes/no | a probability in `[0, 1]` | `app/core/types.ts:22` / `:29` |
| **Choice** | one option from a NAMED, CLOSED set | the chosen key + a probability per option + `confidence` | `app/core/types.ts:24` / `:30` |
| **Score** | a position on an ORDERED ladder of named *situations* | an ordinal index + a distribution + a legend | `app/core/types.ts:26` / `:31` |

A **Score's number is an ordinal, never a measurement** — turning a level index into an actual
value (a rate in Hz, a count) is arithmetic and arithmetic is done in code. A **Noul near 0.5
is UNCERTAIN, not "medium"**; it is never interpolated as a magnitude.

Request and response shapes are in `app/schemas/decision-request.schema.json` and
`decision-response.schema.json`. Those schemas are **shape only** — the binding checks of §4
are *relational* (they compare an answer to the request that asked it) and no schema can
express them. `app/core/validate.ts` is the enforcing implementation and nothing stands in for
it.

## §3 Providers, engagement, and fail-closed

One interface, `DecisionProvider` (`app/core/types.ts:49`): an `id`, a pinned `modelId`, a
`providerClass`, a `provenance`, `decide(request, signal)`, and the provider's own
`isRetryable(err)`. Nothing else is assumed of a provider — not a URL, not a price, not an
error vocabulary. A model that cannot return a distribution over a closed candidate set is not
a decision provider and does not belong behind this interface.

**The local provider is the default; the remote one is optional.** Concretely:

| id | What it is | Key | Default? |
|---|---|---|---|
| `local` | an open-weight decision model on this machine over the same wire, bound to loopback — **Laya** (<https://huggingface.co/convaiinnovations/laya>, Apache-2.0) served by **von** (<https://github.com/wfzyx/von>) on `127.0.0.1:8493` | none | **yes** |
| `jev` | **Jev (TypeSafe AI)**, `https://api.typesafe.ai/v1/systemone` (<https://docs.typesafe.ai>), called directly from this machine with the operator's own key | env or a `0600` settings file, never a repo file | opt-in |
| `fixture` | a planted answer map, in-process, zero network | none | every test and gate |

Both HTTP providers are served by one adapter class, because they speak one wire
(`app/server/provider.ts:29`); which one is built is configuration
(`providerFor`, `app/server/provider.ts:113`; `app/server/config.ts:57`).

**Two operational facts about the local launcher, both measured, both binding.** `von serve`
defaults to `--host 0.0.0.0` — a LAN-exposed decision server with no auth — so every
invocation passes `--host 127.0.0.1` explicitly. And the PyPI package named `von` is a 2.5 KB
stub by an unrelated author: the project installs from its git remote only, and no instruction
in this repo quotes a `pip install von` line.

### §3.1 Provider CLASS decides what a provider may DO

| Class | What it is | Its number |
|---|---|---|
| **TRAINED** | a scoring head trained against proper scoring rules — calibrated by construction | a confidence. May arm a threshold |
| **DECODE** | option logits read off a stock LLM | an *ordering* wearing a distribution's shape. **Argmax only, advisory only** |
| **DIFFUSION** | an option read off a diffusion canvas | unestablished. Research only |
| **FIXTURE** | a deterministic stub | neither. Stamped `synthetic` in every receipt |

The receipt records `providerClass` beside `providerId` (`app/core/types.ts:62`), so an
artifact can never read as calibrated when a DECODE provider produced it. A DECODE server put
behind the local URL **must say so** in configuration (`app/server/config.ts:70`), because
degrading that silently is the purest form of a gate that fails open. A survey of the open
replicas is tracked at
<https://huggingface.co/spaces/multimodalart/jev-reproductions-tracker>.

### §3.2 Fail-closed, and the resident process

- **No silent fallback, ever.** A failing `local` does not become `fixture`; a misconfigured
  `jev` throws rather than quietly degrading. Choosing the fixture is explicit configuration
  (`app/server/provider.ts:113`, `app/server/config.ts:104`).
- **A missing fixture map is an ERROR, not an empty map** (`app/server/fixture.ts:46`) — a
  fixture that silently answered its default to everything because its map was mis-pathed
  would be the failure mode inside the very thing built to prevent it.
- **The fixture is TOLD what to answer, and never infers one from the state.** A fixture that
  inferred would be a second, worse model, and the thing under test would no longer be the
  code. Its output passes the same §4 validation a real provider's does
  (`app/server/fixture.ts:124`).
- **The provider process must be resident.** Measured: a cold in-process session costs 551 ms
  before it answers anything, and the local reference runtime pays **24.6 s of weight load and
  3.3 GB resident, once per session**, then answers a Noul in **115.5 ms** over the loopback
  round trip. A consumer that cold-loads per fire is disqualified by the measurement, not by
  preference.
- **Engagement is printed, never inferred from silence.** A seam is ENGAGED (it asks; and if
  it cannot reach its provider it **denies**, with the typed reason printed) or NOT ENGAGED
  (no question was asked and none was promised — and it says exactly that). *Not engaged* is
  not *failing open*: failing open is asking, getting nothing, and approving anyway, which
  never happens. What makes it auditable is that a reader of the output can always tell which
  state they are in, because it never passes silently.
- **Live smoke is exactly ONE call**, behind both an explicit flag and a present key, never
  during install, build, the test run, or any gate (`app/scripts/live-smoke.mjs`).

## §4 Strict validation and selection policy

### §4.1 Validation — every one of these, or it is an error

Per requested question id (`app/core/validate.ts:40`): the answer **exists** · its `type`
matches what was asked · for a Choice the `choice` key is a member of the submitted set · the
`probabilities` keys **equal** the candidate keys exactly, none extra and none missing · every
probability is finite and non-negative · they **sum to within 1e-3 of 1** (that rounding error
is the only thing renormalized) · `confidence ∈ [0, 1]` · **the reported `choice` is a
maximum-probability candidate** within `1e-6` · for a Score, the ordinal lies on the submitted
ladder and the legend has exactly as many levels · `usage` counts are non-negative integers.
A response answering only some of its questions, or answering one that was not asked, is an
error (`app/core/validate.ts:87`).

**Any violation is an ERROR — never permission to pick at random, and never permission to
proceed on a partial answer map.** Malformed JSON, an oversized body and an unparseable
payload are the same class.

Two constants are fixed on purpose:

1. **The argmax rule is strict** (`ARGMAX_TOLERANCE`, `app/core/validate.ts:29`). A near-max
   but non-argmax reported choice is REFUSED. It cannot trip on the fixture or on an
   in-process local provider; if a remote run ever trips it, that is a provider *finding* to
   record — not a tolerance to widen quietly.
2. **The probability-sum tolerance is fixed at 1e-3** (`SUM_TOLERANCE`,
   `app/core/validate.ts:27`), never scaled with the option count. Menus here are ≤ 25 options
   and usually 2.

### §4.2 The model's string is never code

The chosen key is **looked up in the persisted candidate map** and the candidate's own
recorded effect is applied (`resolveLook`, `app/core/candidates.ts:90`; enforced structurally
in the spine, `app/server/jobs.ts:24`). A model-supplied string is never parsed as GLSL, JS, a
param name, a path, or a shell fragment. A key the map does not carry is refused loudly: it is
either a provider returning something outside the submitted set or a map/receipt mismatch, and
neither may be papered over.

### §4.3 Byte ceilings and retry

A payload ceiling is enforced **before** the call and on the response as it is read
(`app/server/provider.ts:51`). An over-ceiling request is **rebuilt from current state, never
truncated and never replayed**.

**ONE retry layer**, in the runner, never also in a provider or a vendor SDK: at most 4
attempts per logical decision, exponential backoff with jitter, `Retry-After` honoured, abort
signals propagating through both backoff and fetch. The runner asks the *provider* whether a
failure is retryable — the policy is shared, the classification is the provider's. Retryable:
connection failure and `408 429 500 502 503 504 529` (`app/server/provider.ts:22`). Never
retried: `400 401 403 404 422` — a model unavailable to an account is a setup error, and a
silent provider swap would invalidate the thresholds, which are per-provider (§12).

**A timed-out attempt may already have been billed.** Provider idempotency is not established,
so a retry can cost again and return a different answer. The runner guarantees exactly **one
local commit per logical decision** and reports attempt count and usage uncertainty
separately. **Exhausting the retries is a refusal**, with the provider id and the last error
printed.

### §4.4 Selection — the variation control

Two modes, recorded per decision (`app/core/selection.ts:11`):

- **`model`** — commit the provider's validated argmax.
- **`sample`** — seeded, app-side sampling from the validated distribution with a documented
  temperature transform (default **0.8**): for positive `p`, weights ∝
  `exp(log(p)/T − maxLogWeight)`; zero probabilities stay zero; `T = 0` selects the maximum
  with a stable lexical tie-break. This is what makes "give me another one" produce a
  different look. It is an *application* control, never an undocumented request parameter.

PRNG state persists atomically with each accepted decision (`seedBefore`/`seedAfter`), so **the
same stored responses plus the same initial PRNG state replay exactly**. A live rerun does
not, and this contract never claims otherwise. That claim is EXECUTABLE rather than asserted:
`ReplayProvider` (`app/server/replay.ts`) answers a re-run from the composed unit's own stored
responses — keyed by the canonical `requestHash`, looking up and never inferring, exactly as
the fixture never infers (§3.2) — and I4's acceptance is a sha256 comparison of the two
snapshots (`app/server/compose.ts`, `npm run compose:fixture`). Both the provider's choice and the committed
choice are always recorded.

## §5 Receipts are provenance

Every decision persists a receipt (`app/core/types.ts:62`, schema
`app/schemas/receipt.schema.json`). This is not telemetry — nothing leaves the machine — it is
the same immutable-chain obligation every artifact in the consuming application carries. A
refusal nobody can trace to a question is as bad as a preset nobody can trace to a menu.

A receipt carries: the decision and attempt index · `requestHash` and `candidateHash` · the
candidate-map, prompt-template and roster versions · `providerId`, `providerClass`, and
**`model` as the provider RETURNED it, never as it was sent** · the question id and answer
type · the provider's choice *and* the committed choice · the answer value and `confidence` ·
the selection mode with `seedBefore`/`seedAfter` · usage, latency, and
`provenance: "live" | "synthetic"`.

Two rules that make it honest rather than decorative: **`provenance: "synthetic"` is never
laundered**, and **the returned model string is recorded**, so a silent substitution is
visible in the record. The receipts for one composition ride the composed artifact itself as
`generation.provenance` (`app/core/types.ts:114`) so they survive a save/recall round trip — a
provenance field that vanishes on recall is the worst kind of hole — while the SQLite journal
keeps the run's own copy (`app/server/db.ts:92`).

**Where the receipts ride (I4 the artifact, I5 the delivered slot).** A composed unit is
written as an artifact (`ComposedUnit`, `app/server/compose.ts`) carrying the snapshot, its
sha256, its receipts, and — one thing more than §5 requires — the accepted REQUEST and
RESPONSE of every committed decision, which is what lets the unit be re-run without a
provider at all.

**I5 LANDED (2026-09-20): `generation.provenance` is the identity object, and it is built at
the DELIVERY boundary, not inside the draft.** On the `CompositionDraft` the field is still the
`live|synthetic|mixed` string and is untouched — I4's byte-identity acceptance hashes that
snapshot and must keep hashing the same bytes, and a unit sha nested inside the thing it hashes
is uncomputable rather than merely awkward. `app/core/slot.ts renderSlot` widens it as the unit
becomes a preset slot: the draft's string becomes `provenance.mode` (nothing is laundered — a
fixture run reads `synthetic` in the app exactly as in the journal) beside the provider id /
class / RETURNED model, the roster export's own provenance, `recordId` / `tag` / `seed`, the
unit sha, `replayOf` when there is one, every receipt, and ONE chain entry in the consuming
app's own `prvAppend` shape. The consuming app registers `generation` as a named snapshot field
and carries it VERBATIM both ways (`specs/preset-json.md` §What presets save; its coverage-sweep
row shipped in the same commit), so it survives save → recall → save. Acceptance:
`jev.composed-preset-loads`.

**One more, ADDITIVE and OPTIONAL field rides the same shape**: each `stacks[stack]` entry may
carry `lookVerdict:{receiptId, answers}` (`app/core/types.ts:109`) — the eye's own read of a
rendered flow, when one exists. See §5.1.

### §5.1 The eye — a rendered look's own report, read as text

**"The stack has no eye. Decision models are text-in; the vision is another component."**
(operator, 2026-09-20, ratified.) The eye is not built here. A sibling repository
(`~/gits/visualeyes`) watches the consuming app's own render and writes two things into its
watch receipt: a pure-arithmetic per-flow measurement (brightness, motion, rhythm, colour — no
model, `tools/lib/frame-metrics.js` in that repo) and four decision-model answers about those
NUMBERS as text (`has_motion`, `motion_feeling`, `look_changed`, `something_wrong` —
`app/tools/_look-roster.js` / `tools/judgment/look-verdict.js` there). `core/look-verdict.ts`
in **this** repo is what makes that receipt a typed input HERE:

- **`readLookReceipt(json, path)`** validates the shape and FAILS CLOSED, exactly as a provider
  response does (§3.2) — a receipt without `metricsSchema` predates the pipeline's own layer 1
  and is refused rather than read as an empty summary (the pipeline's own rule, GATE-FAILS-OPEN
  applied to a file read instead of a network call).
- **`judgeAgainstCoordinate(receipt, coordinate, opts)` is a REPORT, NEVER AN ACTION** (§10 item
  4: "deterministic edits never reach the model at all" — and neither does a report about one).
  It compares what a stack's axis coordinate SAID against what the rendered flow MEASURED and
  returns findings; it never resamples, relocks, or writes to a `CompositionDraft`. Finding
  kinds: a motion-axis mismatch (coordinate `motion` vs the measured `has_motion`), a
  bind-bracket check (`flicker.perSec` / `motion.max` against a declared modulation window), the
  A/B leg (`look_changed` across two receipts — `VISIBLE-CONTROL-VISIBLE-EFFECT` asked rather
  than asserted), and `something_wrong` surfaced verbatim.
- **The motion coordinate is BARRED, permanently, from every reader of this seam** — not a
  temporary caution. The sibling pipeline's own falsification (its §5): fed a hand-built state
  describing a 100%-near-black, fully-frozen, hung flow, `motion_feeling` answered "steady" at
  p 0.2443 — the SAME word a genuinely moving record answered at p 0.3355, near-uniform over
  its seven options in both directions. **The seam is SENSITIVE and NOT CALIBRATED.** Every
  `motion-feeling-barred` finding this module produces carries `barred:true` and that
  measurement by name, and `judgeAgainstCoordinate` gives no caller a path to read it as
  actionable. This lifts only if a future labeled set measures a real cut — a change to
  `look-verdict.ts`'s own rule, never a caller working around it.
- **The vocabulary is a cross-repo transcription with no cure at this layer**
  (`SHARED-CANON-DUPLICATED-PER-ENGINE`). `_look-roster.js`'s seven motion-feeling keys are a
  hand-copy of this repo's own `MOTION_FEELING` (`app/core/axes.ts`); `assertMotionKeys` in
  `look-verdict.ts` checks a transcribed list against this repo's live keys and throws named on
  drift — the check runnable from this side, since there is no import path from the other repo.
- **The pixel layer (a vision model) is the sibling's third layer and is a recommendation
  here, never a dependency.** The sibling measured Qwen2.5-VL 7B Instruct (Apache-2.0) under
  llama.cpp on loopback: a neutral two-choice question (*Correct* / *Garbled*) over a contact
  sheet separates torn from healthy at temperature 0, ~150–220 ms per verdict, ~6.6 GB
  resident. Black and frozen are never asked of it — the arithmetic layer owns those. A user
  who wants that eye beside this composer runs it themselves: `ollama pull qwen2.5vl` and
  point at Ollama's OpenAI-compatible endpoint on `127.0.0.1:11434`. Nothing here reads a
  vision answer yet; when it does, it arrives through the same receipt as the four answers
  above, as text, and the same fail-closed reader.

## §6 The axes, and the vocabulary the user speaks

**There are no named styles.** A style is a **coordinate** in a parameter space, and code
samples concrete renderings from the chosen point. This is structural, not a discipline: there
is no family name, no group id, no route and no substrate word anywhere in a menu, because the
menus *are* axes. Widening coverage means adding an axis VALUE or a sampler branch — never a
style name.

Six axes, situation words throughout (`app/core/axes.ts:37`):

| Axis | Values |
|---|---|
| `motion` | `still` · `slow` · `pulse` · `driving` · `any` |
| `density` | `sparse` · `medium` · `busy` · `any` |
| `contrast` | `flat` · `moderate` · `hard` · `any` |
| `warmth` | `cold` · `neutral` · `warm` · `any` |
| `order` | `chaotic` · `loose` · `regular` · `crystalline` · `any` |
| `depth` | `flat` · `shallow` · `deep` · `any` |

**A TAG IS A COORDINATE, WRITTEN IN THOSE WORDS** — `motion:pulse density:busy contrast:hard`
— and compiling one is a projection onto each stack's own axes and nothing else
(`compileTag`, `app/core/tags.ts`; the stack's axes are `STACK_AXES`). There is deliberately
**no tag→coordinate table**: a named tag would be a named style wearing a lookup, and the
table would be the place the style name lived. An axis the tag does not name is absent from
the coordinate, which is what `any` means below; an axis or a word the roster does not carry
is a REFUSAL naming both, never a silently dropped token — a mistyped tag that composed at
the origin would look like a composition.

`any` means *this aspect is left free* — so an unconstrained axis draws across the whole
range, and there is deliberately no entry for it in the position table
(`app/core/axes.ts:157`), because a hidden preference for the middle is not freedom. A
coordinate word becomes a *place in a range* through two small tables — `AXIS_POSITION` and
`AXIS_SPREAD` (`app/core/axes.ts:157`, `:169`) — plus `ROLE_AXIS`, which says which axis each
knob *role* answers to and in which sense (`app/core/axes.ts:230`). A role with no row is
simply unbiased, which is the honest reading of "this coordinate says nothing about this
knob".

### §6.1 The prose a human writes → the axis it lands on

A candidate mapping, and a table a phrase-to-coordinate step is written and reviewed
*against* — not a parser.

| Prose | Axis | Level |
|---|---|---|
| calm · at rest · held · frozen · static | `motion` | `still` |
| drift · pooling · breathing · settling · slow rise | `motion` | `slow` |
| pulse · swell · beat · throb · rounds | `motion` | `pulse` |
| driving · insistent · hurried · rushing · relentless | `motion` | `driving` |
| spidery · lace · porous · thin · open · weightless | `density` | `sparse` |
| packed · dense · thick · crowded · weight-bearing | `density` | `busy` |
| soft · muted · washed · smeared · hazy | `contrast` | `flat` |
| sharp · hard · crisp · cut · stark · readable seams | `contrast` | `hard` |
| cold · teal · verdigris · steel · night · wet · violet | `warmth` | `cold` |
| warm · ivory · umber · copper · ember · sandstone · gold | `warmth` | `warm` |
| chaotic · wilderness · shredded · no discernible repeat | `order` | `chaotic` |
| meandering · wandering · loose | `order` | `loose` |
| woven · repeating · ring · banded · regular | `order` | `regular` |
| lattice · quasicrystal · exact · tiled · countable in a frozen frame | `order` | `crystalline` |
| a surface · a plane · a field · flat | `depth` | `flat` |
| relief · embossed · slight · raised | `depth` | `shallow` |
| marched · receding · fogged · into the dark | `depth` | `deep` |

**Movement FEELING → the easing families that speak it.** The same table, one column wider:
what a human types about *movement* is neither an id nor a waveform name — it is a feeling.
The easing roster already ships the vocabulary that answers those words as `family` + `label`,
so a feeling resolves to a FAMILY the app already has and no named style is introduced. It is
**one table** (`app/core/axes.ts:191`), read both ways — feeling → families, family → feelings —
so there is no second feeling→axis map to drift from this one, and each feeling also names where
it lands on `motion`, exactly as the prose rows above do.

| Feeling | `motion` | Easing families |
|---|---|---|
| held · frozen · stepped | `still` | `steps` · `linear` |
| drifting · settling · breathing | `slow` | `sine` · `quad` · `cosine` |
| easing · rounded · unhurried | `slow` | `cubic` · `quart` · `circ` |
| springy · elastic · overshooting | `pulse` | `elastic` · `spring` |
| bouncy · kicked · rebounding | `pulse` | `back` · `bounce` |
| snappy · abrupt · sudden | `driving` | `expo` · `quint` · `stepSaw` |
| steady · relentless · cyclic | `driving` | `linear` · `saw` · `triangle` |

A family no feeling names is simply unspoken-for: the sampler still offers it when the axis is
unconstrained, which is the honest reading of "no feeling word selects it". Changing any row
bumps `ROSTER_VERSION` (§12) — it is a menu.

**Three prose families that must NOT be mapped — the omission is the finding.**

- **SUBJECT words** (*bone · river · fort · specimen*) pick the RECORD, not the coordinate. In
  a bake there is no pick at all — it iterates the corpus. Forcing a subject word onto an axis
  puts a subject in a menu.
- **SUBSTRATE words** (*raymarch · SDF · level set · fragment plane*) are excluded by
  construction: there is no substrate word anywhere in a menu.
- **NARRATIVE / AFFECT** (*"less like a parameter changing and more like time passing"*) is
  the richest prose there is and it has **no coordinate**. Inventing axes for it would rebuild
  a section-scoped narrative instruction that a preset — which has no sections and no time
  axis to narrate — cannot carry. Its home is a human-read direction field, never the
  composer.

## §7 The pipeline — 2–3 calls per (record, tag)

**Bundle, don't chain: a hop exists only where the MENU is built from a prior answer.
Everything else at the same level is one request.**

```
CALL 1  bundled   axis coordinate per stack, plus one motion Noul per candidate moving param
   ↓              (all independent given the tag)
SAMPLE  no model  N complete looks per stack from the accepted coordinate, seeded
   ↓
CALL 2  bundled   one N-way Choice per stack over that stack's looks — a genuine hop:
   ↓              these menus did not exist before CALL 1
CALL 3  bundled, conditional — only if anything was marked moving: per moving param a
   ↓              waveform Choice over the real modulator roster and a rate Score over an
   ↓              ordered ladder of situations
ASSEMBLY no model  one snapshot per tag, receipts attached, written through the consumer's
                   own save path. Arithmetic and JSON.
```

Builders: `buildAxisRequest` (`app/core/requests.ts:38`), `buildLookRequest`
(`app/core/requests.ts:53`), `buildMotionRequest` (`app/core/requests.ts:74`). The domain half
that decides *what to ask next* is a `Composer` injected into the spine
(`UnitComposer`, `app/core/composer.ts:99`, seam at `app/server/jobs.ts:51`); the spine owns
persistence, retry, validation, selection, receipts and the transaction, and owns **no
sampling**, so the two can never drift into each other.

**What is BUILT of that pipeline today (`docs/PLAN.md` §1 I4) is the reduced form, and the
reduction is by choice rather than by obstacle:** the tag GIVES the coordinate, so CALL 1's
axis half is not asked and its motion-Noul half is — chunked at ≤ 6 per request, §7.1 —
CALL 2 runs with a **bounded accept/resample per stack**, CALL 3 is not asked at all (a
bind's movement shape is still SAMPLED into the `modulation` stack's own look, exactly as
the sampler draws it), and ASSEMBLY writes a composed-unit FILE. **I5 (LANDED) carries that
file the rest of the way:** `app/core/slot.ts` renders it into the consuming app's own
card-snapshot shape and `app/server/deliver.ts` writes it through the app's own
`POST /api/preset-bank/<key>`, refusing a bank that moved between two reads and asserting the
stored slot byte-identical afterwards. ⚠ The BANK KEY is handed in, never derived: a record's
card source composes at LOAD time against live app state (the user palette store rides its
palette roster), so the `src_<sha>` its bank is keyed by is not an offline fact — measured, and
the offline derivation was deleted rather than patched (`docs/PLAN.md` §2). The axis Choices and
CALL 3 are I6.

**The accept/resample, and why a committed look is re-read by code.** `acceptLook`
(`app/core/composer.ts`) re-checks a committed look before the unit may finish, on two
grounds and no others: its values are re-run through `assertLookInBounds` (which cannot fire
on a look this repo sampled — validity is the generator's property, §1 — so what it catches
is a candidate-map/receipt mismatch, §4.2), and, for the stacks that are parameter vectors,
§11's own sentence that a look whose every knob sits at its DEFAULT is structurally valid and
no look at all. A SET stack (`layers` / `fx` / `modulation`) legitimately draws the empty set
— "no effects" is a look — so the second ground does not apply to it. A rejected stack is
re-sampled at a perturbed seed and re-asked at most `resampleCap` times (3 by default) and
then the run **REFUSES**, naming the stack, the count and the reason. It never ships the look
its own check rejected, and a rejected stack whose resample offers no menu is a refusal too
rather than the rejected look standing by default (§3.2). The seed is perturbed per round
because in `model` selection mode the spine's PRNG does not advance, so an unperturbed
resample would redraw the identical menu. This is not a taste gate: taste is the one thing
neither code nor a model can judge (§11).

The spine's loop is: **persist the exact pending payload BEFORE the network call**
(`app/server/jobs.ts:218` — it is what makes a crashed bake resumable and a receipt honest) →
call → validate → select by the recorded policy → **one durable transaction** carrying receipt,
applied pick, cursor, PRNG state and event → and **expose a unit only when every one of its
decisions committed** (`app/server/jobs.ts:404`). Boot recovery marks interrupted jobs and
**never auto-resumes spend**.

### §7.1 ⚠ Bundling is PROVIDER-CONDITIONAL — its cost argument is a round-trip argument

**Measured: bundling buys no compute on an in-process or loopback provider.**

| Bundle | input tokens | in-process p50 | loopback reference runtime p50 |
|---|---:|---:|---:|
| 1 Noul | 304 | 199.6 ms (1×) | 115.5 ms |
| 4 Noul | 1,200 | 876.3 ms (4.4×) | 451.9 ms (3.91×) |
| 10 Noul | 2,990 | 2,179.6 ms (10.9×) | 1,520.0 ms (13.16×) |

**Super-linear, not amortised**, and the reason is structural: the encoder builds **one row per
question and re-encodes the STATE into every row**. Two independent implementations show the
same shape. So:

- **Round-trip providers** — bundling saves the round trips, which is where the cost is.
- **In-process and loopback providers** — bundling still saves bookkeeping and hop count, and
  the *correctness* half is untouched (questions that must not see each other's answers still
  cannot be chained into one request), but it saves **no compute**. Above ~6 questions a bundle
  costs slightly *more* than issuing the questions separately, so CALL 1's ~18 sub-questions
  are **chunked at ≤ 6 per request**, never sent as one row. A budget computed as "N questions
  ≈ one call" is wrong.

**⛔ The lever is STATE LENGTH, not question count and not model size.** Measured on one
902-char state, a 151M-parameter fp16 encoder and a 421M-parameter int8 encoder land within 2%
of each other per question (196.8 ms vs 199.6 ms). The binding cost is the ~300-token forward
pass, and it is insensitive to parameter count and to quantisation. **A smaller checkpoint will
not fix a budget miss; a shorter state might** — which makes the §4.3 byte ceiling a latency
control as well as a correctness one.

**⛔ And the forbidden workaround stays forbidden even where it looks convenient:** an axis may
never be asked as a ladder of independent binaries. Synthesising an ordering out of separate
yes/no answers manufactures a ranking the model never expressed, and it is §1's rule against
assembling one artifact from independently-sampled parts.

### §7.2 What one full run costs

495 records × 4 tag coordinates = **1,980 compositions**, at 2–3 calls each: **5,148 calls,
≈ 13.74 M input tokens** (measured corpus; the arithmetic is done in code, never by the model).
On the remote provider at $0.042 per million input tokens that is **$0.58** for a whole
four-coordinate bake, and **≈ 4.3 minutes** at its 1,200 req/min ceiling. On the local provider
the marginal cost is zero and the wall clock is the device's. A whole-corpus recompose after a
roster change costs under a dollar and under ten minutes, which is what makes re-running after
*any* versioned change affordable rather than aspirational.

## §8 The descriptor requirement — the gate on composability

**A knob with no situation description is not composable, and the run refuses it rather than
guessing.** The model is given each knob's *meaning*, never its GLSL. A non-composable knob is
held at its DEFAULT and **NAMED** in the look's `skipped[]` (`app/core/records.ts:154`,
`app/core/samplers.ts:196`) — never silently omitted, and never guessed at from the label.

**The field is `DESCRIPTION`**, the ISF2 standard's own machine-readable home for the
per-control guide. **Its form names both ends:**

```
<what it does to the image> — <what the MIN end looks like>, <what the MAX end looks like>
```

in the performer's words, never units, never the parameter name restated. This is a *shape*,
not a length limit; ~14 words per end is typical.

**Why the endpoint half is load-bearing rather than decoration.** A sentence that names its two
ends carries an ORDERED LADDER, which is exactly what the primitives consume: a knob whose
sentence names both ends can be put to a Score or a Noul directly, and a look's own readable
line reuses the sentence's head and the author's own word for the end it sits toward
(`app/core/samplers.ts:119`, `:138`). A sentence naming only the effect degrades to a guess —
which this section forbids.

**The review criterion, because it is what makes review affordable at a glance:** a control is a
direct handle on a **visible property** the operator wants to shape — a thing's colour, its
size, its softness, its count. A proposed sentence that describes an *internal* ("coupling
strength", "grain density") FAILS; one that describes a visible property of a named element
("how far the streams bend onto one path") PASSES. The endpoint form is the other half of the
same review: a sentence that cannot name its two ends usually cannot because the knob is an
internal.

### §8.1 Provenance tags on the sentence itself

Each sentence carries where it came from (`SentenceOrigin`, `app/core/records.ts:69`):

| Tag | Meaning | Composable? |
|---|---|---|
| `lifted` | extracted from the record source's own comment | **yes** |
| `authored` | written by the operator | **yes** |
| `role` | the shared role table's sentence for a knob a literal auditor minted | **yes** |
| `proposed` | drafted by a tool, not yet reviewed | **no** — shown for review, refused exactly as an absent sentence is |

`role` composes because a role sentence written in situation form describes the visible effect
of that knob *class* ("how far the cutting plane sits from the origin — 0 is through the
centre, max is at the edge"), which is exactly what a minted knob is; and the role table lives
in one place, so a bad role sentence is fixed once for every knob it names. `proposed` does
not, for the same reason a synthetic receipt is never laundered — the rule applied one layer
earlier, to the question's own state rather than to the answer.

**`DESCRIPTION` over `TIP`.** Where a roster row still carries only its pre-`DESCRIPTION` `TIP`
field (a shorter, non-endpoint-form guide the app already had), the situation sentence is
`DESCRIPTION ?? TIP` — `DESCRIPTION` wins whenever present, `TIP` is a legacy fallback and
never authored fresh (`app/core/samplers.ts` case `'mathops'`). This is why the warp-op roster
went from 1/20 to 20/20 composable on the `mathops` stack the day its `DESCRIPTION` lift
landed: the roster's `TIP` had covered only one of the twenty injected ops, its `DESCRIPTION`
covers all twenty. A composable count is a **measurement against the current export, never a
fixed number** — the mesh-material and light-rig rosters carried `TIP` only as of the export
generated `2026-09-19T15:00Z`, then landed full `DESCRIPTION` coverage the same day (export
`2026-09-19T20:50Z`: `material` 16/18 composable, `lighting` 30/45 — the remainder held back
by the `MIN`/`MAX` gate on enum rows like `materialType`, not by a missing sentence). **An
enum row's candidate space is its own `VALUES` list, not `[MIN, MAX]`** — `fromRoster`
(`app/core/samplers.ts:78`) now gates a `VALUES` row on its sentence alone and draws UNIFORM
across its own states (order is not a magnitude a coordinate axis can bias toward), which
moved `material` to 18/18; `lighting` reads 39/45, the remaining 6 (`light1Color`/`light1Ground`
and their light-2/3 siblings) held back for the reason that survives — a `color` row's
`DEFAULT` is an array, not a number, so it has neither a `[MIN, MAX]` nor a `VALUES` list to
draw from. Re-run `stackKnobs` against the live bundle rather than citing a number from this
file.

**Measured state of the debt (index generated 2026-09-19T10:00Z).** The descriptor carries
`DEFAULT / MIN / MAX / LABEL` on every input and `BIPOLAR` on 247 of them. **The mechanical
lift has landed: 1,479 of 3,844 knobs (38.5%) now carry a `DESCRIPTION`, across 278 of the 495
records.** That is essentially buckets A + B below — the meanings that already existed as
comments in the record *sources*, which the converter used to strip. What remains is bucket C
(new prose) and bucket D (one shared role table). The census, by bucket:

| Bucket | Count | % | What it means |
|---|---:|---:|---|
| A — comment directly on the input | 210 | 5.5% | extract the comment |
| B — meaning stated elsewhere in the file's prose | 1,325 | 34.5% | mechanical with a wider search window |
| C — no descriptive text anywhere in the source | 408 | 10.6% | **the real authoring debt** |
| D — structurally generated; no literal input text exists | 1,901 | 49.5% | one shared role table covers all of them |

A + B = 1,535 knobs carried machine-findable text, and 1,479 of them have now been lifted into
the descriptor. 114 of 495 records are wholly bucket D. **408 is the number that needs new
prose**, and the 1,901 of bucket D are one table away.

## §9 The stacks, and where each draws its roster

A "stack" is one part of a card the composer sets as a whole (`StackId`,
`app/core/types.ts:84`). A record's own `inputs` are one stack; the other five draw from the
consuming app's shared rosters, **read at run time and transcribed nowhere**
(`app/core/rosters.ts:230`), so a roster change reaches the composer by re-running rather than
by editing this repo.

| Stack | Knobs come from | Group id | Axes it answers |
|---|---|---|---|
| `shape` | the record's own `inputs` map | `shape` | `density` · `contrast` · `order` |
| `mathops` | the warp-op roster ∩ the injected-op names | `symmetry` | `motion` · `order` · `depth` |
| `shade` | the raymarch shading-op roster | `raymarch` | `contrast` · `warmth` · `depth` |
| `layers` | the layer canon's background + fill modes and slot hosts | `bg` / `layer:N` | `warmth` · `density` |
| `fx` | the FX library manifest | `fx` | `contrast` · `motion` |
| `material` | the mesh-material descriptor roster | `material` | `contrast` |
| `lighting` | the light-rig descriptor roster | `lights` | `warmth` |
| `modulation` | the record's composable knobs × the MOVEMENT roster (waveforms + easings) | — (binds ride the data router) | `motion` |

**`material` and `lighting` are offered only when the record's own `route` admits a mesh**
(`mesh` or `either`) — the symmetric gate to `shade`'s marcher-only one, for the same reason:
a pure-raymarch record has no mesh material or three.js light rig to set. Both answer a single
axis each (`contrast` for the material's gloss/roughness reading, `warmth` for the light rig's
colour temperature) — deliberately, since both already carry full §6/§6.1 vocabulary, so
nothing was added to the axis tables. **Their descriptor rosters read `DESCRIPTION ?? TIP`**
(§8.1) like every other roster — carried `TIP` only through the export generated
`2026-09-19T15:00Z`, so 0% composable was the correct reading through that point; the
`DESCRIPTION` lift landed the same day (export `2026-09-19T20:50Z`), and composability is now
18/18 (`material`) and 39/45 (`lighting`) — an ENUM row's candidate space is its own `VALUES`
list, gated on its sentence exactly like a ranged knob (§8), so `materialType`/`light1Type`
and their siblings compose too; what remains at `lighting` is the 6 `color`-type rows
(`light{1,2,3}Color`/`Ground`), whose array `DEFAULT` has neither a range nor a `VALUES` list
to draw from. Reported by `stackKnobs`/`Knob.skipReason` against the live export, never
guessed at or cited as a fixed number.

⚠ **Two `_groupId` families the operator named are NOT wired here, surfaced rather than
resolved.** `color`/`sub:palette` knobs exist but are scattered per-engine source with no
single shared-canon module the composer can read the way `_mesh-material.js` /
`_lighting.js` are — a colour/palette stack needs that shared roster built first. `world` /
`slices` (`_sdf-template.js`, the compound-SDF instancing lattice) read as card-family scoped
rather than a capability every route shares, unlike material/lighting.

**`color`/`sub:palette` are now a SHARED roster, but NOT through a `StackId` in this table**
(`docs/PLAN.md` §1.0b I5.5). The SHADING accordion (`_groupParent:'surface'`, template state —
identical on every record, not scattered per-engine) is `shared.shading` in `rosters.json` (a
5th `shared.*` shape, `app/core/rosters.ts` `ShadingRoster` — a group tree alongside the flat
input list) and its own bank/sampler/request modules (`app/core/shading.ts`,
`shading-samplers.ts`, `shading-requests.ts`). It is a SEPARATE program, not a ninth `StackId`,
because it composes the app's FACTORY bank surface (one look set shared by every record,
`_sdf-factory-banks.js`) rather than one record's source-keyed slot — a `StackId` and its
`CompositionDraft.stacks[id]` entry are record-scoped by construction (§7), and template state
has no record to be scoped to. See `docs/PLAN.md` §1.0b for the full program.

The table is the one in `app/core/records.ts:131` (`STACK_SOURCES`), which carries each
roster's concrete source; the axis column is `STACK_AXES` (`app/core/axes.ts:73`). Each roster
already declares the group id its controls live under, so the mapping is **read, not asserted** —
a capability belongs to the medium, never to a card type, and a group id names what the group
*is*.

**`shade` is offered only when the record's own route admits a marcher.** A mesh-route record
has no raymarch shading hooks to layer onto, and offering the stack would be a menu whose every
option is inert (`app/core/records.ts:188`).

**Two of the six stacks are SET stacks, not parameter vectors** — `layers` and `fx` draw a
bounded membership rather than a vector, because a stack whose every option is on is not a look,
it is a pile (`app/core/samplers.ts:157`). `modulation` samples, per moving param, a MOVEMENT SHAPE
from the real roster, an **ordinal rate level** (never a rate — turning an ordinal into Hz is
arithmetic done in code), and a **curated bracket drawn strictly inside the knob's own domain**
(`app/core/samplers.ts:278`).

**A waveform and an easing are one menu.** Both answer *what shape does this parameter move
in*, so they are enumerated together (`app/core/samplers.ts:193`) and handed to the motion
Choice through its single channel — `requests.ts` never learns what a waveform *is*. An easing
id is prefixed `ease:` so a committed answer names its roster without any code parsing the
string (§4.2). **Which easings are offered is read two ways, and neither is a name:** the
coordinate's `motion` word selects FAMILIES through the one feeling table (§6.1), and the
curve's own SAMPLES say whether it is a one-shot move, an overshoot or a cycle
(`app/core/rosters.ts:335`) — a monotonic ramp held forever is not `driving` movement, and a
curve the exporter could not resolve has no readable shape and is withheld rather than guessed
at. The bracket is the performer's *operating window*, not an output
range: without it an oscillator is free to swing a knob across its whole declared span, which is
the "the motion looks broken" failure the bracket exists to prevent. It serialises as the slot's
`ranges`, which the consumer recalls **before** `params` — a value restored before its bracket
is a value clamped by a stale one.

**Four read modes, chosen by what the app file itself offers** (`app/core/rosters.ts:8`):
`require()` for a file that already exports; a `vm` context with a `window` shim for an IIFE
that assigns a global; a JSON artifact the app itself generates; and — for a value that is
module-local with no export at all — a **named-literal source read**, which re-reads the real
file every run so it cannot silently drift, and fails loudly if the literal is renamed.
**Whatever is unreadable is REPORTED in `missing`, never defaulted to a transcription** — a
sampler with no roster emits no options for that stack.

**THE ROSTER BUNDLE — mode 3, and Mode 2 is now fully RETIRED.** Mode 4 used to serve two
values that had no export anywhere: the LFO waveform bank and the per-card raymarch-op
uniform prefix. Both are now EXPORTED by the app's own roster exporter into
`user-media/shapes/rosters.json`, together with the **easing library, each entry carrying its
family, its label, the declarative definition the app's own resolver switches on, and its curve
SAMPLED at 65 points of t ∈ [0,1] by that same resolver** — and, under `.shared`, the resolved
descriptor rows for the raymarch shading-op roster, the mesh-material roster, the light-rig
roster and the layer canon's background/fill mode lists, each one **byte-equivalent to what
evaluating the app's own IIFE used to produce** (verified field-for-field before each switch).
Those four Mode-2 reads are RETIRED — including the two sibling canons
(`_point-line-texture.js`, `_texmapping-canon.js`) `_mesh-material.js` used to need seeded in
purely so its IIFE would run — because the export now carries their resolved output directly.
**`layers` was the last of the four; `readWindowGlobal` (Mode 2 itself) has no remaining
caller and is deleted with it.** `_layer-canon.js` also declares a slot-host role table
alongside `BG_MODES`/`FILL_MODES` — the window-global read never touched it (no reader in
this repo ever did), so the export does not carry it either; nothing here lost a value it
used to have. The warp-op roster (`ops`) deliberately STAYS on Mode 1 (`require()`, the preferred
mode): it already exports `DESCRIPTION` on every entry directly, and `INJECTED_OP_NAMES` — the
set `mathops` filters to — has no counterpart in the bundle at all, so switching would drop
data rather than simplify a read. The composer reads the bundle
(`app/core/rosters.ts:206`) and the old named-literal reads for waveforms/easings/prefix are
**deleted, not kept as a fallback** — a fallback would let a stale or absent export pass
unnoticed, which is the one thing the loud failure was protecting. An absent bundle is reported
under every roster that needed it (now including `material`, `lighting`, `raymarchInputs`), so
`missing` names which MENU is empty rather than merely which file is. One named-literal read
remains — the literal auditor's shared role table — and it is the same finding, still open.

The bundle records the **sha256 of every app source it was read from**, and those hashes
surface as `Rosters.provenance` (`app/core/rosters.ts:97`), so a composition can name which
export it was composed against. A stale bundle is then a detectable fact rather than an
invisible one — which is §5's obligation applied to the composer's own inputs. Where the bundle
lives is configuration, exactly as the descriptor index is (`app/server/config.ts:84`,
`JEV_ROSTERS`).

### §9.1 Menu-buried enums — a 4th `shared.*` shape

A named snapshot field can carry an enum without ever riding an ordinary `INPUT` descriptor —
`scaleMode`, `sliderBlend`/`groupBlend`, `opActive.sdf` (a membership set keyed by this
roster), `card.clock.source` — the app's preset walk persists all four, but none of them is a
`RosterInput`/`OpInput` row (`agent-reports/menu-state-inventory.md`, operator RULING
2026-09-19 23:19: *"all of the enum stuff buried in menus — absolutely need that functionality
for presets and designing shaders"*). `shared.menus` is the export's answer: an array of
`{key, home, source, values:[{id, label, description?}]}`, read into
`Rosters.menus:Record<string,MenuDescriptor>` keyed by `key` (`app/core/rosters.ts`
`need('menus', …)`).

**Composability is gated PER VALUE, not per menu** — `composableMenuValues(menu)` is the ONLY
door, returning the description-bearing subset; a partially-lifted menu (some values sentenced,
some not) is the expected shape, exactly like a partially-lifted `RosterInput` roster (§8.1). No
sampler ever reads `menu.values` directly.

Each space rides the stack its meaning belongs to, never a card-level global:

| Space | Rides | Gate |
|---|---|---|
| `scaleMode` | the `shape` stack, as an extra drawn param alongside the record's own knobs | `record.supportsScaleMode` (`records.ts`) — an explicit flag when the app ever emits one, else route-membership in the canvas-upload substrates (WASM/P5J/PEN/LOT) the inventory names. **No record in the current shapes index (raymarch/mesh/either routes only) ever satisfies this** — an honest, measured absence, not a bug: `scaleMode` belongs to canvas-upload cards this index does not carry any of. |
| `sliderBlend`/`groupBlend` | a per-KNOB attribute (`params[knob.key + '.blend']`), drawn independently of the knob's own value, for every `StackKnob`-based draw (`shape`/`mathops`/`shade`/`material`/`lighting`) | `composableMenuValues(rosters.menus['sliderBlend'])`; absent when empty, never defaulted to `'normal'` |
| `opActive.sdf` | the `mathops` stack's own membership picture, as a bounded SET (`params['opActive.sdf'] = {<opKey>:1, …}`, same shape as `sampleFx`'s post-pass chain) | `records.ts admitsMarching(record.route)` — the same marcher-only gate `shade` uses. The real app snapshot nests membership under a term id (`card.opActive.sdf = {<termId>:{<opKey>:1}}`); a record descriptor alone carries no term identity, so what this repo emits is the flat set — the term-nesting is a named follow-on, not built here. |
| `card.clock.source` | a per-bind attribute (`bind.source`) inside `modulation`'s sampled binds, beside the waveform/easing each bind already carries | `composableMenuValues(rosters.menus['clock.source'])`; absent when empty, never defaulted to `'internal'` |

**No new carrier was needed for any of the four.** Every one is written into the SAME
`LookCandidate.params` bag every ordinary knob value already rides — `resolveLook`'s lookup
(§4.2) and `jobs.ts commit()`'s `draft.stacks[stack] = {lookId, params:clone(look.params)}`
already clone `params` verbatim into the composed `CompositionDraft`. A menu pick reaches the
receipt and the composed snapshot the instant the sampler writes it; there is no separate
"render the preset" step this repo owns that would need a second wiring pass.

## §10 Locks and regenerate-unlocked

**Not built here yet; this is the rule it must satisfy when it lands, so that nothing else is
designed against a different one.**

A composition may carry **locked** members — a knob, a stack, or a whole composed unit the
operator has decided is finished. The contract:

1. **Locked content is byte-identical before and after any run.** A regenerate asserts that,
   rather than trusting it: content that was protected and came back changed is a failure of
   the run, not a merge to reconcile.
2. **Regenerate touches the unlocked only.** The unit of re-composition is the same
   `(record, tag)` unit; unlocked stacks are re-sampled and re-asked, locked ones are carried
   forward untouched and are never put on a menu.
3. **A lock is state, so it is persisted with the artifact** and rides the same save/recall path
   the composed values do. A lock that vanishes on recall is the same hole as a receipt that
   does.
4. **Deterministic edits never reach the model at all** (§11). Toggling a lock, renaming a slot,
   clearing a stack — these are code, and asking a model to do them would be asking it to pick
   from a menu of one.

## §11 What the model is NEVER asked

| It is used for | It is NEVER used for |
|---|---|
| picking ONE complete, concrete, pre-validated option from a menu code built (Choice) | writing or generating text, GLSL, JS, JSON, or any artifact |
| grading a situation onto an ordered ladder of named situations (Score) | counting anything, or any arithmetic |
| answering a yes/no about a described state (Noul) | ordering dates, or any recency comparison |
| | **judging a render** — it has no image input; it cannot see a card, a thumbnail, a frame, or a screenshot |
| | measuring geometry or layout |
| | deciding anything a deterministic rule already decides correctly |
| | supplying a string that any code path then interprets (§4.2) |

Three consequences worth stating outright:

- **Accuracy falls with irrelevant state.** Every call sends the minimum, filtered in code:
  descriptors only, never a whole file, never a whole corpus (`app/core/requests.ts:17`).
- **Typed ≠ correct.** A Choice cannot invent an option outside the submitted set, but it can
  pick the wrong one. Type safety bounds the OUTPUT SHAPE, never the judgment.
- **Adversarial text can steer it.** Anything read from a third party's source comments is
  exactly the text most able to say "ignore the criteria", and is held to an adversarial set.

**And the honest ceiling.** Code guarantees bounded menus, valid candidates, correct
persistence, finite jobs, parseable artifacts, and a refusal that names its reason. It cannot
guarantee that a composed look is *good*. A look whose every knob sits at its default is valid
structurally and fails the eye. Structure, determinism and protocol are testable; **taste is
not** — so the human judges, on a rendered card, and the model is never asked, because it
structurally cannot answer.

## §12 The versioned unit

**Provider id + model pin + question roster + prompt-template version + candidate-map version +
thresholds are ONE versioned unit.** Changing any of them bumps its version and re-runs that
roster's labeled set.

| Version | Home | Moves when |
|---|---|---|
| `ROSTER_VERSION` | `app/core/axes.ts:23` | any axis, question text, prompt-version id, position, role or feeling table changes |
| `CANDIDATE_MAP_VERSION` | `app/core/candidates.ts:32` | the SAMPLED SHAPE moves — a new stack, a new roster source, a changed role→axis placement, a changed id form |
| the model pin | `app/server/config.ts:57` | per provider; never `*-latest` in a run whose receipts are meant to be compared |

Every receipt stamps all three plus the returned model string, so neither a changed prompt nor a
changed provider is an invisible change — and a receipt whose candidate map cannot be
regenerated is a receipt that cannot be audited.

**A threshold does not transfer between providers — NOR BETWEEN MENU WIDTHS.** `confidence` is
distribution concentration, a property of the model rather than of the question, so two
providers answering correctly can be systematically differently concentrated. **And measured, it
is a property of the arity too:** the local runtime's own temperature table sets one value for
3–5-option menus and another for 11+, so on one state a 5-way Choice answered **correctly at
confidence 0.0318** while a 12-way answered at **0.8044** — the wider menu looking eight times
more confident because of a temperature row, not because of evidence. The 8-way form of the same
question on the same state returned a *different* answer at 0.28.

**So a threshold row is keyed by `(providerId, arity bucket)`, never by provider alone**, and it
is produced by replaying *our own* labeled set against that provider. A band read off a
mixed-arity population is read off a temperature table by accident. **A DECODE provider gets no
threshold row at all** (§3.1) — its number is not a confidence, so there is nothing to cut.

**Until those rows exist, selection is trusted and confidence gates nothing.** A run records
`confidence` in every receipt and no band arms on it. That is a stated posture, not an
oversight; see `docs/PLAN.md` §2.

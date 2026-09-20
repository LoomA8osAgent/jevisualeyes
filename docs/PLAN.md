# THE PLAN — increments, risks, and what this retires

> The build sequence for this repository. The *contract* is `docs/COMPOSER.md`; this file is
> the order things get built in, what each one owes as proof, and the three things that decide
> whether it lands. Self-contained: nothing here depends on a private tree.

**Proof tier is LIGHT throughout unless a row says otherwise.** The kernel is proven by its own
suite, the consuming app's preset save → hydrate → recall path is a known-good path, and these
increments **add content to it**. Paths and seams, not suites: a known-good path is not
re-proven, a seam is tested once at the seam, and testing on a path resumes only when a problem
is found on it. A phase gate applies — no increment N+1 before N's acceptance is green.

**The product arc, so the name is not mistaken for the ceiling.** Preset composer (I1–I7) →
brick composer (I8) → the same composer loop throughout. The menu widens from *which look for
this record* to *which node goes in this slot*; the loop, the receipts, the validation and the
provider never change. "Preset composer" names the first increment, not the destination.

---

## §1 The increments

| # | Increment | Acceptance — the ONE thing | Status |
|---|---|---|---|
| **I1** | **Strip the inherited domain; rename the types.** Delete the domain core files, the web tree, its routes, schemas, fixtures and prompt files, the launcher and the browser E2E rig; split `types.ts` into the decision half (kept) and the domain half (deleted); keep `canon` · `hash` · `selection` · `validate` · `db` · `jobs` (shape) · `provider` · `config`. | `npm run typecheck` clean **and** the surviving unit suite green — the seam is that the kernel still compiles and behaves with the domain removed. | **LANDED** (`12b59a4`) |
| **I2** | **Providers.** The endpoint becomes configuration; `local` is the loopback reference runtime and the default; `fixture` is the planted-map provider; `jev` sits behind a key. The validation tightens to the strict argmax rule and the fixed 1e-3 sum tolerance (`docs/COMPOSER.md` §4.1). | ONE live call through the client to the local runtime, answered and validated — **plus** the fixture leg planting a bad answer (probabilities summing to 1.8, a `choice` outside the submitted set) and the client **refusing** it with both reasons printed. *A validator that has never refused is indistinguishable from one that cannot.* | **LANDED** (`12b59a4`) |
| **I3** | **Record descriptor → candidate looks. Code only, no model.** The per-stack samplers: seeded, N complete looks per stack from a coordinate, each with a stable id and one readable line. Reads the shared rosters and the record's own inputs; transcribes none of them (`docs/COMPOSER.md` §9). | ONE node check on ONE record: every sampled value inside its knob's `[MIN, MAX]`, ids stable across runs at the same seed, descriptions non-empty, and the skipped set an EXACT match for the descriptor's non-composable knobs — falsified once by handing the guard a bound-violating look and requiring it to throw. | **LANDED** (`12b59a4`); **roster reads EXTENDED** — the two named-literal reads I3 shipped as a reported finding are replaced by a read of the app's own exported bundle, which also brings the easing library into the movement menu (below) |
| **I4** | **The smallest end-to-end composer over I3.** The phase machine swapped: given tag → sample → motion Nouls → a bounded accept/resample per stack → assemble one snapshot. Reduced **by choice**, to prove the whole loop with the fewest moving parts — nothing is blocked. | ONE record, ONE tag, fixture provider, end to end → a composed snapshot on disk with its receipts, and a re-run from the stored responses at the same seed producing a **byte-identical** snapshot. | **NEXT** |
| **I5** | **Receipts → provenance, and write through the consuming app's own path.** `generation.provenance` on the snapshot, the coverage-sweep row for that new field in the same commit, one provenance-chain append, and the write going out as the app's own preset-bank POST, read back and asserted identical. | The user-path macro `jev.composed-preset-loads`: Library → click the record → card delivered → open its preset row → recall the composed slot → params, active op sets and binds all arrive and `generation.provenance` survives the round trip. Fixture provider; assert the EFFECT, settle on content identity. | planned |
| **I6** | **Axes + N-way + CALL 3 — the full pipeline** (`docs/COMPOSER.md` §7): the eight axis Choices (`shape`/`mathops`/`shade`/`layers`/`fx`/`modulation`/`material`/`lighting` — the last two added by the material/lighting stacks, one axis each, no new axis-table growth), the N-way per-stack look pick, the waveform Choice and the rate Score, with CALL 1's sub-questions chunked at ≤ 6 per request. | I5's macro again, run against the local provider with the full pipeline — plus a capability leg: pointed at a provider whose export caps the option slot, the run **reports a capability refusal naming the cap** and neither crashes nor degrades silently. | planned |
| **I7** | **Bake the corpus** — 495 records × 4 tags: the run, its concurrency, its resume, its report. | The run completes and the report **names every skipped record and why**; a spot sample of composed slots loads through I5's macro. | planned, gated on the sentence lift (§2 risk 1) |
| **I8** | **The brick composer** — the menu widens to *which node goes in this slot*, and the answer composes a **new record** rather than a preset for an existing one. The model still writes no GLSL: it picks a node id from a closed set and the emitter writes the shader, which is the only reason a composer of shaders is expressible in a decision model at all. Output is emitted as ISF2 (<https://github.com/LoomA8osAgent/ISF2>) and appends its per-node receipts through the standard's own provenance call. | One composed tree, fixture provider → the emitted output passes the standard's validation and a compile, the tree's JS evaluator agrees with the marched field at a sample of points, the knob-derivation tool mints its inputs, and the record loads through the ordinary Library path. Falsified once by composing a tree whose conservative Lipschitz bound is out of range and asserting the enumerator **never offered it**. | blocked on two things, §1.1 |

**The roster read, closed where I3 left it open.** I3 shipped two values — the LFO waveform
bank and the raymarch-op prefix — read by lifting a named literal out of app source, and
REPORTED that as a finding rather than working around it: both were canon a second consumer
needed and neither was exported. The app now exports them, with the **easing library** beside
them, and the composer reads that bundle (`docs/COMPOSER.md` §9). Three consequences worth
stating as status rather than leaving to be rediscovered:

- **The old reads are deleted, not demoted to a fallback.** An absent or stale bundle is
  reported under every roster that needed it; a fallback would have made exactly that
  invisible.
- **Easings joined the movement menu**, which is what the export was worth: a waveform and an
  easing both answer *what shape does this move in*, so `modulation` draws from one roster and
  the motion Choice offers one menu. `ROSTER_VERSION` and `CANDIDATE_MAP_VERSION` both moved
  (§12) — the menus changed and so did the sampled shape.
- **What is still open is the same finding, one value smaller:** the literal auditor's shared
  role table is still read by name out of app source, and would still be better exported.

---

### §1.1 What I8 is blocked on, both nameable today

1. **The brick half of the descriptor debt.** A node kind is only pickable if it has a situation
   sentence ("a rod between two points", "a ring", "a spike or stellation cap"). This half is
   **small** — ~20 node kinds plus the join modes, not 3,844 knobs — but it is the same
   obligation as §2 risk 1 and it must land as **data the composer reads**, not as prose.
2. **There is no valid-composition enumerator today.** The node vocabulary exists only as the
   two walkers' `switch` statements in the consuming app — a list a human reads, not a menu a
   composer can enumerate. **Writing that enumerator is the first half of I8**: a catalog of
   node kinds with their arity, their legal children, their param roles and their situation
   sentences, *derived from the walkers so it cannot drift from them*. Its validity oracle
   already exists — the conservative Lipschitz bound — so a tree that would make the marcher
   overstep is **rejected before the model ever sees it**, which is `docs/COMPOSER.md` §1's
   validity-is-the-generator's-property rule at the tree level.

---

## §2 The three risks that decide whether this lands

### Risk 1 — the descriptor debt is the real critical path, and it is content work, not code

A situation sentence per knob is the gate on composability (`docs/COMPOSER.md` §8): *a knob with
no situation description is not composable, and the run refuses it rather than guessing.*
Measured over 495 records and 3,844 knobs: **the mechanical half of the lift has landed.** As
of the 2026-09-19T10:00Z descriptor, **1,479 knobs (38.5%) carry a situation sentence, across
278 of the 495 records** — up from zero, because the meanings already existed as comments
beside each input in the record *sources* and the converter that generates the descriptor had
been emitting `DEFAULT / MIN / MAX / LABEL` only.

**What is left is the part that is not a lift.** The census by bucket (A 210 · B 1,325 · C 408
· D 1,901) is in `docs/COMPOSER.md` §8.1: A + B = 1,535 is what has now largely landed, the
1,901 in bucket D are covered by **one shared role table in a single edit**, and **408 is the
number that actually needs new prose.**

**What closes the remainder:** a derive lane proposing a sentence per knob from what the record already
carries — the input's own source comment first, then the role gloss, then the label, the family,
the knob's role in the formula, and its measured bounds and their stated reasons — **reviewed
and corrected by the operator one family at a time**. The model cannot write them (it generates
nothing), so this is authored content with machine assistance, never a bake step. Each proposed
sentence carries its provenance tag, and `proposed` is review state that the bake refuses
exactly as it refuses an absent sentence.

**The triage oracle that makes the authoring affordable — a per-knob delta sweep, as a NEW
tool.** Rendering a record once per knob at two settings and measuring a mean per-pixel delta
with a top-5% escape plus a same-direction cosine yields three things no assertion list can:
**(1) a dead-knob list** — under threshold means a knob that does not visibly do anything, and
*a dead knob does not need a sentence authored, it needs to be skipped or removed*, which is
what turns "author 3,844 sentences" into "author the ones that visibly do something";
**(2) a redundancy matrix** naming which knobs are one function, so the sampler draws a
redundant family once — the mechanical answer to "twelve individually plausible values are an
incoherent look"; **(3) a strength ranking**, so the lane authors in descending visible effect.
It ships as a *new* script and never as an edit to the existing portrait verifier, which is
portrait-scoped by construction and must stay so.

**Not adopted, recorded so no later lane re-proposes them:** a no-reuse novelty gate (a
composer's whole job is recombination; a no-reuse rule over 1,980 compositions is incoherent);
render-measuring thresholds as *format* rules (they need a GL context and they measure the work,
not the file); "every slider a completely different function" as a sampler constraint (a
record's knobs legitimately include correlated families — use the measured redundancy matrix);
mapping narrative/affect prose onto axes (`docs/COMPOSER.md` §6.1); and unifying the
presentation accordion set with the sampling stack set (they legitimately cross-cut).

### Risk 2 — calibration, not capability: a band is PROVIDER *and* ARITY specific

The local provider answers every question shape the pipeline needs. What it does **not** yet do
is answer them at a confidence anyone may cut on. Measured: a **5-way Choice picked correctly at
confidence 0.0318**, and a **12-way looked sharp at 0.8044** — because the vendor's own
temperature table flattens one arity and sharpens the other. *Two menus, one state, a different
answer, and the wider one looks more confident.*

**Consequence, stated as a posture rather than discovered later:** picks are **argmax /
advisory only** until a labeled set of our own — records picked by a resolver, never by name,
and labeled by the operator in one pass against a rendered card — gives measured bands, **keyed
by `(provider, arity bucket)`** (`docs/COMPOSER.md` §12). I4 and I6 therefore ship composers
whose *selection* is trusted and whose *confidence* is recorded but gates nothing.

### Risk 3 — the brick composer needs an enumerator that does not exist

§1.1 item 2, restated as a risk because it is the one item in this plan whose size is not yet
measured: there is no grammar object, no node catalog, no structural validator and no generator
of legal trees. Until the enumerator is derived from the walkers, I8 has no menu to build — and
a hand-written catalog beside the walkers would drift from them on the first node added, which
is why "derived from" is the requirement rather than "matching".

### The eye — landed as a typed input, not yet read by any increment

`core/look-verdict.ts` (2026-09-20) is the composer's read of the video verdict pipeline that
landed in the sibling `~/gits/visualeyes` repo the same day (`docs/COMPOSER.md` §5.1;
`agent-reports/video-pipeline-v1.md` in that repo). It touches **I5** — the receipt/provenance
increment, whose `CompositionDraft.stacks[stack].lookVerdict` field this adds as an OPTIONAL,
ADDITIVE carrier — and it is a REPORT-ONLY seam: nothing in I4 through I7 writes that field or
reads `judgeAgainstCoordinate`'s output yet. It is here so I5/I6 have a typed target to write
into when a bake starts watching its own rendered output, not because either increment consumes
it today.

**And one smaller risk, recorded so it is not discovered at I7:** the bake writes to the
consuming app's preset-bank endpoint, which is last-write-wins over the whole bank body, while
the operator may have the app open on the same source. A bake run and a live card saving the
same source would silently clobber one another. The rule belongs in the runner: **the bake
refuses to write a key whose card is live**, established by reading the bank back and comparing
before the write — the same read-back I5 already performs.

---

## §3 What this retires

**In the consuming project:**

- **Hand-authored per-record preset banks.** 495 records × 4 coordinates is 1,980 banks; the
  reason records ship with empty slots is that nobody can author that many. Anything
  hand-authored that this supersedes is **deleted, not left beside it** — the scope to name at
  I7, enumerated from the store at that time.
- **The standing intention to "write a bake composer."** It has an executor and a repo; a second
  design for the same job is not opened.

**In this repository, at I1 — already done:**

- the browser studio and its route API, and with them the idea of a UI here, retired *before* it
  was built: a page in a tool repo showing the app's controls would be a hand-rolled host with a
  curated CSS subset, which is a known three-hour failure shape, and the composed preset is
  reviewed on a rendered card in the app anyway;
- a duplicate `.mjs` twin of the kernel — a second implementation on arrival;
- the separate prompt-template files: the roster is the one versioned home for question text,
  and two homes for one question is how a question changes invisibly;
- the **inferring** fixture provider, in favour of the planted-map one (`docs/COMPOSER.md` §3.2);
- the consumer-app launcher, the handoff integrity manifest, and the browser E2E rig.

**Nothing else.** In particular the SQLite journal, the TypeScript kernel and the strict
validator are **not** retired. The journal holds pending payloads, attempts, receipts and events
so a bake is resumable; it is never read by the app, never a preset store, and never a second
home for anything the app owns — composed output leaves it immediately and lands through the
app's own write path.

**Why the TypeScript kernel stays.** The consuming app's "no build step, no bundler, no
framework" law binds the *application*. It has never bound node tooling, which already runs
plain JS, spawns servers, and uses whatever node gives it. A tool that reuses a working, proven
kernel is reuse; rewriting it to satisfy a rule about the app would be breaking working code for
nothing.

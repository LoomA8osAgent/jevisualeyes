# jevisualeyes

![How jevisualeyes composes a preset: tag → axis coordinate → what moves → sampled complete looks → one pick per stack → motion binds → preset + receipts → repeat / regenerate unlocked](docs/decision-pipeline.svg)

**Prompt-first preset composer for fragment shaders.** Describe a look in one sentence — *"slow organic, cool palette, two folds"* — and a decision model (not a text generator) picks every choice from menus the code built: which axes the look sits on, which of the sampled complete looks each stack takes, what moves and how. Code renders the picks into a preset for an ISF fragment-shader record and its control stacks (ops · raymarch/shade ops · layers · FX · modulator binds). Every knob in the result traces to a persisted decision receipt, a labelled fixture, or a manual edit.

**Local model first.** The default provider is an open-weight decision model running on this machine over the `/v1/systemone` wire on loopback — no key, no network, no telemetry ([Laya](https://huggingface.co/convaiinnovations/laya) via [von](https://github.com/wfzyx/von) today). TypeSafe's Jev is an optional remote provider, never a requirement. The open reproductions of Jev are tracked here: **https://huggingface.co/spaces/multimodalart/jev-reproductions-tracker** — trained scoring heads (calibrated) are the only class that may arm a threshold; logit-reading LLM replicas serve the argmax only.

**Status: the domain swap has landed (increments I1 + I2).** This repository is an MIT
fork of [cocktailpeanut/jevthoven](https://github.com/cocktailpeanut/jevthoven) — a music
composer on the same principle. **Upstream is MIT and its notice is preserved verbatim and
first in `LICENSE`.** What changed: the upstream domain was removed whole — its own
subject matter, its React editing UI and audio stack, its 30-route Express API and its Pinokio
launcher are all gone — and replaced with preset composition for the A8os shape corpus.
What was KEPT is the reason for the fork: the composer loop, the receipt and provenance
discipline, the fixture-provider posture, strict response validation, and the resumable
single-runner job engine. **The upstream author's own design documents are preserved
unmodified under `docs/upstream/`**, including his limitations doc; they are the
attribution trail and they are evidence, and they are never edited in place. This is an
offline author-time tool, not a shipped product: it has no UI, no server to visit, and
nothing it produces runs in a browser here.

Design: `specs/ai/jev.md` (the judgment layer) and `roadmap/jevisualeyes-rework.md` (this
rework, file by file) — both in the A8os repository.

---

## The engine

What survives the swap, and what each piece does now.

| Piece | File | Role |
|---|---|---|
| deterministic canonicalization | `app/core/canon.ts` | key-sorted JSON with a depth cap, a cycle check and an unsafe-key guard — what makes a request hash and a candidate hash mean something |
| content hashing | `app/core/hash.ts` | `sha256(canonicalJSON(v))` |
| selection policy | `app/core/selection.ts` | the provider's own pick (`model`), or seeded sampling from the validated distribution (`sample`), so the same stored responses and the same PRNG state replay exactly |
| strict validation | `app/core/validate.ts` | the three primitives, and two ruled divergences from upstream: the argmax rule is **strict**, and the probability-sum tolerance is **fixed at 1e-3** |
| the axis roster | `app/core/axes.ts` | coordinates, not names. Six axes — motion · density · contrast · warmth · order · depth — and the question text, versioned beside the menus it belongs to |
| request builders | `app/core/requests.ts` | one builder per decision kind. It samples nothing: candidates arrive as arguments, because code enumerates and the model only picks |
| the providers | `app/server/provider.ts`, `fixture.ts` | one HTTP adapter serving both the local runtime and the remote endpoint over the same wire, plus a planted-map fixture that is TOLD what to answer and never infers |
| the spine | `app/server/jobs.ts` | persist the exact pending payload → call → validate → select → **one durable transaction** → receipt, with an epoch guard, bounded retry, a request ceiling that pauses rather than fails, and boot recovery that never auto-resumes spend |
| the job journal | `app/server/db.ts` | SQLite (`node:sqlite`, no native module) holding pending payloads, attempts, receipts and events so a run is resumable. It is a journal, not a store — composed output leaves it immediately |
| the entry | `app/server/index.ts` | a CLI. `runUnit(composer, record, tag)` composes one unit; `status` reports what a run would do right now |

The **composer** — what to sample and what to ask for a given record — is the domain half
and is deliberately not in the spine: it is injected, so the samplers and the runner can
never drift into each other.

## Requirements

- Node.js ≥ 22.16 (for the built-in `node:sqlite`).
- A decision provider. The default is **local**: an open-weight decision model on this
  machine over the `/v1/systemone` wire, bound to loopback — no key, no account, no
  network. The remote endpoint is opt-in and needs the operator's own key.
- Nothing else. There is no build step, no bundler and no browser here.

## Run it

```bash
cd app
cp ../.env.example .env      # every key is optional; the defaults are loopback-only
npm install
npm start                    # `status` — the provider, the model, the journal
```

```bash
npm run typecheck            # strict TS
npm test                     # the kernel suite — no network, no model
npm run smoke:fixture        # the whole seam end to end on the planted-map fixture
npm run test:live            # ONE billable remote call; needs LIVE_JEV=1 and a key
```

## Data and privacy

Everything is on this machine. The default provider is local and bound to `127.0.0.1`;
the remote provider is opt-in, called directly from this machine, and its key is read
from the environment or a `0600` settings file — never from a file in this repository.
There is no telemetry, no account, and no server to run. A run that used the fixture is
labelled `synthetic` in every receipt it wrote, and that label is never laundered.

## Licence

MIT. `LICENSE` carries the upstream MIT notice verbatim and first, with the copyright for
the new work appended beneath it.

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
| **I4** | **The smallest end-to-end composer over I3.** The phase machine swapped: given tag → sample → motion Nouls → a bounded accept/resample per stack → assemble one snapshot. Reduced **by choice**, to prove the whole loop with the fewest moving parts — nothing is blocked. | ONE record, ONE tag, fixture provider, end to end → a composed snapshot on disk with its receipts, and a re-run from the stored responses at the same seed producing a **byte-identical** snapshot. | **LANDED** — `npm run compose:fixture` + `tests/compose.test.ts`: subject resolved (never named) to `aizawa-attractor-tube` at `motion:pulse density:busy contrast:hard warmth:cold order:regular depth:deep`, seed 1743, 2 fixture calls (motion Nouls, then the 6-stack looks bundle) → 9 receipts, snapshot `7aff5d6a0408ad40…`, replayed from the stored responses through `ReplayProvider` to the same sha256; the accept check and the resample cap each falsified once |
| **I5** | **Receipts → provenance, and write through the consuming app's own path.** `generation.provenance` on the snapshot, the coverage-sweep row for that new field in the same commit, one provenance-chain append, and the write going out as the app's own preset-bank POST, read back and asserted identical. | The user-path macro `jev.composed-preset-loads`: Library → click the record → card delivered → open its preset row → recall the composed slot → params, active op sets and binds all arrive and `generation.provenance` survives the round trip. Fixture provider; assert the EFFECT, settle on content identity. | **LANDED** — `jev.composed-preset-loads` GREEN on an isolated clone (:8471): the resolver picked `assay-knot-tube`, the composed slot was found in the card's own hydrated bank BY ITS PROVENANCE, a real click recalled it, and the card came back with 4/4 unbound declared inputs exact, 2/2 ops live (0 invented, 0 declined), the one bind live as an oscillator receiver with its bracket in `card.ranges`, and `generation.provenance` carrying 11 receipts + 1 chain entry — then re-saved through the `+` dialog into slot 2 at the same `unitSha256` |
| **I5.5** | **THE SHARED SHADING STACK — one composed look set that shades every model.** Not per-formula presets: the accordion the card labels SHADING (group `surface`) and exactly the children the code nests under it (`_groupParent: 'surface'` — color · palette · texture · material · lighting → light 1/2/3 · structure · edge) are emitted by the SHARED template, identical on every record, so ONE composed set is shipped through the app's existing factory-bank surface (`a8_sdf_factory_banks`) and every model inherits it at compose time with no rebake and no per-record bank key. Blend modes, bindings, per-slider presets and the marching accordion are OUT, each by a mechanical exclusion. | The user-path macro `jev.shading-factory-looks`: Library → click a model → the SHADING accordion's bank shows the composed top-level slots → recall one → the child banks are populated and a child recall CHANGES THE RENDER (pixel/effect, not display) → the same slots are present on a SECOND, unrelated model. Fixture provider, light tier. | planned |
| **I6** | **Axes + N-way + CALL 3 — the full pipeline** (`docs/COMPOSER.md` §7): the eight axis Choices (`shape`/`mathops`/`shade`/`layers`/`fx`/`modulation`/`material`/`lighting` — the last two added by the material/lighting stacks, one axis each, no new axis-table growth), the N-way per-stack look pick, the waveform Choice and the rate Score, with CALL 1's sub-questions chunked at ≤ 6 per request. | I5's macro again, run against the local provider with the full pipeline — plus a capability leg: pointed at a provider whose export caps the option slot, the run **reports a capability refusal naming the cap** and neither crashes nor degrades silently. | planned |
| **I7** | **Bake the corpus** — 495 records × 4 tags: the run, its concurrency, its resume, its report. | The run completes and the report **names every skipped record and why**; a spot sample of composed slots loads through I5's macro. | planned, gated on the sentence lift (§2 risk 1) |
| **I8** | **The brick composer** — the menu widens to *which node goes in this slot*, and the answer composes a **new record** rather than a preset for an existing one. The model still writes no GLSL: it picks a node id from a closed set and the emitter writes the shader, which is the only reason a composer of shaders is expressible in a decision model at all. Output is emitted as ISF2 (<https://github.com/LoomA8osAgent/ISF2>) and appends its per-node receipts through the standard's own provenance call. | One composed tree, fixture provider → the emitted output passes the standard's validation and a compile, the tree's JS evaluator agrees with the marched field at a sample of points, the knob-derivation tool mints its inputs, and the record loads through the ordinary Library path. Falsified once by composing a tree whose conservative Lipschitz bound is out of range and asserting the enumerator **never offered it**. | blocked on two things, §1.1 |

**What I4 landed, in the terms the row states them.** The phase machine is `UnitComposer`
(`app/core/composer.ts`): the tag COMPILES to a coordinate (`app/core/tags.ts` — a tag is a
coordinate in axis words, and there is no tag→name table, `docs/COMPOSER.md` §6), the motion
Nouls go out chunked at ≤ 6 per request (§7.1), the looks bundle goes out per stack, and every
committed look is re-read by `acceptLook` before the unit may finish — a rejected stack is
re-sampled at a perturbed seed at most three times and then the run REFUSES, naming the stack,
the count and the reason, rather than shipping the look its own check rejected. The unit is
written as an artifact carrying its snapshot, its sha256, its receipts AND the accepted
request/response of every call, which is what makes the re-run need no provider. **Reduced by
choice, and the reductions are named rather than implied:** CALL 1's axis Choices and all of
CALL 3 are I6 and are absent, not stubbed; `generation.provenance` and the app's own
preset-bank write are I5's; the resample counter lives on the composer instance, so a RESUMED
job starts its cap afresh — honest for a single-unit run and a thing I7's runner will have to
own when a bake resumes mid-unit.

**What I5 landed, and the one thing it MEASURED that changes I7.** `app/core/slot.ts` renders
a composed unit into the app's card-snapshot shape (routing each sampled key form — `<NAME>`,
`<NAME>.blend` → an INTEGER index read out of the app's own 30-mode roster, `opActive.<scope>`,
`postPassChain`, `bind:<NAME>` → an oscillator receiver plus its bracket in `ranges`), attaches
`generation.provenance` (§5), and `app/server/deliver.ts` writes it through the app's own
endpoint with a compare-and-swap against a live card and a read-back assertion. Two refusals are
exercised rather than described, and two things are refused by design: a movement the app's
easing library cannot express is DROPPED AND NAMED rather than defaulted to a curve that happens
to exist (CALL 3 is I6's), and slot `D` is never written.

⚠ **THE BANK KEY CANNOT BE DERIVED OFFLINE — measured 2026-09-20, and I7 has to plan around it.**
A record's card source is COMPOSED AT LOAD TIME and what it composes to depends on LIVE APP
STATE: the user palette store is emitted into the shader's palette roster, so adding one palette
changes the composed bytes and therefore the `src_<sha>` the bank is keyed by. An offline
derivation running the app's own compiler in node was built, run, and REJECTED by the app's own
key — `src_f644e2…` against the card's `src_80d395…`, a 212-byte divergence that was the palette
list plus one environment-dependent comment line. **It is deleted, not patched:** a writer that
guesses a key does not fail loudly, it writes a bank no card will ever open. The key now comes
from a REAL loaded card (`jev.composed-preset-key`, an input probe, not a proof) and is handed
to `deliver:fixture --key`. **For I7 that means a bake cannot key 495 records from a file** — it
needs either the app itself to publish a record→key artifact (the shape `rosters.json` and
`index.json` already have), or a browser in the loop. Naming it here so it is a design input
rather than a discovery at bake time.

**And one composer bug the app found for us.** `opActive.sdf` was emitted FLAT (`{<opKey>:1}`)
while the app normalises `{<termId>:[<opKey>…]}` with `Object.keys(v)` — so `Object.keys(1)` is
`[]` and EVERY composed op was dropped, silently, with the slot looking perfectly well formed.
It now nests under `root`, the app's own name for the whole record; `CANDIDATE_MAP_VERSION`
moved to v3 (§12 — the sampled shape moved), and a sampler test asserts the shape so a
regression fails a test rather than a recall nobody is watching.

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

### §1.0b I5.5 — THE SHARED SHADING STACK, composed once for every model

> Operator, 2026-09-20: *"i do NOT want to do a full formula bake set yet, first i want to see how
> it handles the default accordions that all formulas share, most importantly the shading stack -
> untangling all of the lighting/material/palette/structure combinations, without blend modes; ie:
> the top shader accordion needs a full set of presets, which has each of the children preset banks
> full for each of the top level presets, which will work to shade all models with as many possible
> combinations of looks with all of the children, and with no bindings as of yet, and leaving out
> individual slider presets."* · *"needs to also take into account all of the enums in the accordion
> menus!"* · *"no marching is necessary for shading!"*

**Why this increment exists and why it comes before I7.** I7 bakes 495 records × 4 tags and is
gated on the descriptor lift (§2 risk 1) and on the record→bank-key problem I5 measured. The
shading stack has NEITHER blocker: it is emitted by the shared template rather than by a record,
its 180 knobs already carry 180 situation sentences, and it ships through a factory surface that
needs no source key at all. It is the cheapest honest test of whether composed looks are any good.

#### The tree — MEASURED, by composing a record in node and reading its own header

**The accordion the card labels SHADING is the group `surface`** — `_groupLabel: 'shading'`
(`app/js/formats/_sdf-template.js:583`, and every relocated control takes the same label at
`:1352`). Its children are **exactly what the code nests under it**, read from each descriptor's
own `_groupParent` rather than from any list: seven direct children, one of which (`lighting`)
carries the three lamps. Nothing else is in scope, and two neighbours that look like they might be
are measurably NOT: `sub:form` declares `_groupParent: 'shape'` and `sub:bgtexture` declares
`background`.

`A8SdfTemplate.buildShader(record)` (`_sdf-template.js:11102`) emits the ISF header whose `INPUTS`
carry their final display `_groupId` and `_groupParent` (post-`_a8Taxonomy`, `:1327`). Composed
offline against `app/user-media/shapes/index.json`, the shading subtree is **identical on every
record that composed** — it is template state, not record state:

| group id | card label | `_groupParent` | knobs | menu rows | menu enums | `*Blend` (EXCLUDED) |
|---|---|---|---|---|---|---|
| `surface` | **shading** | — (top) | 12 | 7 | 0 (7 bools: the 6 layer switches + `lightingEnable`) | 1 (`stackBlend`) |
| `sub:color` | color | `surface` | 4 | 2 | 2 | 0 |
| `sub:palette` | palette | `surface` | 17 | 6 | 6 | 1 |
| `sub:texture` | texture | `surface` | 7 | 4 | 4 | 1 |
| `sub:material` | material | `surface` | 27 | 2 | 2 | 1 |
| `sub:lighting` | lighting | `surface` | 5 | 4 | 1 (+3 lamp-enable bools) | 1 |
| `sub:light1` / `2` / `3` | light 1/2/3 | `sub:lighting` * | 15 each | 5 each | 2 each (+3 bools) | 1 each |
| `sub:structure` | structure | `surface` | 56 | 15 | 15 | 2 |
| `sub:edge` | edge | `surface` | 7 | 3 | 3 | 1 |
| **total** | | | **180** | **58** | **39 enums + 19 bools** | **11** |

\* the lamp parent is VALUE-AWARE, not a constant: `_TAX_SUB_PARENT` / `_lampParent`
(`_sdf-template.js:1295-1305`) resolves to `sub:lighting` by default and to `surface` when that
lamp's own `lightNInStack` bit is set — the lamp-as-layer ruling. Either way it is inside SHADING.

**What the accordion does NOT contain, measured the same way — every one of these is a sibling of
SHADING or a child of something else, never a child of `surface`:** `marching` (label *render
fidelity*, 22 knobs — operator-excluded, and it was never nested here anyway), `sub:form` (label
*form* — render mode / shells / volume / slices; `_groupParent: 'shape'`, geometry per
`shading-stack.md` §3), `background` (3) + its own `sub:bgtexture` (`_groupParent: 'background'`),
`world` (113), `transform` (30), `shape` (the record's own math), `camera`.

⚠ **Exclude by DISPLAY group, never by the raw declaration.** The eleven layer channel/target picks
are DECLARED `_groupId:'marching'` at `_sdf-template.js:1082` / `:1088` and are RELOCATED into
their own sub by the taxonomy — they display and bank in `sub:structure` / `sub:edge` / `sub:color`
/ `sub:palette` / `sub:texture`, which is where the measurement above found them. An exclusion
written against the declaration would silently eat a third of the menu enums.

#### The menu enums are ordinary inputs, and they are already on the walk

A menu row is a descriptor carrying `_menuOnly: true` — *"ordinary declared INPUTs, so they ride
`card.params` and the preset walk with no new machinery (STATE-NOT-IN-PRESET-WALK)"*
(`_sdf-template.js:578-584`, the layer-bit generator's own header). Mechanically:
`card.js:3047-3056` indexes `byGroup` from `_groupId` with **no `_menuOnly` filter**, and the group
bank's `paramNames()` (`card.js:3287-3294`) unions those names — so every one of the 58 menu rows
is inside its accordion's scoped bank face today. **No hole to open.** Two consequences the
composer must respect:

- A scoped recall pushes enums without a rebuild, so the app resyncs its own triggers
  (`_cardSyncSelectTriggers`, `card.js:3300-3306`, against `SELECTOR-TRIGGER-STALE-ON-PROGRAMMATIC-CHANGE`).
  The proof macro therefore asserts the **effect**, never the trigger label.
- `structElemPalette` / `structGapPalette` enumerate **live app state** (the user palette store)
  and read `VALUES: []` offline — the same live-state dependency I5 measured on the bank key. The
  sampler treats an empty value space as non-composable and names it, rather than picking 0.

#### The banks — keying, answered from code

| question | answer | cite |
|---|---|---|
| numbered slots per bank | **11** (`'1'…'11'`) plus the derived `D` | `app/js/preset-bank.js:124` |
| a group bank's own persistence | `own:<parent SOURCE key>\|<bankKey>` in the disk-backed kv store | `preset-bank.js:1231-1246` |
| the parent source key | `src_<sha256>` of the COMPOSED source, resolved async | `card.js:6612-6636` |
| a derived sub bank's `bankKey` | `'group:' + groupId` (instance-free) | `app/js/modules/_mod-groupbank.js:334` |
| FACTORY slots (what ships) | `A8_GROUP_BANKS[<bank>].presets`, declared in the shared template's header | `_sdf-template.js:6137-6288` |
| the cross-record surface | `a8_sdf_factory_banks` — a disk-backed kv entry MERGED over the declared banks **at compose time**, so *"every record inherits instantly (no rebake — records compose at click)"* | `_sdf-template.js:6299-6321` |
| who writes it today | the ISF pane's `factory ▸ promote bank presets to factory` row, reading `card._groupBankStores` | `app/js/editors/isf.js:271-296` |
| proven already | four factory camera slots ship from disk and appear on a fresh compose of an arbitrary record | macro `sdf.factory-wander-reveal` (`design/nav-map-shards/ma3c-records.md:534`) |

**So the answer to "shade all models" is the factory surface, and it is NOT the source-keyed bank.**
A per-card bank is keyed by the composed source sha; 495 models means 495 keys, and I5 measured
that a key cannot be derived offline. The factory entry is keyed by BANK, not by record — one
write, every model, and the I5 key problem does not arise.

⚠ **ONE MECHANICAL GAP, measured, and it is the whole app-side delta.** The compose-time merge
refuses any bank key the header does not already declare:
`if (!header.A8_GROUP_BANKS[bk] || …) return;` (`_sdf-template.js:6315`). The declared keys are
`surface · transform · camera · shape · render · background · world` — the **ten `sub:*` children
are DERIVED banks** (minted per accordion by `_mountBankForSection`, `card.js:3156`), so factory
slots for them are written by promote and then **silently dropped at compose**. Two candidate
fixes, both small; this is decision-queue item 1:

- **(a) MINT ON MERGE (recommended — the shared home).** When a factory key is absent from the
  header, synthesise `{mountGroup: <key>, applyMode: 'scoped', presets: {}}` before merging. ~3
  lines at `:6315`, and it is self-maintaining for any sub minted later. The mount already treats
  an undeclared accordion as owning its own gid (`card.js:3182-3183`), so a declaration minted this
  way behaves exactly as the derived bank already does.
- **(b) DECLARE THE TEN.** Add `_neutralBank('sub:material','scoped',{})` etc. to the header block.
  Explicit, but ten hand-written declarations that a future sub will not join.

#### The nesting — what a parent slot carries today, and the honest limit

`_mountBankForSection` unions **every descendant section's gid** into the parent's owned set
(`card.js:3197-3202`, the S88 "bank where you are shown" ruling) and hands that list to
`paramNames()`. So:

- a `surface` slot **snapshots the children's VALUES**, flat — all 180 knobs including the 58 menu
  rows. It does not reference child slot ids.
- a child slot holds its own group's values only, and is independent.
- **child bank CONTENTS travel only on the CARD bank**, as the snapshot's `nestedBanks` field
  (`presetBank.collectNested` / `applyNested`, `card.js:5472` / `:6425`; proven by the macro
  `sdf.toplevel-preset-captures-banks`). There is **no** per-parent mechanism that swaps a child
  bank's ROSTER when a parent slot is recalled.

So the operator's *"each of the children preset banks full for each of the top-level presets"* has
two readings, and the difference is one of app machinery:

- **READING A — what ships with zero new app behaviour (recommended).** The factory carries ONE
  union: N top-level `surface` looks, each complete (every child's values, every menu enum), AND
  each child bank filled with its own 11 alternatives — a parts menu. Recall a look, then re-shade
  it by swapping one child (a different lamp rig, a different material, a different palette). Every
  top-level look is reachable from every child alternative; the child banks are shared across
  looks rather than owned by one.
- **READING B — a child roster PER top-level look.** Would require the `surface` bank to carry its
  own nested payload (a `nestedBanks` named field with an `applyNamedField` handler — the machinery
  exists at `card.js:3313-3325`, the fx-chain precedent, but has never been used this way). NEW
  behaviour; decision-queue item 2.

#### The combinatorics, stated honestly

11 banks in the subtree (`surface` + 10 children) × 11 numbered slots = **121 factory slots, the
hard ceiling**, of which at most 11 can be top-level looks. Under reading A: **11 looks × 10 child
axes × 11 alternatives = 1,210 single-swap variants**, and the full cross-product of child choices
is 11^10 — a number worth naming only to say that it is not a menu anybody browses. "As many
possible combinations" is bounded by 11 per axis, and the real design question is which 11 of each.
Under reading B the ceiling is unchanged; only the ownership of the child slots moves.

#### The composer side

| piece | today | this increment |
|---|---|---|
| stack ids | `shape · mathops · shade · layers · fx · modulation · material · lighting` (`app/core/types.ts:81`) | **+ `shading`** — one new id |
| what `shade` is | the 13-entry raymarch OP roster (`records.ts:150`, `_raymarch-ops.js`) — ops layered ONTO a look | unchanged; it is not this tree |
| what `material` / `lighting` are | the **mesh** rosters `A8MeshMaterial.INPUTS` / `A8Lighting.INPUTS` (`records.ts:153-154`), offered on mesh routes only | unchanged; the SDF card's `sub:material` / `sub:light*` are different knobs entirely |
| roster source | `app/user-media/shapes/rosters.json` `shared.*` — 8 rosters, **none from `_sdf-template.js`** | **+ `shared.shading`**, exported by `app/tools/export-rosters.js` from `A8SdfTemplate.buildShader` on a resolver-picked record, filtered to the 11 display gids, through the existing `pickSharedInput()` whitelist (`export-rosters.js:209`) |
| menu picks | `shared.menus` holds 4 entries (`scaleMode`, `sliderBlend`, `opActive.sdf`, `clock.source`) — none of the 39 | the 39 arrive as ordinary enum knobs inside `shared.shading` (`VALUES`/`LABELS` already on the descriptor), sampled as menu Choices per `docs/COMPOSER.md` §9 — no second roster shape |
| axes | `STACK_AXES` (`app/core/axes.ts:74`) | `shading: ['contrast','warmth','density','depth']` — existing axis words, **no new axis and no new axis option** |
| descriptor debt | I7's blocker | **none here: 180/180 knobs carry `DESCRIPTION`, measured.** The two live-state palette enums are the only non-composable rows and they are NAMED, not defaulted |

**The three exclusions, each mechanical:**

1. **Blend modes** — a skip list in `stackKnobs('shading')` on the descriptor's own NAME shape:
   the 11 `*Blend` rows plus `blendSource`. They are filtered out of the roster, so no sampler can
   reach them and no slot can carry them. (Not prose: the same filter shape `mathops` already uses
   for `_glyOpCompanion`, `samplers.ts:170`.)
2. **Bindings** — the `modulation` stack is absent from this increment's stack set, so no motion
   Nouls run and `slot.ts` emits no `bind:<NAME>` key and no `ranges` entry. The refusal is
   structural, not a flag.
3. **Per-slider presets** — the writer emits bank slots only; no `sliderPresets` / slider-author
   field is ever written. **Marching** is excluded the same way as (1): its 22 knobs are simply not
   in the roster, because the roster is filtered to the eleven shading display gids.

**The deliver delta — the smallest one.** `app/server/deliver.ts` today writes ONE card-bank slot
through `POST /api/preset-bank/<key>` with a handed-in key. This increment adds a **second
transport, not a second writer**: `POST /api/kv/merge` with
`{kv: {a8_sdf_factory_banks: "<json string>"}}` (`app/tools/dev-server.js:837-870`) — the app's own
endpoint, the app's own storage canon, per-key merge so no other kv key is touched. It keeps all
four of deliver's obligations verbatim: the app's own endpoint, no key derivation (there is no key
to derive — this is the win), read-build-read-again compare-and-swap against a live app promoting
its own slots, and read-back deep-equality after the POST. `renderSlot` (`app/core/slot.ts`) is
reused unchanged for the per-slot body; only the envelope differs (`{presets:{…}}` per bank key
instead of one card snapshot).

#### The proof — ONE macro, light tier

`jev.shading-factory-looks`, riding the user path end to end (`ACCEPTANCE-MACRO-BYPASSES-USER-PATH`):

1. Library → click a resolver-picked model (never an operator-cited file, never Strobosphere) →
   card delivered.
2. Open the SHADING accordion → its bank row shows the composed top-level slots, by name.
3. Click-recall one → **assert the EFFECT**: read the card's params for a sample of the look's own
   keys across ≥3 children (a material pick, a lamp type, a palette pick, a structure mode — enums
   included) and a `compositorDebugReadCardPixel` sample that MOVED from the pre-recall frame,
   consecutive-poll stabilised (`ONE-SHOT-VERIFY-SAMPLES-TRANSIENT-STATE`).
4. Open one child accordion → its bank shows the composed child slots → recall a different one →
   the pixel moves again while the look's other children hold.
5. Load a SECOND, unrelated model → the same factory slots are present on its SHADING accordion —
   which is the whole claim of the increment, and the only step that could not be faked by a
   per-record write.

No falsify leg, no preset gate, no identity proof, no corpus run: this adds CONTENT to the
known-good factory-bank path that `sdf.factory-wander-reveal` already proves.

#### Decision queue — only what code cannot answer

1. **The merge gap fix**: (a) mint-on-merge at `_sdf-template.js:6315`, or (b) declare the ten
   `sub:*` banks in the header. Recommended (a). *(App code — needs the operator's word and a
   builder lane; this plan writes none.)*
2. **Reading A or reading B** of *"each of the children preset banks full for each of the top-level
   presets"* — a shared parts menu (no new app behaviour), or a child roster owned per top-level
   look (a new `nestedBanks` named field on the surface bank).
3. **How many top-level looks**, 1…11. The ceiling is 11; the question is how many are worth
   authoring before he looks at them.
4. **Which child banks get filled first** — the four he named are `lighting` (with its three lamp
   subs), `material`, `palette`, `structure`; `color`, `texture` and `edge` are in the tree and
   could be held back.
5. **The proof subjects** — two models, resolver-picked, one march-route and one `either`-route.
   Never an operator-cited file; never Strobosphere.
6. **Whether the factory entry ships in the repo** (`app-config/kv.json` committed) or is written
   by the composer run on a machine. Shipping it is what makes the looks arrive for a user who
   never runs the composer.

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
before the write — the same read-back I5 already performs. **I5 BUILT IT (LANDED):** the
endpoint is last-write-wins over the whole bank BODY, so the writer reads the bank, builds the
merge, reads it AGAIN immediately before the POST, and REFUSES if it moved — a compare-and-swap,
because there is nothing to lock against a browser. Exercised, not described: a transport that
mutates the bank between the two reads must refuse WITHOUT a POST, and a transport that stores
something other than what was sent must refuse after the read-back.

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

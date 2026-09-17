# Reference contracts, not the finished app

`core.mjs` implements selected pure primitives and a small SMF test oracle. It does not implement the full planner, production provider adapter, job runner, frontend, or audio rendering. The build agent must integrate/extend it and run the application acceptance suite.

```bash
node --test tests/kernel.test.mjs
python tests/validate.py
tsc --noEmit --strict --target ES2022 --module ESNext --lib ES2022,DOM reference/contracts.ts
```

Run from the handoff root. Regenerate the synthetic JSON/MIDI examples with `node reference/generate_fixtures.mjs`; that script makes no network requests.

A single opt-in live call:

```bash
LIVE_JEV=1 TYPESAFE_API_KEY="YOUR_PRIVATE_KEY" node reference/live_smoke.mjs
```

Use a local environment file/secret manager in practice rather than storing a real key in shell history. The smoke command makes one request and does not retry. It validates the response format, not musical quality. No live run was performed for this package.

Sampling uses xorshift32 with shifts 13,17,5. Seed zero is normalized to 0x6d2b79f5. Candidate keys are lexically ordered for reproducibility. Saved provider distributions plus saved seed states replay; a provider's mutable model alias is not deterministic merely because the app seed is.

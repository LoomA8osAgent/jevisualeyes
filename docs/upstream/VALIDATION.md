# Handoff validation

Completed 17 September 2026. These results concern the supplied documentation/reference package, **not a completed browser application**.

| Check | Result |
|---|---|
| JavaScript reference tests | 48 passed; 0 failed |
| Schema, fixture, invalid-input, document, and SQL-sketch checks | 18 passed; 0 failed |
| TypeScript contracts, strict no-emit check | Passed |
| Reference module/CLI syntax | Passed |
| Live-smoke opt-in guard | Correctly refused without LIVE_JEV=1; no call made |
| Hand-authored MIDI export | Written and parsed by the reference oracle; fixture bytes match |
| Real Jev requests | Not run; zero calls |
| Browser application, audio rendering, hosted security tests | Not built/run by this handoff |
| Musical quality and live-model preference tests | Not run |

Runtime: Node v22.16.0; TypeScript 5.8.3; Python 3.13.5 with jsonschema.

Raw reports are in `tests/results-kernel.tap` and `tests/results-validation.json`. The MIDI parser is deliberately limited to the oracle's event subset; independent application-library/player interoperability testing remains a build-agent requirement. The SQL check covers schema constraints and rollback, not a finished resumable job runner.

All example music, response probabilities, token counts, and receipts are explicitly synthetic. No provider credentials, vendor model weights, sample libraries, or font files are included.

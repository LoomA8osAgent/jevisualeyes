# 04 — Application architecture, jobs, and security

## 4.1 Default architecture

Use a single personal/local deployment first:

```text
React + Vite + TypeScript browser
  prompt / arrangement / piano roll / revision previews
  Tone.js playback and local MIDI/project downloads
                │ same-origin HTTP + SSE
Node + Express server
  validated commands / provider adapter / persistent job runner
                │                     │
          SQLite storage          Jev HTTP API
```

Keep score math, candidate generation, selection, edits, hashing, and export independent of React and Express. The reference kernel should be easily testable under Node. Use a compatible Node release at least 22.16 for the provided reference files; verify and pin actual app dependency versions in the lockfile. Do not confuse this minimum with the latest supported release.

Suggested application structure:

```text
apps/web/src/{components,editor,audio,api,state}
apps/server/src/{routes,jobs,provider,db,security}
packages/music-core/src/{time,candidates,score,selection,edits,midi}
packages/contracts/src/
fixtures/
tests/{unit,integration,e2e,live}
```

No microservices, Redis, container cluster, queue framework, vector database, or general agent framework is needed in P0. A persistent process with a small SQLite job queue is sufficient. Do not run generation inside a short-lived serverless request handler. SSE is application progress transport, not provider token streaming [S08].

## 4.2 Persistence model

SQLite is authoritative for local/personal deployment. Use WAL, foreign keys, migrations, durable transactions, and bounded busy timeout. `reference/storage.sql` is a starting layout; implement JSON/schema validation in the application and transactions explicitly.

Tables: projects; immutable revisions; generation jobs; pending decisions; receipts/attempts; job events; sessions when hosted auth is enabled. A revision contains an immutable canonical score snapshot with its base/parent and content hash. A project points to its accepted revision. A job points to a base revision plus a persistent draft, cursors, epoch, sampler state, limits, and status.

The browser may cache project data in IndexedDB for convenience, but it is not the independent owner of an active job. Editing and generation state must not diverge between a browser-only copy and the server. Exported project files work without that original server for viewing/playback after import; live continuation requires a configured server and explicit start/resume.

Autosave cannot drop receipts needed for recovery. Persist a provider result and its applied event atomically whenever possible. If a crash loses a received-but-uncommitted provider result, a repeated attempt is allowed and billing uncertainty is recorded. Do not claim distributed exactly-once delivery.

## 4.3 Job state machine

States: `queued`, `planning`, `composing`, `pausing`, `paused`, `retry_wait`, `interrupted`, `failed`, `cancelled`, `completed`. Phase is separate from status when useful. Jobs carry a monotonically increasing epoch/lease so two runners cannot commit for the same job concurrently.

- Start: create draft + reserve job idempotently from a client-generated `commandId`; return 202 promptly.
- Active request: persist candidate/context/request hash and the logical `decisionId` before sending.
- Success: transaction verifies job epoch and expected index, inserts receipt/decision uniquely, updates draft/cursors/PRNG, and creates numbered job events. SSE notification occurs after commit.
- Pause: mark pausing. Let the current response commit if the job epoch still matches; do not start another. Then paused.
- Stop: mark cancelled, advance epoch, abort the attempt and prevent any late result from mutating the draft. A late receipt may be logged for billing but never applied.
- Retry wait: persist cooldown and attempt count; resume uses the exact pending payload/candidate map, not newly enumerated alternatives.
- Restart: active statuses become interrupted; offer Resume. Do not automatically spend on startup.
- Resume: requires the same base revision unless the user restores/opens the old branch. Reconcile a stored successful receipt before sending another call. Resume does not restart already accepted events.
- Completion: close draft. For initial composition, it becomes the accepted revision; for edits, expose a preview until Keep. A cancelled/failed job remains recoverable/exportable where it contains complete material.

Local commit idempotency key: `(jobId, decisionIndex)` plus unique `decisionId`. HTTP attempts are separate rows. A retry is a new attempt of the same decision, not a new decision. Persist PRNG state after selection; never resample a stored accepted decision after reconnect.

## 4.4 Partial preview and recovery

For each active lane, cursor means the end of its committed contiguous generated/protected prefix in the selected scope. The safe frontier is the minimum cursor across relevant lanes, including deterministic structural-silence advancement. `completedBars = floor(frontier / barTicks)` relative to the composition start. During region editing, compare only the selected interval and retain immutable outside content.

Preview snapshots contain complete bars only, frozen on publication. Changes while a snapshot plays do not mutate scheduled notes. At a safe stop or loop boundary, a newer snapshot can replace it. Do not schedule half of a chord or a note with an uncommitted duration.

Keep partial creates a clearly labeled partial revision cropped at the safe bar frontier, preserving any note clipped by that crop with derived provenance. It does not fill the rest of the requested song. A selected-region edit with an incomplete draft may apply completed bars only after explicit confirmation; otherwise retain the original selected region. If there are no complete bars, allow saving the draft/checkpoint but do not label it a finished composition.

Editing the accepted score while a job is active is disabled except for view-only/mixer audition state. To edit, pause/stop first. If an accepted revision changes, old jobs cannot apply automatically; they can be reopened as their own branch. Optimistic concurrency is enforced server-side, not only in UI buttons.

## 4.5 App API contract

All writes are JSON, schema-validated, authenticated where configured, and protected against cross-origin requests. Payload limits and error responses are consistent. Proposed routes:

| Method and route | Behavior |
|---|---|
| GET `/api/health` | Local service/version/provider-configured booleans; no key/account secret |
| GET `/api/projects` | Metadata for the current owner |
| POST `/api/projects` | Create empty project or import validated project as new ID |
| GET `/api/projects/:id` | Accepted revision + resumable job metadata |
| POST `/api/projects/:id/commands` | Apply deterministic edit with baseRevisionId and commandId; return new revision |
| POST `/api/projects/:id/jobs` | Start compose, variation, regenerate, or edit-intent job; 202 jobId |
| GET `/api/jobs/:id` | Status, cursors, safe preview, costs, resumable error |
| GET `/api/jobs/:id/events` | SSE with monotonically numbered events and replay |
| POST `/api/jobs/:id/pause` | Idempotent pause |
| POST `/api/jobs/:id/resume` | Explicitly authorize continued requests after validation |
| POST `/api/jobs/:id/cancel` | Idempotent cancellation and abort |
| POST `/api/jobs/:id/accept` | Commit preview with optimistic base-revision check |
| POST `/api/jobs/:id/discard` | Discard preview, keep original |
| GET `/api/projects/:id/export` | Validated JSON without credentials; optional separate trace download |
| DELETE `/api/projects/:id` | Explicit user deletion; cancels owned active job then removes local data |

`POST jobs` body includes `commandId`, `baseRevisionId`, `mode`, `prompt/instruction`, explicit scope, and allowed run overrides. Do not accept a raw arbitrary provider request or outbound URL from the browser. The server constructs actual Jev payloads from the project.

Errors: `{code, message, retryable, details?}`. Codes include `key_missing`, `unauthorized`, `locked_scope`, `revision_conflict`, `provider_rate_limit`, `provider_auth`, `provider_validation`, `provider_response_invalid`, `context_limit`, `request_limit`, `no_candidates`, `import_invalid`, and `unsupported_request`. Remove secrets/raw provider bodies from user errors.

## 4.6 SSE and reconnection

Use event names such as `job.status`, `plan.ready`, `decision.committed`, `preview.ready`, `usage.updated`, `job.error`, `job.completed`. Every event has a persisted integer ID, job ID, revision/draft version, and minimal data. Reconnect with Last-Event-ID; replay after that ID. Deduplicate in the client. Heartbeats must not consume semantic event IDs. If the requested event history was pruned, send a reset instruction and refetch job snapshot; do not silently skip required mutations.

Native EventSource cannot carry arbitrary application headers. Use same-origin session cookies for hosted authentication. The initial POST uses the usual CSRF-protected fetch. Do not put auth tokens/API keys in SSE query parameters. Bound event-log replay and periodically snapshot long jobs.

## 4.7 Local and hosted security

Default bind `127.0.0.1:4318`. Keep the key in environment/server configuration. Use a `.env` ignored by version control. Development frontend must proxy to the backend; never place the key in Vite's `VITE_*` variables. Restrict CORS to the configured origin and validate Host/Origin on mutation routes to mitigate local-service cross-site requests.

Do not expose a shared provider key publicly without authentication and per-owner limits. When binding a nonloopback address, startup must refuse unless the operator configured access control. P0 can use an operator-managed reverse proxy/access gateway rather than a new account system; document the exact supported deployment and deny unauthenticated API traffic. If implementing an app password, hash it, rate-limit login, use HTTP-only SameSite cookies and TLS outside loopback, and enforce CSRF/Origin checks. Do not trust a spoofable client flag claiming authentication.

Allow outbound provider calls only to the configured TypeSafe HTTPS endpoint. No remote URL ingestion, arbitrary sample URLs in imported files, shell execution, model-written code evaluation, or file path traversal. Import JSON with size/depth/count caps and reject dangerous object keys (`__proto__`, `prototype`, `constructor`). Use safe object creation/canonical serialization. Uploaded names are display text only.

Logs redact Authorization, cookies, keys, and user briefs by default. Trace export is opt-in and explains that it includes notes/prompts. No analytics or remote score upload beyond the selected provider unless explicitly implemented with consent. Imported provenance is self-reported until matched to locally trusted receipts; show “Imported — generation history unverified”.

## 4.8 Suggested environment

```dotenv
TYPESAFE_API_KEY=
JEV_MODEL=jev-latest
HOST=127.0.0.1
PORT=4318
APP_ORIGIN=http://127.0.0.1:4318
DATA_DIR=./data
MAX_JOB_ATTEMPTS=12000
MAX_PROVIDER_BODY_BYTES=2097152
PROVIDER_ATTEMPT_TIMEOUT_MS=45000
PROVIDER_MAX_ATTEMPTS_PER_DECISION=4
LIVE_JEV=0
```

`LIVE_JEV` gates tests/scripts, not normal user-authorized production Compose actions. Production Compose is authorized by configured key + authenticated/local user action. An application test must never inherit live authorization just because a developer has a key in their shell.

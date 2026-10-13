# Production API end-to-end runner

`scripts/e2e-production.mjs` is a black-box acceptance runner for the deployed
Medly Worker. It authenticates through the real Firebase project, creates
isolated test data, uploads real PDF and PNG bytes directly to private R2 with
presigned URLs, verifies downloads by
SHA-256, checks role and video-access boundaries, and deletes the test modules
at the end of a successful run. Every request and assertion is retained under
an ignored `artifacts/api-e2e/<run-id>/` directory.

## First run

Use three distinct inbox addresses that can receive Firebase verification
emails. Gmail plus aliases are useful when one inbox is shared:

```bash
MEDLY_E2E_STUDENT_EMAIL='owner+medly-student@gmail.com' \
MEDLY_E2E_ADMIN_EMAIL='owner+medly-admin@gmail.com' \
MEDLY_E2E_SUPERADMIN_EMAIL='owner+medly-superadmin@gmail.com' \
npm run e2e:prepare
```

The preparation command generates long random passwords, creates the Firebase
accounts, sends the verification emails, and writes them only to
`state.private.json` with mode `0600`. It does not print passwords or Firebase
tokens. Approve all three email-verification links, then run the command shown
by `prepare`, for example:

```bash
npm run e2e:run -- --state artifacts/api-e2e/<run-id>/state.private.json --bootstrap-superadmin
```

`--bootstrap-superadmin` uses the existing remote D1 super-admin seeder for
the generated super-admin account. It requires an authenticated Wrangler
session with access to the intended `medly-db`. It is required only on the
first run for an account; later runs can omit it.

Set `MEDLY_E2E_API_BASE` to test a non-default deployment, and `FIREBASE_API_KEY`
to override the public Firebase client API key used by the checked-in test
client.

## Artifacts

Each run retains:

- `events.jsonl` — request metadata, JSON responses, and individual assertion outcomes;
- `summary.json` — pass/fail totals and final status;
- `fixtures/` — the actual PDF and PNG files uploaded during the test;
- `state.private.json` — generated account credentials; keep this private.

Artifacts are deliberately ignored by Git. The logs never include bearer tokens
or generated passwords. On an interruption or assertion failure, the runner
attempts to delete any uniquely named test modules that it has already created;
the artifact log records that cleanup attempt.

## Coverage

The runner exercises every public and documented protected operation: session
provisioning, role management, modules, lectures, materials, video gating,
payment receipts and decisions, flashcards and images, MCQs, binary downloads,
authorization failures, validation-sensitive flows, pagination/filtering, and
cascade deletion. It uses recognizable `Medly E2E <run-id>` names, so any
residual test data can be identified safely.

## Persistent device registrations

The prepare command saves one UUID v4 per actor in `state.private.json`. Run
reuses those UUIDs and adds missing UUIDs to older state files before signing in.
Keep this state for repeated runs against the same accounts. Changing the UUID
requires backend logout or authorized reset followed by a later Firebase sign-in.
All protected E2E requests include `X-Device-ID`; tokens and device UUIDs are not
written to request logs. Run after the additive migration and enforcement rollout.

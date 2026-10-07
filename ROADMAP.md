# Medly roadmap

Last reviewed: 2026-09-28

This roadmap is derived from `docs/medly-srs.pdf` and `docs/Features.pdf`, then checked against the current repository. It distinguishes an implemented backend capability from the mobile experience that still needs to consume it.

## Progress snapshot

| Workstream | Progress | Current state |
| --- | --- | --- |
| Backend foundation and learning API | Substantially complete | Local Worker, D1/R2, validation, authorization boundary, migrations, and integration tests are working. |
| External authentication | Backend complete; client setup pending | Firebase ID-token verification and idempotent local-account provisioning are implemented. The client still needs verified email/password, Google, and Apple sign-in. |
| Mobile application | Not started in this repository | Required screens, offline behavior, PDF annotation, and player/UI behavior remain client work. |
| Production setup and launch | Not started | No paid Cloudflare resources, Firebase project configuration, or deployment have been created. |

## Phase 0 — product decisions

- [x] Use one Cloudflare Worker, D1, and private R2 for Medly server data.
- [x] Keep videos on YouTube/external hosting; the API stores only the URL.
- [x] Keep PDF annotation and offline annotation storage on the user device.
- [x] Use English with system-default/fallback behavior in the client.
- [x] Select Firebase Authentication for email/password, Google, and Apple student identity.
- [x] Require verified email before a Firebase identity can access the API.
- [ ] Decide whether to enable MFA for administrators after the initial launch.
- [ ] Choose the mobile stack and confirm whether the app needs iOS, Android, or both for the first release.

## Phase 1 — backend platform

Status: **complete locally**

- [x] Hono Worker and versioned `/api/v1` API.
- [x] Wrangler local D1 and private R2 bindings in `wrangler.jsonc`.
- [x] Drizzle schema, initial migration, generated Cloudflare types, and local migration command.
- [x] JSON error format, Zod request validation, pagination, CORS configuration, and role middleware.
- [x] Firebase ID-token verification for local development and deployed environments.
- [x] Workers-backed integration tests and a real local Worker/D1 smoke test.

Exit check: `npm install`, `npm run db:migrate:local`, `npm run typecheck`, and `npm test` all pass.

## Phase 2 — Firebase authentication and account bootstrap

Status: **backend complete; Firebase client setup pending**

- [x] Verify Firebase ID tokens with Firebase's public JWKS, RS256, project audience, securetoken issuer, expiry, issued-at, UID, and verified email.
- [x] Add idempotent `POST /auth/session` account creation, legacy-email linking, and collision protection.
- [x] Preserve local D1 roles and profiles; new Firebase accounts default to `USER` and Firebase claims cannot grant `ADMIN`.
- [x] Test invalid tokens, session creation/repeat/link/collision, and D1-only admin authorization with signed local fixtures.
- [ ] Create Firebase environments; enable Email/Password, Google, and Apple; add authorized domains; and register Android/iOS platform IDs as applicable.
- [ ] Configure the Apple Developer Service ID, return URL, signing key, and private email relay.
- [ ] Configure `FIREBASE_PROJECT_ID` for every Worker environment and implement Firebase client login, email verification/reset, account linking, and `getIdToken()` refresh handling.
- [x] Establish an audited role-management path: a deployment-time seeder provisions `SUPER_ADMIN`; only that role can grant or revoke `ADMIN`.
- [ ] Implement account deletion across Firebase Authentication, D1, and R2, including receipt-retention decisions, recent reauthentication, retry-safe cleanup, and final-super-admin protection. See [docs/account-deletion.md](docs/account-deletion.md).

## Phase 3 — modules, lectures, and materials

Status: **backend complete; mobile pending**

- [x] Admin module create, update, final delete, and filters by number/year/semester.
- [x] Admin lecture create, update, final delete; user/admin listing and filters.
- [x] External video URL storage and paid-video authorization endpoint.
- [x] Private R2 lecture-material upload, list, metadata edit, delete, and authenticated download.
- [ ] Build mobile module and lecture lists, filtering/search UI, lecture details, and external video/WebView presentation.
- [ ] Build mobile material browser/download/open-PDF flow.
- [x] Upload files directly to private R2 with short-lived presigned PUT URLs; the API verifies the stored size and MIME type before attachment.

## Phase 4 — booking and paid video access

Status: **backend complete; admin/student screens pending**

- [x] Student receipt upload and module booking request.
- [x] Pending/accepted/rejected status model and duplicate-active-booking protection.
- [x] Admin booking list and accept/reject action.
- [x] Accepted bookings grant module video access; other materials remain free.
- [ ] Build student booking/receipt submission UX.
- [ ] Build admin review queue and receipt-view UX.
- [ ] Define operational payment-review rules: required receipt fields, rejection reason text, and who can approve.

## Phase 5 — flashcards and MCQs

Status: **backend complete; learning UI pending**

- [x] Admin flashcard CRUD with text/image support and private image delivery.
- [x] Per-user known/unknown, viewed, and hidden state; lecture progress endpoint.
- [x] Hiding affects only the requesting user, never the global card.
- [x] Admin MCQ CRUD with exactly four choices and exactly one correct answer.
- [x] User MCQ payloads do not reveal the correct answer; answer-check endpoint returns correctness after a selection.
- [ ] Build flashcard list, flip/reveal, known/don't-know, hide, shuffle, fullscreen, and progress UI.
- [ ] Build the simple MCQ quiz view: next/previous, in-quiz progress, immediate correction, and no saved final grade.
- [ ] Add client-side offline cache/synchronization strategy for flashcards; server state remains the cross-device source of truth.

## Phase 6 — local PDF notes and device features

Status: **mobile work not started; no backend work required**

- [ ] Implement PDF reading and editing modes.
- [ ] Support pen, single-size eraser, yellow highlight, and photo insertion.
- [ ] Autosave annotations locally and make source PDFs/notes available offline.
- [ ] Do not synchronize annotations to the API or R2.
- [ ] Implement screenshot restrictions using each supported platform's native capability; validate the platform-specific limitations rather than treating it as a server control.

## Phase 7 — production readiness

Status: **not started**

- [ ] Create production D1 and private R2 resources only when approved.
- [ ] Put the real D1 ID in `wrangler.jsonc`; configure production origins and secrets with Wrangler.
- [ ] Apply the migration remotely and deploy the Worker.
- [ ] Run an end-to-end smoke test with verified email/password, Google, and Apple login; private files; booking approval; flashcard state; and MCQ answer checking.
- [ ] Add error monitoring/log review and a simple backup/export routine for D1 before inviting real students.

## Current next actions

1. Create the Firebase development project; enable Email/Password, Google, and Apple; register client platforms/domains; and configure `FIREBASE_PROJECT_ID`.
2. Choose the mobile stack, then implement Firebase login, verification/reset, account linking, and module/lecture/material browsing against the existing API.
3. Build the admin booking review and student booking submission screens.

## Explicitly out of scope for this MVP

- Video transcoding/hosting or FFmpeg pipelines.
- Backend PDF annotation sync.
- Persisted MCQ sessions, grades, timers, or history.
- Redis, queues, Durable Objects, microservices, or a second application database.

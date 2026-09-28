# Medly API

Small, single-Worker backend for the Medly educational app. It uses Hono, Cloudflare D1, private R2, Drizzle, Zod, and Vitest's Cloudflare Workers runtime.

See [ROADMAP.md](ROADMAP.md) for the product milestones and current implementation progress.

## What is included

- Versioned JSON API under `/api/v1` with consistent `{ data }` and `{ error }` responses.
- D1 schema and initial migration for users, modules, lectures, private lecture materials, bookings/access, flashcards/progress, and MCQs/choices.
- Admin-only module, lecture, flashcard, MCQ, material, and booking-decision operations.
- Video URLs are returned only to module-access users or admins; other lecture materials are authenticated but free.
- R2 object keys are generated server-side and never exposed as unauthenticated public URLs. Files are downloaded through authenticated Worker routes.
- Flashcard state is per-user; hiding a card changes only that user's state.
- MCQ list payloads deliberately omit the correct answer. `check-answer` returns the result only after a supplied choice.
- Firebase ID tokens are verified with Firebase's public signing keys. Firebase claims identify a user; local D1 records remain the source of roles.

Timestamps are UTC epoch milliseconds. IDs are UUIDs generated with `crypto.randomUUID()`.

## Local setup

Requirements: Node.js 22+ and npm.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run types
npm run db:migrate:local
npm run dev
```

The local Worker listens on `http://localhost:8787`. Check it with:

```bash
curl http://localhost:8787/api/v1/health
```

Run validation and the Workers-backed integration suite with:

```bash
npm run typecheck
npm test
```

`npm run db:generate` produces future Drizzle migrations. Commit each generated `.sql` migration in `drizzle/`; `db:migrate:local` and `db:migrate:remote` apply only committed migrations through Wrangler's migration tracker. The initial migration is intentionally committed and `db:migrate:local` initializes a fresh local D1 database. Local D1/R2 state is stored in `.wrangler/` and can be recreated by rerunning the migration after clearing only that project-local state.

## Firebase authentication

Firebase Auth provides email/password, Google, and Apple sign-in in the mobile/web client. The client sends Firebase's ID token as `Authorization: Bearer <Firebase ID token>` to this Worker; the Worker verifies its RS256 signature with Firebase's public key set and validates its expiry, issued-at time, audience, issuer, subject, and verified email. The Worker never receives a password. No Firebase service-account credential or Firebase client API key belongs in this Worker.

After any Firebase login, call `POST /api/v1/auth/session` once with `getIdToken()`. It creates or links the local Medly account and returns `{ data: { user, created } }`. Later protected calls use a current/refreshed Firebase ID token. A valid Firebase token alone cannot access protected data until this provisioning step has completed. Email/password users must verify their email before this call; unverified tokens are deliberately rejected.

- A Firebase UID already linked to a local account returns that account unchanged.
- A verified-email match without an external subject links the Firebase UID while preserving the local profile and D1 role.
- New users are created with the D1 role `USER`; Firebase claims never confer `ADMIN` or `SUPER_ADMIN`.
- A verified email already linked to another Firebase UID returns `409 CONFLICT`.

### Firebase Console and environment setup

1. Create/select the Firebase project and enable **Authentication → Sign-in method → Email/Password**, **Google**, and **Apple**.
2. Add every web origin under **Authentication → Settings → Authorized domains**. Configure the applicable Android package name/SHA certificates and iOS bundle ID under the Firebase project settings before shipping those clients.
3. Configure the Apple Developer and Firebase Apple-provider settings, including the Service ID, Team ID, key ID, private key, and return URL. Configure Apple's private relay before sending Firebase verification or password-reset emails to Apple relay addresses.
4. Set `FIREBASE_PROJECT_ID` to that exact Firebase project ID in each Worker environment. It is a non-secret runtime variable; update `wrangler.jsonc` for local development and the production environment's Worker variables before deploying.
5. Local development uses the same Firebase ID-token authentication flow as deployed environments.

The complete provider configuration, client contract, account-linking rules, and release checklist are in [docs/authentication.md](docs/authentication.md).

## Common API calls

All routes except health require a bearer token. Admin routes additionally require a local `ADMIN` or `SUPER_ADMIN` user. The initial super admin is provisioned with `npm run seed:superadmin -- --email owner@example.com --local|--remote`; see [the authentication runbook](docs/authentication.md#bootstrap-the-first-super-admin).

- `GET|POST /api/v1/modules`, `GET|PATCH|DELETE /api/v1/modules/:moduleId`
- `POST /api/v1/auth/session` after a Firebase client login
- `GET|POST /api/v1/modules/:moduleId/lectures`
- `GET|PATCH|DELETE /api/v1/lectures/:lectureId`, `GET /api/v1/lectures/:lectureId/video`
- `GET|POST /api/v1/lectures/:lectureId/materials` and `GET /api/v1/lectures/:lectureId/materials/:materialId/download`
- `POST /api/v1/bookings/receipt` (raw bytes plus `X-Filename`), then `POST /api/v1/bookings`; use `DELETE /api/v1/bookings/receipt` to discard an unsubmitted upload. A daily Worker job removes unsubmitted receipts after 24 hours.
- `GET /api/v1/admin/bookings`, `PATCH /api/v1/admin/bookings/:bookingId`
- `GET|POST /api/v1/lectures/:lectureId/flashcards`, `PUT /api/v1/flashcards/:flashcardId/state`
- `GET|POST /api/v1/lectures/:lectureId/mcqs`, `POST /api/v1/mcqs/:mcqId/check-answer`

For the current MVP, uploads proxy files up to 10 MB through the Worker. The storage boundary is kept separate so a direct R2 temporary-credential flow can replace this when genuinely needed for larger files.

## Production Cloudflare and GitHub setup

Do not deploy until Firebase Authentication is configured.

### First Cloudflare setup

```bash
# Authenticate first if needed
npx wrangler login

# Create resources (these are account actions; run them only when ready)
npx wrangler d1 create medly-db
npx wrangler r2 bucket create medly-storage
```

Copy the D1 `database_id` printed by the first command into `wrangler.jsonc`. Before every first deployment, verify that its checked-in ID identifies the intended database; the remote migration and deployment commands use it directly. The R2 binding uses its existing bucket name; keep the bucket private—do not configure a public bucket or public custom domain. Confirm that `DB` maps to `medly-db` and `STORAGE` maps to `medly-storage` before the first deployment.

Set the non-secret production GitHub environment variables `FIREBASE_PROJECT_ID` and `CORS_ORIGINS` before deployment. The deployment workflow refuses to deploy if either is empty, then passes both values to Wrangler explicitly; `wrangler.jsonc` therefore never ships development placeholders. A Firebase service-account credential and Firebase client API key must not be added as Worker secrets; the Worker needs only the project ID and Firebase's public signing keys. `CORS_ORIGINS` must list the mobile/web client origins, comma-separated.

### First GitHub Actions setup

1. In the repository, open **Settings → Environments → New environment** and create `production`.
2. Add these `production` environment secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Add these non-secret `production` environment variables: `PRODUCTION_API_URL` (for example `https://medly-api.<your-subdomain>.workers.dev`), `FIREBASE_PROJECT_ID`, and `CORS_ORIGINS` (comma-separated web origins). `PRODUCTION_API_URL` needs no trailing slash.
4. Create an account-scoped Cloudflare API token limited to the production account. Grant **Workers Scripts: Edit** to deploy the Worker, **D1: Edit** to apply migrations, and **Workers R2 Storage: Edit** for the existing R2 binding. If Cloudflare's token UI separates them, also grant the read-only account/user metadata permissions included by its **Edit Cloudflare Workers** template. Do not use a Global API Key.
5. Push a branch, open a pull request, and merge it into `main`. GitHub Actions will run the production migration, deploy the Worker, then request `/api/v1/health`.

The workflows never create or recreate D1 or R2. `ci.yml` has no Cloudflare credentials and migrates only an ephemeral local D1 database. `deploy.yml` receives production credentials only through the `production` environment. Required reviewers can be enabled on that environment later if manual production approval is wanted; they are not required by default.

### Normal and manual deployment

Normal deployment is simply:

```bash
git push
```

Push a feature branch and open a pull request to run CI. Merging the pull request into `main` automatically applies unapplied committed migrations to production, deploys the Worker, and health-checks it. To deploy manually, open **Actions → Deploy production → Run workflow** and choose the branch/commit to deploy.

Use backward-compatible database changes: expand the schema first, deploy code that accepts both shapes, migrate data separately if necessary, and only remove obsolete fields in a later deployment. Do not pair destructive changes such as dropping or renaming columns with a deployment while an older Worker version may still need the old schema.

## Deliberate non-features

Video hosting stays external. PDF annotations/offline persistence, card shuffle/fullscreen, quiz navigation/progress, localization, and screenshot restrictions are client concerns. There are no annotation, quiz-history, cache, queue, Redis, or custom auth tables/services.

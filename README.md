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

## Development authentication boundary

No custom password or OAuth server is implemented. The API has one small provider boundary in `src/middleware/auth.ts`:

- During local development only, `.dev.vars` may set `DEV_AUTH_ENABLED=true`; use `Authorization: Bearer dev:<existing-user-uuid>`.
- In tests, users are seeded directly into D1.
- In a deployed environment, do **not** set `DEV_AUTH_ENABLED`. Implement `verifiedProviderSubject()` with the selected provider's server-side JWT/JWKS verifier, then upsert/find the corresponding local `users` row via `external_subject`.

That provider must provide email/password recovery plus Google and Apple sign-in (for example, a managed authentication provider). The Worker remains responsible for local role lookup and authorization; assign `ADMIN` deliberately in D1/admin tooling.

## Common API calls

All routes except health require a bearer token. Admin routes additionally require a local user whose `role` is `ADMIN`.

- `GET|POST /api/v1/modules`, `GET|PATCH|DELETE /api/v1/modules/:moduleId`
- `GET|POST /api/v1/modules/:moduleId/lectures`
- `GET|PATCH|DELETE /api/v1/lectures/:lectureId`, `GET /api/v1/lectures/:lectureId/video`
- `GET|POST /api/v1/lectures/:lectureId/materials` and `GET /api/v1/lectures/:lectureId/materials/:materialId/download`
- `POST /api/v1/bookings/receipt` (raw bytes plus `X-Filename`), then `POST /api/v1/bookings`
- `GET /api/v1/admin/bookings`, `PATCH /api/v1/admin/bookings/:bookingId`
- `GET|POST /api/v1/lectures/:lectureId/flashcards`, `PUT /api/v1/flashcards/:flashcardId/state`
- `GET|POST /api/v1/lectures/:lectureId/mcqs`, `POST /api/v1/mcqs/:mcqId/check-answer`

For the current MVP, uploads proxy files up to 10 MB through the Worker. The storage boundary is kept separate so a direct R2 temporary-credential flow can replace this when genuinely needed for larger files.

## Production Cloudflare and GitHub setup

Do not deploy until an external auth provider is connected and development authentication is disabled.

### First Cloudflare setup

```bash
# Authenticate first if needed
npx wrangler login

# Create resources (these are account actions; run them only when ready)
npx wrangler d1 create medly-db
npx wrangler r2 bucket create medly-storage
```

Copy the D1 `database_id` printed by the first command into `wrangler.jsonc`. The checked-in all-zero value is a placeholder and intentionally prevents a remote migration or deployment from targeting a real database until it is replaced. The R2 binding uses its existing bucket name; keep the bucket private—do not configure a public bucket or public custom domain. Confirm that `DB` maps to `medly-db` and `STORAGE` maps to `medly-storage` before the first deployment.

The first production Worker secrets and runtime variables remain Cloudflare-managed, not GitHub-managed:

```bash
npx wrangler secret put AUTH_PROVIDER_SECRET # only if the chosen verifier needs a secret
```

`wrangler.jsonc` contains no secrets. Use `.dev.vars` locally and `wrangler secret put` for production secrets. Set an explicit production `CORS_ORIGINS` value before deployment; it must be the mobile/web client origin(s), comma-separated.

### First GitHub Actions setup

1. In the repository, open **Settings → Environments → New environment** and create `production`.
2. Add these `production` environment secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Add the non-secret `production` environment variable `PRODUCTION_API_URL`, for example `https://medly-api.<your-subdomain>.workers.dev` (no trailing slash is required).
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

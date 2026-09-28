# Backend remaining work

## Scope and status

The application backend is feature-complete for the MVP when run locally: the API, D1 schema/migrations, private R2 file storage, Firebase token verification, role authorization, booking access grants, flashcard state, and MCQ answer checking are implemented and covered by integration tests.

This document lists the work still required to make that backend ready for real users. It deliberately excludes frontend/mobile work, PDF annotation, offline UI behavior, localization, and other client-side requirements.

## Definition of done

The backend is launch-ready when:

- A real Firebase project is configured and verified identities can provision accounts through `POST /api/v1/auth/session`.
- A private production D1 database and R2 bucket are bound to the Worker.
- The production deployment workflow completes successfully from `main`.
- A super admin exists, access control and private files have been checked in production, and the booking-to-video-access flow works end to end.
- The team has an owner for payment decisions, a backup/export routine, and a process for reviewing runtime errors.

## 1. Make the outstanding product decisions

**Owner:** product/operations

These decisions do not require new API code, but should be recorded before deployment:

1. Decide which operational users can accept or reject bookings. The API currently permits `ADMIN` and `SUPER_ADMIN`.
2. Define what makes a receipt acceptable and how a rejection is communicated. The current status model is only `PENDING`, `ACCEPTED`, or `REJECTED`; it has no rejection-reason field.
3. Decide whether administrator MFA is required at launch.
4. Confirm whether the current 100 MB proxy-upload cap is sufficient. If larger files are required, scope a direct-to-R2 upload design separately and assess request limits and abuse controls.

**Acceptance:** the decisions are written down, and any required new data/API behavior is separately planned and implemented with a migration and tests.

## 2. Configure Firebase Authentication

**Owner:** Firebase/project administrator

The Worker already verifies Firebase RS256 ID tokens. It does not store passwords, send password-reset messages, or need a Firebase service-account credential.

1. Create a Firebase project for development and production, or establish clearly separated environments in the approved project.
2. In Firebase Authentication, enable Email/Password, Google, and Apple if those sign-in methods are part of the release.
3. Add only the approved client domains and platform identifiers to Firebase. Configure Apple’s Service ID, return URL, signing key, and private-email relay as applicable.
4. Set the exact production Firebase project ID as the GitHub `production` environment variable `FIREBASE_PROJECT_ID`.
5. Set the same value for the intended local/development Worker environment. Do not add a Firebase API key, service-account JSON, or Firebase admin credentials to Worker secrets.
6. Obtain a verified Firebase ID token from the real project and confirm:
   - `POST /api/v1/auth/session` creates a `USER` account on first use;
   - a repeated request returns the same account;
   - an unverified-email token is rejected;
   - a token from another Firebase project is rejected.

The detailed identity contract and provider release checks are in [authentication.md](authentication.md).

## 3. Provision and bind production Cloudflare resources

**Owner:** Cloudflare account administrator

1. Authenticate Wrangler to the intended Cloudflare account:

   ```bash
   npx wrangler login
   ```

2. Create the production D1 database and private R2 bucket if they do not already exist:

   ```bash
   npx wrangler d1 create medly-db
   npx wrangler r2 bucket create medly-storage
   ```

3. Copy the D1 database ID returned by the create command into `wrangler.jsonc`. Before committing or deploying, verify that the `DB` binding identifies the intended production database and that `STORAGE` identifies the intended `medly-storage` bucket.
4. Keep the R2 bucket private. All file access must continue through the authenticated Worker endpoints; do not add a public bucket domain.
5. Confirm the configured daily cron trigger remains present. It removes abandoned, unsubmitted payment receipts after 24 hours.
6. Set the allowed web origins as the GitHub `production` environment variable `CORS_ORIGINS`, using a comma-separated list. Do not use `*` with credentialed browser requests unless that is an intentional, reviewed policy.

## 4. Configure CI/CD authorization and deploy

**Owner:** repository and Cloudflare administrator

The repository already includes [CI](../.github/workflows/ci.yml) and [production deployment](../.github/workflows/deploy.yml) workflows. The deployment workflow validates configuration, applies unapplied D1 migrations, deploys the Worker, then calls `/api/v1/health`.

1. In GitHub, create the `production` environment.
2. Add its secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Add its non-secret variables:
   - `PRODUCTION_API_URL`, without a trailing slash;
   - `FIREBASE_PROJECT_ID`;
   - `CORS_ORIGINS`.
4. Give the Cloudflare API token only the permissions required for the Worker, D1 migrations, and the existing R2 binding. Do not use a Global API Key.
5. Locally, run the release gate before merging:

   ```bash
   npm ci
   npm run types
   npm run typecheck
   npm run db:migrate:local
   npm test
   ```

6. Merge to `main`, then inspect the deployment workflow. It runs:

   ```bash
   npx wrangler d1 migrations apply medly-db --remote
   npx wrangler deploy --var FIREBASE_PROJECT_ID:<project-id> --var CORS_ORIGINS:<origins>
   ```

7. Confirm the deployed health endpoint returns `200`:

   ```bash
   curl --fail --show-error "https://<production-host>/api/v1/health"
   ```

**Safety rule:** use additive, backward-compatible database migrations. Do not pair a destructive migration (for example, dropping or renaming a column) with a deployment that might still run an older Worker version.

## 5. Bootstrap administration and perform the production acceptance test

**Owner:** backend administrator

1. Provision the initial super admin using the existing seed script:

   ```bash
   npm run seed:superadmin -- --email owner@example.com --remote
   ```

2. Sign in with a verified Firebase account, call `POST /api/v1/auth/session`, and verify the account is initially `USER`.
3. As the super admin, grant a test user `ADMIN` and confirm a normal user cannot call an admin route.
4. Create a test module and lecture; verify a user without an accepted booking receives no video URL and gets `403` from the video endpoint.
5. Upload a lecture material and flashcard image; verify anonymous access is denied and authenticated download/image delivery succeeds.
6. Upload a receipt, submit a booking, download it as an admin, accept the booking, and verify that only then the user can obtain the lecture video URL.
7. Create a flashcard and MCQ; verify flashcard progress is per user and that the MCQ list does not expose correct answers before `check-answer`.
8. Delete the test records and verify related private R2 objects are removed.

Record the test date, environment, tester, and any failures in the release record.

## 6. Establish operations, recovery, and security review

**Owner:** operations/backend owner

1. Assign a named owner to review Worker errors and failed requests after each release and on a regular schedule. Worker observability is already enabled in `wrangler.jsonc`.
2. Establish a recurring D1 export and store it outside the production database with restricted access. Validate restoration in a non-production environment before relying on it. A manual export is:

   ```bash
   npx wrangler d1 export medly-db --remote --output=./medly-db-backup.sql
   ```

   Also document the account’s D1 point-in-time recovery window and the authorized recovery procedure.
3. Review R2 retention: submitted receipts are retained because they support booking decisions; only unsubmitted uploads are automatically removed. Set a retention policy for accepted/rejected booking receipts that meets the business and legal needs.
4. Review CORS origins, administrator membership, and Cloudflare/GitHub access at least before each production release.
5. Schedule a periodic restore drill and a smoke test of authentication, private file access, booking approval, flashcard state, and MCQ checking.

## Suggested execution order

1. Resolve the operational decisions in section 1.
2. Complete Firebase configuration in section 2.
3. Provision and verify Cloudflare resources in section 3.
4. Configure GitHub production credentials and deploy using section 4.
5. Run the production acceptance test in section 5.
6. Put monitoring, backup, and review routines from section 6 into operation.

After these steps, the backend has no known MVP feature gaps. Future work such as direct-to-R2 uploads, richer booking decisions, MFA enforcement, or additional monitoring should be treated as separately scoped enhancements.

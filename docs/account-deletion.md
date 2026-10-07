# Account deletion

`DELETE /api/v1/me` deletes the caller's Firebase identity and local Medly
account. It accepts no target user ID or email. Payment receipts are retained,
including unsubmitted uploads; booking records survive with `userId: null`.
Shared educational content is unaffected. Module access and flashcard progress
are removed through the existing user foreign-key cascades.

## Client contract

1. Explain that deletion removes account access and progress, while payment
   receipts and booking records are retained. Ask the user to confirm.
2. Reauthenticate with their Firebase provider when needed. Token refresh alone
   does not reset `auth_time`; use the Firebase reauthentication API, then
   `getIdToken(true)`.
3. Call `DELETE /api/v1/me` with the current Firebase ID token. No body is needed.
4. On `202`, sign out of Firebase and clear the local application session/cache.
   Do not call Firebase `deleteUser()` separately; the Worker owns the operation.

```http
DELETE /api/v1/me
Authorization: Bearer <Firebase ID token>
```

```ts
// 202 Accepted — acceptance is durable, completion is asynchronous.
type Response = { data: { status: 'pending' | 'completed' } };
```

A new deletion requires `auth_time` within five minutes. Otherwise the API
returns `401` with `REAUTHENTICATION_REQUIRED`. Invalid, expired, wrong-project,
and unverified-email tokens return `401 UNAUTHORIZED`. A missing local account
returns `401`; missing server deletion configuration returns `503` without
changing the account.

Retries with a valid token for the same Firebase UID return `202`, including
after local deletion. They do not create duplicate jobs or require another
recent sign-in for an already accepted request. After the token expires, the
background job still completes without client participation. No authenticated
status polling is required after the client has signed out.

## Setup and rollout

1. Apply `drizzle/0002_account_deletion.sql` before deploying the new Worker. The
   migration preserves existing bookings and changes their user foreign key to
   `ON DELETE SET NULL`. Back up the production database before migration.
2. Create a service account authorized for `firebaseauth.users.delete` on the
   exact `FIREBASE_PROJECT_ID`. Enable the Identity Toolkit API. Use a dedicated
   account and the smallest applicable IAM role; do not grant project Owner.
3. Set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` as GitHub `production`
   environment secrets. The private key must be an RSA PKCS8 PEM key, as supplied
   in the service-account `private_key` field. Actual newlines and literal `\n`
   sequences are supported. Do not commit a real key or the service-account JSON.
4. The deployment workflow validates the configuration before remote migration
   and supplies these secrets to the Worker. For manual deployment, use
   `npx wrangler secret put FIREBASE_CLIENT_EMAIL` and
   `npx wrangler secret put FIREBASE_PRIVATE_KEY`.
5. Keep the five-minute cron trigger enabled. Verify deletion using a disposable
   account and verify admin receipt download after its account is removed.

Local credentials may be placed in ignored `.dev.vars`. Authentication alone
still needs only the project ID and public Firebase signing keys. Server-side
credentials are exclusively for deletion. Tests generate an ephemeral RSA key and mock Firebase requests; they never
use real service-account credentials.

## Durable processing

Acceptance atomically creates a D1 job and marks the user pending deletion.
Ordinary authenticated requests are blocked immediately. `/auth/session` rejects
the old Firebase UID and cannot recreate or relink that account. Account-owned
booking/progress/profile mutations also guard the pending state at write time.
Requests already in flight may finish reading data; this is not a global
transaction across HTTP requests.

The Worker starts processing with `waitUntil`; the scheduled handler retries
up to ten due jobs concurrently every five minutes. A five-minute lease prevents
normal concurrent processing. Failed jobs use exponential backoff from five
minutes up to six hours. Every external step is idempotent, including Firebase
`USER_NOT_FOUND`, and successful Firebase deletion is checkpointed before local
cleanup. Local deletion and job completion are one D1 batch transaction. R2 is
never touched by this flow.

Jobs store only the Firebase UID, local account UUID, timestamps, attempts, and
a generic failure code. They contain no email, name, bearer token, or provider
response. Completed jobs remain as UID tombstones for at least 65 minutes,
covering Firebase's one-hour ID-token lifetime plus clock skew, and are then
removed by the cron. Failed jobs are retained until processing succeeds.

Inspect incomplete `account_deletion_jobs` and their `last_error` in operations:
`FIREBASE_DELETE_FAILED` indicates a credential, permission, or Firebase request
problem; `LOCAL_DELETE_FAILED` indicates D1 cleanup failed after Firebase
succeeded. Fix the underlying configuration/storage issue and let the cron
retry. Existing pending jobs remain blocked even if credentials are removed.

## Fresh registration and retained payments

After deletion completes, Firebase registration with the same email is allowed.
The new Firebase UID gets a new local UUID and `USER` role, with no previous
course access or flashcard progress. Retained bookings are not matched by email
or attached to the new account. Receipt keys remain under the old local UUID;
new accounts cannot claim them through the upload or booking endpoints.

Admin booking lists allow `userId: null`. Admins can still download retained
receipts and accept/reject pending retained bookings. An accepted booking with
no active user does not grant module access.

`DELETE /bookings/receipt` now returns `409 CONFLICT` for an owned receipt and
never deletes it. The former abandoned-receipt cleanup is removed. Receipts
written using an already-issued presigned upload URL are retained as well.
Module deletion still has its existing cascade on booking metadata; this update
changes account deletion and receipt retention, not module deletion policy.

# Authentication and user-management integration guide

Read [README.md](README.md) first for the base URL and common envelopes.

## Client sign-in sequence

1. Sign in with the Firebase client SDK using verified email/password, Google,
   or Apple.
2. Obtain a current Firebase ID token with `getIdToken()`.
3. Generate one UUID v4 per installation/browser profile and persist it. Call
   `POST /auth/session` using the token and `X-Device-ID: <UUID>`.
4. Use a current/refreshed token in the `Authorization` header for every later
   protected request, together with the same `X-Device-ID`.

The Worker does not receive a password. It rejects tokens whose email is not
verified. New local accounts are always created with the `USER` role; Firebase
claims cannot make someone an admin.

```ts
type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

// Returned only by GET /admin/users.
type AdminUser = User & {
  createdAt: string;
  updatedAt: string;
};

// Returned by PATCH /admin/users/:userId/role.
type UpdatedAdminUser = AdminUser;
```

## `POST /auth/session`

**Job:** creates or links the signed-in Firebase identity to a local Medly user.
Call once after every Firebase login, before protected API use. It is
idempotent, so retrying it is safe.

**Authentication:** verified Firebase bearer token and persistent UUID v4 in
`X-Device-ID` required.

**Request DTO:** an optional body may provide a display name while creating a
new local account. The value is trimmed and must be 1–100 characters. It is
ignored for existing or legacy-linked local accounts, so this endpoint remains
safe to retry and is not a profile-edit endpoint.

```http
POST /auth/session
Authorization: Bearer <Firebase ID token>
X-Device-ID: <persistent installation UUID v4>
Content-Type: application/json

{ "name": "Sara Ali" }
```

The body may be omitted. For a newly created account, the Worker chooses the
name in this order: supplied body value, Firebase `name` claim, then the email
prefix. Email/password registration should send the name collected at sign-up.

**Expected response — `200 OK`**

```ts
type Response = Success<{
  user: User;
  email_verified: true;
  created: boolean; // true only when a new local Medly user was created
}>;
```

**Important errors:** `401` for an invalid, expired, different-project, or
unverified-email Firebase token; `409` when the verified email is already
linked to a different Firebase identity.

## `GET /me`

**Job:** returns the currently authenticated local Medly user and role. Use it
to restore client session state or decide whether to show admin controls.

**Authentication:** verified Firebase bearer token and persistent UUID v4 in
`X-Device-ID` required.

**Request DTO:** none.

**Expected response — `200 OK`**

```ts
type Response = Success<User>;
```

## `PATCH /me`

**Job:** updates the current user’s local display name. It does not change the
Firebase profile, email address, sign-in methods, or role.

**Authentication:** verified Firebase bearer token and persistent UUID v4 in
`X-Device-ID` required.

**Request DTO**

```ts
type Body = { name: string }; // Trimmed, 1–100 characters
```

**Expected response — `200 OK`**

```ts
type Response = Success<User>;
```

## `DELETE /me`

**Job:** durably request deletion of the authenticated Firebase/local account.
No target user ID, email, or request body is accepted as a deletion target.
New requests require a verified Firebase token with sign-in within five minutes.

**Expected response — `202 Accepted`:**

```ts
type Response = Success<{ status: 'pending' | 'completed' }>;
```

On acceptance, clear the local session and sign out of Firebase. Processing and
retries continue in the Worker. A valid token and the same device UUID for the same UID can safely retry
an accepted request after the local account is blocked or removed.

**Errors:** `401 REAUTHENTICATION_REQUIRED` means reauthenticate with Firebase
and obtain a fresh token; token refresh alone is insufficient. `401 UNAUTHORIZED`
means invalid authentication or no linked local account. `503 SERVICE_UNAVAILABLE`
means server deletion credentials are missing and the account was not changed.

`/auth/session` returns `409` for a pending/deleted UID. After deletion completes,
signing up with the same email produces a new UID/local account with `USER` role.
Payment receipts and bookings remain separate; previous access/progress is lost.
See [the account deletion runbook](../account-deletion.md).

## `GET /admin/users` — Super admin only

**Job:** lists local users for the super-admin role-management screen.

**Authentication:** local `SUPER_ADMIN` role required.

**Request DTO:** none.

**Expected response — `200 OK`**

```ts
type Response = Success<AdminUser[]>;
```

## `PATCH /admin/users/:userId/role` — Super admin only

**Job:** promotes a user to `ADMIN` or demotes an admin to `USER`.

**Authentication:** local `SUPER_ADMIN` role required.

**Path DTO**

```ts
type Path = { userId: string }; // UUID
```

**Request DTO**

```ts
type Body = { role: 'USER' | 'ADMIN' };
```

**Expected response — `200 OK`**

```ts
type Response = Success<UpdatedAdminUser>;
```

`SUPER_ADMIN` cannot be granted, changed, or removed through this endpoint; it
is controlled by deployment-time administration. Trying to modify a super
admin returns `409 CONFLICT`.

## Device registration, logout, and reset

The first `/auth/session` request claims an unregistered account. Repeating it
with the same UUID is safe. All protected routes enforce the registered UUID,
including admins, super admins, and account deletion. Ordinary routes never
register a device. UUID casing is normalized; UUIDs are omitted from responses.

Generate a UUID once with `crypto.randomUUID()` on web and keep it in browser
storage. Mobile clients must persist their UUID in installation storage across
app restarts and logout; do not regenerate it on each request or sign-in.
This restricts app installations or browser profiles. Copying a UUID can bypass
it. Downloaded content and external video playback are outside this restriction.

| Response | Client action |
| --- | --- |
| `422 VALIDATION_ERROR` | Supply a valid UUID v4 in `X-Device-ID`. |
| `401 DEVICE_MISMATCH` | Sign out of Firebase; show that another device is registered. Keep the UUID and do not retry registration automatically. |
| `401 DEVICE_NOT_REGISTERED` | Call `/auth/session` once before retrying the request. |
| `401 REAUTHENTICATION_REQUIRED` | Prompt for a new Firebase sign-in, then call `/auth/session`. Token refresh alone is insufficient. |

`POST /auth/logout` requires both credentials and returns `204`. Call it before
Firebase sign-out, then clear the appropriate local cached data while retaining
the UUID. If the backend call fails, explain that the registration may still
require an administrator reset. A delayed logout with another UUID cannot clear
the current registration.

`POST /admin/users/:userId/reset-device` returns `204`. An `ADMIN` may reset
`USER` accounts; a `SUPER_ADMIN` may reset any account, including their own.
Regular users cannot reset registrations. Unknown accounts return `404`;
accounts undergoing deletion return `409`. Resetting an already unregistered
account also records a release timestamp. Reset actions log the actor and target
user IDs, never tokens or device UUIDs.

After logout or reset, Firebase `auth_time` must be strictly later than the
release timestamp before any device can register. There is no maximum sign-in
age for registration. Firebase `auth_time` has second precision, so a sign-in
in the same second as release may require another interactive sign-in after
that second. Account deletion retains its separate five-minute sign-in rule;
accepted deletion retries require the accepted UUID, checked against a hash
stored in the durable deletion job even after the local user is removed.

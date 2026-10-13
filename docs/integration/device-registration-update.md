# Device registration update: client integration guide

This update allows one registered installation or browser profile per Medly
account. Firebase still authenticates the person; the API also checks a
persistent device UUID. The rule applies to `USER`, `ADMIN`, and `SUPER_ADMIN`.

Paths below are relative to your API base URL, including `/api/v1`. See the
[integration overview](README.md) for environments and response conventions.

## Required client changes

1. Generate and persist one UUID v4 per installation or browser profile.
2. Send it in `X-Device-ID` on every protected API request, alongside the
   current Firebase ID token.
3. Call `POST /auth/session` after Firebase sign-in and before loading protected
   application data.
4. Handle device errors by their error code, rather than treating every `401`
   as an expired token.
5. Call `POST /auth/logout` before signing out of Firebase.
6. Retain the UUID across sign-out, sign-in, and application restarts.

Health and API documentation remain public. Requests to external video URLs
or signed storage upload/download URLs follow their own contracts; attach
these headers to the Medly API requests that obtain those URLs.

## Persist the installation UUID

On web, use browser storage. For example:

```ts
const deviceStorageKey = 'medly-device-id';

function getDeviceId(): string {
  const existing = localStorage.getItem(deviceStorageKey);
  if (existing) return existing;

  const created = crypto.randomUUID();
  localStorage.setItem(deviceStorageKey, created);
  return created;
}
```

On mobile, generate a UUID v4 and keep it in persistent installation storage.
Use the same value for all accounts used on that installation. Do not generate
a new value per request or login, and exclude this storage entry from logout
cleanup. UUID casing is normalized by the API.

If browser storage is cleared or an installation loses its UUID, it will appear
as another device. The old registration must be released or reset before the
new UUID can register. Do not silently replace an existing malformed UUID as
an error-recovery strategy; explain that recovery may require an admin reset.

## Send both headers

```http
Authorization: Bearer <current Firebase ID token>
X-Device-ID: <persistent UUID v4>
```

Centralize header creation so JSON requests, binary API downloads, admin
requests, and deletion requests all use the same UUID. For a web client with
an initialized Firebase `auth` instance:

```ts
async function apiRequest(path: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before calling the API');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  headers.set('X-Device-ID', getDeviceId());

  return fetch(`${apiBase}${path}`, { ...init, headers });
}
```

This helper only sends requests. Apply the error handling below in your client
request layer. Handle `204` responses without trying to parse a JSON body.

## Register after sign-in

After signing into Firebase with a verified email, call:

```http
POST /auth/session
Authorization: Bearer <current Firebase ID token>
X-Device-ID: <persistent UUID v4>
Content-Type: application/json

{ "name": "Sara Ali" }
```

The body is optional. `name` is used only when creating the local account;
it is trimmed and must contain 1–100 characters. Existing accounts retain
their current name.

Successful registration returns `200 OK`:

```json
{
  "data": {
    "user": {
      "id": "11111111-1111-4111-8111-111111111111",
      "email": "sara@example.com",
      "name": "Sara Ali",
      "role": "USER"
    },
    "created": true,
    "email_verified": true
  }
}
```

`created` describes local account creation, not device registration. An existing
account registering a device returns `created: false`. Repeating registration
with the same UUID is safe. A different registered UUID is rejected; ordinary
protected endpoints never register a device automatically.

When restoring a Firebase login after an app restart, use the persisted UUID.
You can call `/auth/session` to confirm registration before loading data. An
existing registration accepts valid refreshed tokens from its matching UUID.

## Handle errors by code

Errors use the following envelope:

```json
{
  "error": {
    "code": "DEVICE_MISMATCH",
    "message": "Another device is registered to this account"
  }
}
```

| Status and code | Client behavior |
| --- | --- |
| `422 VALIDATION_ERROR` | Check the UUID v4 header and request input. Correct the request before retrying. |
| `401 DEVICE_MISMATCH` | Sign out of Firebase, retain the UUID, and explain that the registered device must log out or an administrator must reset the account. Do not automatically retry registration. |
| `401 DEVICE_NOT_REGISTERED` | Call `/auth/session` once. If it succeeds, retry the original request once. Avoid recursive recovery on `/auth/session` and `/auth/logout`. |
| `401 REAUTHENTICATION_REQUIRED` | Ask for a new Firebase sign-in or reauthentication, obtain its token, then register through `/auth/session`. Refreshing the token alone is insufficient. |
| `401 EMAIL_NOT_VERIFIED` on `/auth/session` | Show the email-verification flow before provisioning. |
| `401 UNAUTHORIZED` | Check Firebase authentication and local provisioning. If refreshing an expired token and retrying once fails, return to sign-in. |
| `409 CONFLICT` on `/auth/session` | Show account-support guidance; the account may be undergoing deletion or the email may be linked to another Firebase identity. |

If session recovery fails, surface that error and stop retrying the original
request. Do not send a logout request from a mismatched device to try to release
the other device; it cannot release that registration.

## Logout and switching devices

While the matching device still has Firebase credentials, call:

```http
POST /auth/logout
Authorization: Bearer <current Firebase ID token>
X-Device-ID: <registered UUID v4>
```

The endpoint takes no body and returns `204 No Content`. Then sign out of
Firebase and clear account-specific caches while retaining the UUID. If the
backend call fails, the client can still sign out locally, but must explain
that the registration may remain and require an administrator reset.

After logout or reset, registration requires Firebase `auth_time` strictly
later than the server's release timestamp. There is no maximum sign-in age for
device registration. Firebase sign-in timestamps have second precision, so a
sign-in during the release second may be rejected; perform another sign-in
after that second if needed.

To move from device A to device B:

1. A calls backend logout, then signs out of Firebase.
2. B performs a new Firebase sign-in after the release.
3. B calls `/auth/session` with its own persisted UUID.
4. B loads protected application data.

## Administrator reset

For a lost or inaccessible device, an authenticated administrator can call:

```http
POST /admin/users/<local-user-UUID>/reset-device
Authorization: Bearer <administrator Firebase ID token>
X-Device-ID: <administrator registered UUID v4>
```

The target is the local Medly user ID, not the Firebase UID. There is no request
body. A successful reset returns `204 No Content`.

| Actor role | Allowed targets |
| --- | --- |
| `USER` | None |
| `ADMIN` | `USER` accounts |
| `SUPER_ADMIN` | Any account, including their own |

Unknown targets return `404`; deleting accounts return `409`; disallowed
roles return `403`. Resetting an already unregistered account still records a
release timestamp. The target must sign in again after reset and register.
A super admin who resets their own device also loses protected API access.

User listing and role changes remain super-admin-only. Role-change responses
contain `id`, `email`, `name`, `role`, `createdAt`, and `updatedAt`; clients
must not depend on `externalSubject` or device fields being returned.

For a locked-out super admin, deployment operators can use the
[super-admin recovery procedure](../authentication.md#locked-out-super-admin-recovery).

## Account deletion

`DELETE /me` also requires the registered UUID. A new deletion request retains
the separate requirement to sign into Firebase within the last five minutes.
After `202 Accepted`, sign out and clear account data while retaining the UUID;
the server continues processing independently.

An accepted request can be acknowledged again only with valid authentication
for the same Firebase UID and the original device UUID. The deletion job keeps
a SHA-256 hash to check that UUID even after the local user record is removed.
Deletion jobs accepted before this update have no device hash: background
processing continues, but API acknowledgement retries are denied.

## Rollout and verification

Apply database migration `0005_device_registration.sql` before deploying the
updated Worker. Ship compatible clients together with device enforcement.
Existing accounts start unregistered and must call `/auth/session`. Older
clients without the header receive `422` on otherwise authenticated requests.
Browser API CORS now permits `X-Device-ID`.

Verify with two separate browser profiles or installations:

1. Register A and confirm `/me` succeeds.
2. Sign into the same account on B and confirm registration returns
   `DEVICE_MISMATCH`, with Firebase sign-out and clear recovery guidance.
3. Log out on A, then perform a later sign-in on B and confirm registration succeeds.
4. Reset B through an authorized administrator. Confirm B loses protected
   access and an old or refreshed token cannot register again.
5. Sign in again after reset and confirm registration succeeds.
6. Confirm logout retains the UUID, malformed headers return `422`, and
   profile/session/admin responses omit device fields.

The repository's [test client](../../test-client/README.md) supports this flow.
Production E2E tooling persists one UUID per actor in its private state file;
retain that file across repeated runs against the same accounts.

The UUID identifies an installation or browser profile and can be copied;
this feature does not prevent copied UUIDs, downloaded-content sharing, or
external video playback. Device UUIDs and tokens should not appear in client
logs or analytics. Backend reset logs contain actor and target user IDs, and
unexpected-error logs use sanitized diagnostics.

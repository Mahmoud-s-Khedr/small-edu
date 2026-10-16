# Optional student device restriction

The database setting `DEVICE_RESTRICTION_ENABLED` controls one-device access.
It defaults to `false`. Only `USER` accounts are restricted when enabled.
`ADMIN` and `SUPER_ADMIN` accounts always have unlimited devices and never
need an `X-Device-ID` header, including on session, logout, and deletion requests.
Firebase authentication and existing role permissions still apply.

## Change the setting

Admins and super admins can read or change the setting:

```http
GET /api/v1/admin/settings/device-restriction
Authorization: Bearer <administrator Firebase token>
```

```http
PATCH /api/v1/admin/settings/device-restriction
Authorization: Bearer <administrator Firebase token>
Content-Type: application/json

{ "DEVICE_RESTRICTION_ENABLED": true }
```

Both return:

```json
{ "data": { "DEVICE_RESTRICTION_ENABLED": true } }
```

Send the boolean `false` to disable enforcement. Strings such as `"true"` are
rejected. The setting is stored in `app_settings`, under the exact key
`DEVICE_RESTRICTION_ENABLED`, with an `enabled` boolean and `updated_at` timestamp.
A missing row defaults to disabled. Read failures are reported as server errors.
There is no in-process flag cache; requests read D1 directly.

Disabling preserves existing registrations and allows all devices. Re-enabling
restores those registrations. Students without a registration must register
through `/auth/session`; ordinary API requests never claim a device.
Requests already in flight may finish using the policy they already read.

## Client integration

1. Generate one UUID v4 per installation/browser profile, for example using
   `crypto.randomUUID()`, and persist it across restarts and logout.
2. Send it as `X-Device-ID` alongside `Authorization: Bearer <Firebase token>`
   on Medly API requests. Sending it while disabled or for admins is harmless.
3. After verified Firebase sign-in, call `POST /api/v1/auth/session` before
   loading protected data. When restrictions apply, this registers the UUID.
4. Before Firebase sign-out, call `POST /api/v1/auth/logout`. It returns `204`
   with no body. Keep the installation UUID after logout.

A second UUID cannot displace a registered one. Registration is atomic, so two
simultaneous first registrations cannot both claim the account. Repeating
registration with the same UUID is safe. The UUID identifies an installation
or browser profile and can be copied; it is not hardware attestation.

| Response | Meaning and recovery |
| --- | --- |
| `422 VALIDATION_ERROR` | Required device header is missing or is not a UUID v4, or request input is invalid. |
| `401 DEVICE_NOT_REGISTERED` | Call `/auth/session` once, then retry the original request once if successful. |
| `401 DEVICE_MISMATCH` | Log out on the registered device or request an admin reset. Stop automatic retries. |
| `401 REAUTHENTICATION_REQUIRED` | Perform a fresh Firebase sign-in/reauthentication after release/reset, then register. Token refresh alone is insufficient. |

When enforcement is disabled, students can use the API without device headers.
Logout with no header is a successful no-op; a matching header can still release
a preserved registration. A different UUID cannot release another registration.
Admin logout is a successful no-op on device registrations.

After logout/reset, the Firebase `auth_time` must be strictly later than the
release timestamp. Because Firebase timestamps have second precision, signing
in during the same second may require another sign-in in the following second.
Existing matching registrations continue accepting valid refreshed tokens.

## Lost devices and role changes

An admin or super admin can reset a student:

```http
POST /api/v1/admin/users/<local-user-UUID>/reset-device
Authorization: Bearer <administrator Firebase token>
```

Success returns `204`. The student must sign in again and register when the
restriction is enabled. Unknown users return `404`; accounts being deleted
return `409`. Only `USER` accounts can be reset; admins have no device limit.
Reset is available even while enforcement is disabled.

User listing and role changes remain super-admin-only. Changing between `USER`
and `ADMIN` clears the registration and records a release timestamp. A demoted
admin must perform a fresh sign-in and register when restrictions are enabled.
Reapplying the same role preserves device state.

## Account deletion

`DELETE /api/v1/me` follows the same student-only flag policy and retains the
existing requirement for a Firebase sign-in within the last five minutes.
Accepted restricted requests save a SHA-256 device hash so retries can be
verified after the user row is removed. While the flag is disabled, retries
require only valid authentication for the same Firebase UID.

Requests accepted while disabled, by admins, or before this migration have no
device hash. They remain retryable by the same Firebase identity even if the
flag is subsequently enabled. Background deletion is independent of the flag.

## Rollout

Apply `drizzle/0006_device_restriction.sql` before deploying the updated backend.
It adds the device columns and settings table and seeds the flag as disabled.
Update clients before enabling the flag through the admin settings endpoint.

The test client sends a persistent UUID, supports backend logout and device
resets, and provides controls for reading/changing the flag. Production E2E
state also retains actor UUIDs; keep its private state file between runs.

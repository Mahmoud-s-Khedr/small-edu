# Authentication and user-management integration guide

Read [README.md](README.md) first for the base URL and common envelopes.

## Client sign-in sequence

1. Sign in with the Firebase client SDK using verified email/password, Google,
   or Apple.
2. Obtain a current Firebase ID token with `getIdToken()`.
3. Call `POST /auth/session` using that token.
4. Use a current/refreshed token in the `Authorization` header for every later
   protected request.

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
```

## `POST /auth/session`

**Job:** creates or links the signed-in Firebase identity to a local Medly user.
Call once after every Firebase login, before protected API use. It is
idempotent, so retrying it is safe.

**Authentication:** Firebase bearer token required.

**Request DTO:** no body.

```http
POST /auth/session
Authorization: Bearer <Firebase ID token>
```

**Expected response — `200 OK`**

```ts
type Response = Success<{
  user: User;
  created: boolean; // true only when a new local Medly user was created
}>;
```

**Important errors:** `401` for an invalid, expired, different-project, or
unverified-email Firebase token; `409` when the verified email is already
linked to a different Firebase identity.

## `GET /me`

**Job:** returns the currently authenticated local Medly user and role. Use it
to restore client session state or decide whether to show admin controls.

**Authentication:** Firebase bearer token required.

**Request DTO:** none.

**Expected response — `200 OK`**

```ts
type Response = Success<User>;
```

## `GET /admin/users` — Super admin only

**Job:** lists local users for the super-admin role-management screen.

**Authentication:** local `SUPER_ADMIN` role required.

**Request DTO:** none.

**Expected response — `200 OK`**

```ts
type Response = Success<User[]>;
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
type Response = Success<User>;
```

`SUPER_ADMIN` cannot be granted, changed, or removed through this endpoint; it
is controlled by deployment-time administration. Trying to modify a super
admin returns `409 CONFLICT`.

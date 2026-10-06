# Medly client integration guides

These guides describe the API contract implemented by the Worker for the web
and mobile clients. Read this file first, then use the guide for the feature
you are implementing.

| Guide | Covers |
| --- | --- |
| [authentication-and-users.md](authentication-and-users.md) | Firebase sign-in, local session provisioning, current user, and super-admin user roles |
| [modules-and-lectures.md](modules-and-lectures.md) | Module and lecture catalogues, video access, materials, and direct material uploads |
| [bookings.md](bookings.md) | Payment-receipt direct uploads, booking requests, and admin decisions |
| [flashcards.md](flashcards.md) | Flashcard content, private-image uploads, and per-user study state |
| [mcqs.md](mcqs.md) | Multiple-choice question content, correct-choice flags, and answer checks |
| [system.md](system.md) | Health check, request conventions, direct-upload protocol, errors, pagination, and binary downloads |

The live OpenAPI document is also available from a deployed Worker at
`GET /api/v1/openapi`, with Swagger UI at `GET /api/v1/docs`.

## Base URLs

```text
Development: https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1
Local:       http://localhost:8787/api/v1
```

Paths in these guides are relative to the selected base URL. All IDs named
`*Id` are UUIDs. All timestamps are ISO 8601 UTC strings, for example
`2026-09-29T12:00:00.000Z`.

## Authentication and response envelopes

Except for `GET /health`, every request must use a current Firebase ID token:

```http
Authorization: Bearer <Firebase ID token>
```

The client must call `POST /auth/session` after Firebase sign-in and before
calling the other protected endpoints. Firebase identifies the person; the
Medly API's local user record determines their `USER`, `ADMIN`, or
`SUPER_ADMIN` permissions.

Successful JSON responses use this envelope:

```ts
type Success<T> = { data: T };

type Paginated<T> = {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    limit: number;
    offset: number;
    total: number;
  };
};
```

Unless a guide says otherwise, list endpoints accept `page` (default `1`) and
`pageSize` (default `20`, range `1`–`100`). `204 No Content` responses have no
body.

Error responses have a consistent shape:

```ts
type ApiError = {
  error: {
    code:
      | 'BAD_REQUEST'
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'VALIDATION_ERROR'
      | 'INTERNAL_ERROR'
      | 'SERVICE_UNAVAILABLE';
    message: string;
    details?: unknown; // Present on validation failures.
  };
};
```

`401` means the token is missing, invalid, expired, unverified, or has not yet
been provisioned through `/auth/session`. `403` means the signed-in local user
lacks the required role or module-video entitlement. A `422 VALIDATION_ERROR`
means request data did not match the documented DTO. `503 SERVICE_UNAVAILABLE`
is returned when direct R2 signing is not configured.

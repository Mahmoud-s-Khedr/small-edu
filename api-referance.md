# Medly API reference

Development base URL: `https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1`

Local base URL: `http://localhost:8787/api/v1`

The paths below are relative to either base URL.

This reference describes the API implemented in `src/routes/`. All identifiers
shown as `*Id` are UUIDs. JSON timestamps are serialized as ISO 8601 UTC
strings, for example `"2026-09-16T12:00:00.000Z"`.

> **Authentication:** the client completes verified email/password, Google, or
> Apple sign-in with Firebase Auth, calls `POST /auth/session` with its Firebase ID token, then sends that current
> token as `Authorization: Bearer <Firebase ID token>` to protected endpoints.
> The Worker verifies Firebase's RS256 token signature, issuer, audience,
> expiry, issued-at, non-empty UID, and verified email. Firebase claims do not
> grant privileged access; `ADMIN` and `SUPER_ADMIN` exist only in the local D1 user record. The API
> rejects unverified-email tokens.

## Conventions

Successful JSON responses use one of these envelopes:

```ts
type Success<T> = { data: T };
type Paginated<T> = {
  data: T[];
  meta: { page: number; pageSize: number; limit: number; offset: number; total: number };
};

type ApiError = {
  error: {
    code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' |
      'VALIDATION_ERROR' | 'INTERNAL_ERROR';
    message: string;
    details?: unknown; // Present for validation errors.
  };
};
```

`204 No Content` responses have no response body. List routes with pagination
accept `page` (integer, default `1`) and `pageSize` (integer, `1`–`100`,
default `20`) unless stated otherwise.

All routes except `GET /health` require a bearer token. Routes labelled
**Admin** additionally require a local user with `role: "ADMIN"` or `"SUPER_ADMIN"`.

### Shared DTOs

```ts
type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
type BookingStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
type Knowledge = 'KNOWN' | 'UNKNOWN';

type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

type Module = {
  id: string;
  title: string;
  number: string;
  academicYear: string;
  semester: string;
  priceCents: number;
  createdAt: string;
  updatedAt: string;
};

type Lecture = {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  subject: string;
  lectureDate: string;
  videoUrl: string;
  createdAt: string;
  updatedAt: string;
};

type Material = {
  id: string;
  lectureId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

type Booking = {
  id: string;
  userId: string;
  moduleId: string;
  receiptFilename: string;
  receiptContentType: string;
  receiptSizeBytes: number;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
};

type Upload = {
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};
```

## Health, session, and current user

### `GET /health`

Public health check.

```ts
// 200
type Response = Success<{ status: 'ok' }>;
```

### `POST /auth/session`

Provisions the authenticated Firebase identity as a local Medly user. Requires
`Authorization: Bearer <Firebase ID token>` and always returns `200` on a valid,
verified token; repeated calls are safe.

```ts
type Response = Success<{ user: User; created: boolean }>;
```

If the Firebase UID is already linked, the existing local user is returned
unchanged. A legacy user with the same verified email and no linked Firebase UID
is linked in place. A new user gets role `"USER"` and either Firebase's display
name or the email local part. A verified email already linked to another Firebase
UID returns `409 CONFLICT`.

### `GET /me`

Returns the authenticated local user.

```ts
// 200
type Response = Success<User>;
```

## Super-admin user management

These routes require a local user with `role: "SUPER_ADMIN"`. A super admin can
grant or revoke the operational `ADMIN` role, but cannot create, change, or
remove another super admin through the API.

### `GET /admin/users`

Lists local users for the super-admin management screen.

```ts
type Response = Success<User[]>;
```

### `PATCH /admin/users/:userId/role`

Promotes a provisioned user to `ADMIN` or demotes an admin to `USER`.

```ts
// Request
{ role: 'USER' | 'ADMIN' }

// 200
type Response = Success<User>;
```

## Modules

### `GET /modules`

Lists modules.

```ts
type Query = {
  page?: number;
  pageSize?: number;
  number?: string;
  academicYear?: string;
  semester?: string;
};

// 200
type Response = Paginated<Module>;
```

### `POST /modules` — Admin

```ts
type Body = {
  title: string;        // 1–200 characters
  number: string;       // 1–50 characters
  academicYear: string; // 1–30 characters
  semester: string;     // 1–30 characters
  priceCents: number;   // non-negative integer
};

// 201
type Response = Success<Module>;
```

### `GET /modules/:moduleId`

```ts
type Path = { moduleId: string };
// 200
type Response = Success<Module>;
```

### `PATCH /modules/:moduleId` — Admin

At least one field is required. Each supplied field has the same validation as
the create DTO.

```ts
type Path = { moduleId: string };
type Body = Partial<{
  title: string;
  number: string;
  academicYear: string;
  semester: string;
  priceCents: number;
}>;

// 200
type Response = Success<Module>;
```

### `DELETE /modules/:moduleId` — Admin

Deletes the module and its related database records through cascade deletion.

```ts
type Path = { moduleId: string };
// 204 No Content
```

### `GET /modules/:moduleId/lectures`

Lists lectures belonging to one module. For a user without accepted module
access, `videoUrl` is `null` and `videoLocked` is `true`.

```ts
type Path = { moduleId: string };
type Query = {
  page?: number;
  pageSize?: number;
  subject?: string;
  from?: string; // Date accepted by JavaScript date parsing, preferably ISO 8601
  to?: string;
};

type LectureListItem = Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
};
// 200
type Response = Paginated<LectureListItem>;
```

### `POST /modules/:moduleId/lectures` — Admin

```ts
type Path = { moduleId: string };
type Body = {
  title: string;       // 1–250 characters
  description?: string; // maximum 10,000 characters; defaults to ""
  subject: string;     // 1–150 characters
  lectureDate: string; // ISO 8601 date/time recommended
  videoUrl: string;    // valid URL, maximum 2,000 characters
};

// 201
type Response = Success<Lecture>;
```

## Lectures and materials

### `GET /lectures`

Lists lectures across modules. Each item includes `academicYear` and `semester`
from its module. For a user without accepted module access, `videoUrl` is
`null` and `videoLocked` is `true`.

```ts
type Query = {
  page?: number;
  pageSize?: number;
  moduleId?: string;
  subject?: string;
  academicYear?: string;
  semester?: string;
  from?: string;
  to?: string;
};

type LectureListItem = Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
  academicYear: string;
  semester: string;
};
// 200
type Response = Paginated<LectureListItem>;
```

### `GET /lectures/:lectureId`

Returns one lecture. For a user without accepted access to the lecture's module,
`videoUrl` is `null` and `videoLocked` is `true`. Admins always have video
access.

```ts
type Path = { lectureId: string };
type ResponseBody = Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
};

// 200
type Response = Success<ResponseBody>;
```

### `PATCH /lectures/:lectureId` — Admin

At least one field is required. Each supplied field has the same validation as
the lecture-create DTO.

```ts
type Path = { lectureId: string };
type Body = Partial<{
  title: string;
  description: string;
  subject: string;
  lectureDate: string;
  videoUrl: string;
}>;

// 200
type Response = Success<Lecture>;
```

### `DELETE /lectures/:lectureId` — Admin

```ts
type Path = { lectureId: string };
// 204 No Content
```

### `GET /lectures/:lectureId/materials`

Lists file metadata. Internal R2 object keys are deliberately not included.

```ts
type Path = { lectureId: string };
// 200
type Response = Success<Material[]>;
```

### Upload files

All file uploads use the same two API endpoints. `POST /uploads` accepts:

```ts
type Body =
  | { purpose: 'lecture-material'; lectureId: string; filename: string; contentType: string; sizeBytes: number }
  | { purpose: 'flashcard-image'; lectureId: string; filename: string; contentType: string; sizeBytes: number }
  | { purpose: 'payment-receipt'; filename: string; contentType: string; sizeBytes: number }; // max 100 MiB
type Response = Success<Upload & {
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: { 'Content-Type': string };
}>;
```

PUT the file bytes directly to `uploadUrl` with `requiredHeaders`, then call
`POST /uploads/complete` with `{ objectKey, ...Body }`. It verifies the stored
object. A lecture-material completion creates and returns `Success<Material>`;
receipt and image completion return `Success<Upload>`. Lecture material and
flashcard image uploads require an admin role. No lecture-material MIME-type
allowlist is applied; receipts allow PDF/JPEG/PNG and flashcard images allow
JPEG/PNG/WebP.

### `GET /lectures/:lectureId/materials/:materialId/download`

Downloads the stored private file. The response has the stored content type and
an `attachment` `Content-Disposition` filename.

```ts
type Path = { lectureId: string; materialId: string };
// 200 binary response
```

### `PATCH /lectures/:lectureId/materials/:materialId` — Admin

```ts
type Path = { lectureId: string; materialId: string };
type Body = { originalFilename: string }; // trimmed, 1–255 characters
// 200
type Response = Success<Material>;
```

### `DELETE /lectures/:lectureId/materials/:materialId` — Admin

Deletes the metadata record and its private R2 object.

```ts
type Path = { lectureId: string; materialId: string };
// 204 No Content
```

### `GET /lectures/:lectureId/video`

Requires an admin role or accepted module access. Returns the external video
URL only after that access check.

```ts
type Path = { lectureId: string };
// 200
type Response = Success<{ videoUrl: string }>;
```

## Bookings

### Payment-receipt upload

Use the common upload flow with `purpose: 'payment-receipt'`. Allowed MIME
types are `application/pdf`, `image/jpeg`, and `image/png`; completion returns
`Success<Upload>` with 201.

Keep the returned `objectKey`: it is required when creating the booking and is
accepted only if it belongs to the authenticated user.

Unsubmitted receipt uploads are removed after 24 hours by the scheduled Worker
cleanup. A client can discard one immediately with the endpoint below.

### `DELETE /bookings/receipt`

Deletes an unsubmitted receipt owned by the authenticated user. Submitted
receipts are retained for the booking-review record.

```ts
type Body = { receiptKey: string };
// 204 No Content
```

### `POST /bookings`

Creates a pending booking request. One active (`PENDING` or `ACCEPTED`)
booking per user/module is allowed.

```ts
type Body = {
  moduleId: string;
  receiptKey: string; // objectKey returned by POST /bookings/receipt
};

// 201
type Response = Success<Booking>;
```

### `GET /bookings`

Lists the authenticated user's booking requests, newest first.

```ts
// 200
type Response = Success<Booking[]>;
```

### `GET /admin/bookings` — Admin

```ts
type Query = {
  page?: number;
  pageSize?: number;
  status?: BookingStatus;
};

// 200
// Note: this endpoint's meta has page/pageSize/limit/offset, but not total.
type Response = {
  data: Booking[];
  meta: { page: number; pageSize: number; limit: number; offset: number };
};
```

### `PATCH /admin/bookings/:bookingId` — Admin

Only a `PENDING` booking can be decided. Accepting a request grants module
video access to the booking's user.

```ts
type Path = { bookingId: string };
type Body = { status: 'ACCEPTED' | 'REJECTED' };
// 200
type Response = Success<Booking>;
```

### `GET /admin/bookings/:bookingId/receipt` — Admin

Downloads the private payment receipt for review. The receipt object key is
never exposed in a JSON response.

```ts
type Path = { bookingId: string };
// 200 binary response
```

## Flashcards

```ts
type FlashcardState = {
  knowledge: Knowledge | null;
  hidden: boolean;
  viewedAt: string | null;
  updatedAt: string;
};

type Flashcard = {
  id: string;
  lectureId: string;
  frontText: string | null;
  backText: string | null;
  ordering: number;
  createdAt: string;
  updatedAt: string;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  state: FlashcardState | null;
};
```

The response never includes internal image keys. `frontImageUrl` and
`backImageUrl` are short-lived, presigned R2 download URLs. A non-admin user's
hidden cards are omitted from the list; an admin can list them.

### `GET /lectures/:lectureId/flashcards`

```ts
type Path = { lectureId: string };
// 200
type Response = Success<Flashcard[]>;
```

### `GET /flashcards/:flashcardId`

Returns one complete flashcard, including its front/back image download URLs
and the requesting user's study state.

```ts
type Path = { flashcardId: string };
// 200
type Response = Success<Flashcard>;
```

### `POST /lectures/:lectureId/flashcards` — Admin

At least one front value and one back value are required. Image keys must have
been returned by the flashcard-image upload endpoint for this same lecture.

```ts
type Path = { lectureId: string };
type Body = {
  frontText?: string | null;     // maximum 10,000 characters
  frontImageKey?: string | null; // maximum 500 characters
  backText?: string | null;      // maximum 10,000 characters
  backImageKey?: string | null;  // maximum 500 characters
  ordering?: number;             // non-negative integer; defaults to 0
};

// 201
type Response = Success<Flashcard>;
```

### Flashcard-image upload — Admin

Use the common upload flow with `purpose: 'flashcard-image'` and `lectureId`.
Allowed MIME types are `image/jpeg`, `image/png`, and `image/webp`; completion
returns `Success<Upload>` with 201.

### `PATCH /flashcards/:flashcardId` — Admin

At least one field is required. The fields and validation are the same as the
flashcard create body, except that either side may be omitted in a patch.

```ts
type Path = { flashcardId: string };
type Body = Partial<{
  frontText: string | null;
  frontImageKey: string | null;
  backText: string | null;
  backImageKey: string | null;
  ordering: number;
}>;
// 200
type Response = Success<Flashcard>;
```

### `DELETE /flashcards/:flashcardId` — Admin

```ts
type Path = { flashcardId: string };
// 204 No Content
```

### `PUT /flashcards/:flashcardId/state`

Creates or updates the requesting user's state for one card. At least one
property is required. `viewed: true` sets `viewedAt` to the current time;
`viewed: false` leaves an existing `viewedAt` unchanged.

```ts
type Path = { flashcardId: string };
type Body = {
  knowledge?: Knowledge | null;
  hidden?: boolean;
  viewed?: boolean;
};
// 200
type Response = Success<{
  userId: string;
  flashcardId: string;
  knowledge: Knowledge | null;
  hidden: boolean;
  viewedAt: string | null;
  updatedAt: string;
  viewed?: boolean;
}>;
```

### `GET /lectures/:lectureId/flashcards/progress`

```ts
type Path = { lectureId: string };
// 200
type Response = Success<{ total: number; known: number; hidden: number }>;
```


## MCQs

```ts
type McqChoiceInput = {
  text: string;      // trimmed, 1–2,000 characters
  isCorrect: boolean;
};

type McqInput = {
  questionText: string; // trimmed, 1–10,000 characters
  ordering?: number;    // non-negative integer; defaults to 0
  choices: [McqChoiceInput, McqChoiceInput, McqChoiceInput, McqChoiceInput];
  // Exactly one choice must have isCorrect: true.
};

type McqChoice = {
  id: string;
  mcqId: string;
  choiceText: string;
  isCorrect: boolean;
  ordering: number;
};

type Mcq = {
  id: string;
  lectureId: string;
  questionText: string;
  ordering: number;
  choices: McqChoice[];
};
```

Correct-answer values are included in MCQ list, create, and update responses.
`POST /mcqs/:mcqId/check-answer` remains available for future progress tracking.

### `GET /lectures/:lectureId/mcqs`

```ts
type Path = { lectureId: string };
// 200
type Response = Success<Mcq[]>;
```

### `POST /lectures/:lectureId/mcqs` — Admin

```ts
type Path = { lectureId: string };
type Body = McqInput;
// 201
type Response = Success<Mcq>;
```

### `PATCH /mcqs/:mcqId` — Admin

At least one field is required. If `choices` is supplied, it replaces the four
existing choices and must still contain exactly one correct choice.

```ts
type Path = { mcqId: string };
type Body = Partial<McqInput>;
// 200
type Response = Success<Mcq>;
```

### `DELETE /mcqs/:mcqId` — Admin

```ts
type Path = { mcqId: string };
// 204 No Content
```

### `POST /mcqs/:mcqId/check-answer`

Checks that `choiceId` belongs to this MCQ and then returns the result. No quiz
attempt, grade, or history is persisted.

```ts
type Path = { mcqId: string };
type Body = { choiceId: string };
// 200
type Response = Success<{ correct: boolean; correctChoiceId: string }>;
```

## Implementation notes

- Prefer direct R2 uploads: `POST /uploads` with the shared file metadata and
  purpose; PUT the bytes to `data.uploadUrl` with `data.requiredHeaders`; then
  POST the returned `objectKey` and the same input to `/uploads/complete`.
  URLs expire after 10 minutes and must be treated as bearer tokens.
- The API accepts dates through JavaScript date coercion. ISO 8601 UTC strings
  are the portable client format.

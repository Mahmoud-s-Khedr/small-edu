# Flashcards integration guide

Read [README.md](README.md) first for the base URL and common envelopes. All
API endpoints require a Firebase bearer token. Content-management endpoints
marked **Admin** require a local `ADMIN` or `SUPER_ADMIN` role. The signed R2
image URLs returned in card data are the exception: they are temporary
download capabilities and are fetched directly without that header.

```ts
type Knowledge = 'KNOWN' | 'UNKNOWN';

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
  frontImageUrl: string | null;
  backImageUrl: string | null;
  ordering: number;
  createdAt: string;
  updatedAt: string;
  state: FlashcardState | null;
};

type Upload = {
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};
```

The list and single-card responses deliberately give short-lived, presigned R2
download URLs rather than internal storage keys. A student does not receive
cards they marked hidden; admins can see those cards. Study state is per user
and does not change card content for anyone else.

## `GET /lectures/:lectureId/flashcards`

**Job:** load the cards and this user's stored state for a lecture study screen.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`:** `Success<Flashcard[]>`.

`state` is `null` until the user updates that card's state.

## `GET /flashcards/:flashcardId`

**Job:** load one complete flashcard, including its text, state, and temporary
download URLs for any front/back images.

**Path DTO:** `type Path = { flashcardId: string }; // UUID`

**Expected response — `200 OK`:** `Success<Flashcard>`.

`frontImageUrl` and `backImageUrl` are signed R2 download URLs. They can be
used directly by an image component until they expire (currently after 10
minutes); reload the card to obtain refreshed URLs.

## Direct flashcard-image upload — Admin

**Job:** upload an image before creating or updating a card that references it.

1. `POST /uploads` with
   `{ purpose: 'flashcard-image', lectureId, filename, contentType, sizeBytes }` (maximum 100 MiB).
2. `PUT` the image bytes directly to `data.uploadUrl` using
   `data.requiredHeaders`.
3. `POST /uploads/complete` with the returned `objectKey`, `purpose`,
   `lectureId`, and the same metadata.
4. `POST /lectures/:lectureId/flashcard-images` with
   `{ uploadKey: data.objectKey }` to attach the verified image to its lecture.

Allowed MIME types are `image/jpeg`, `image/png`, and `image/webp`. The
completion endpoint returns `201 Created`: `Success<Upload>`.

Use the attached `data.objectKey` as `frontImageKey` or `backImageKey` in a
subsequent admin create/update request for the same lecture.

## `POST /lectures/:lectureId/flashcards` — Admin

**Job:** create a flashcard.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Request DTO**

```ts
type Body = {
  frontText?: string | null;     // max 10,000 characters
  frontImageKey?: string | null; // Upload key for this lecture, max 500 chars
  backText?: string | null;      // max 10,000 characters
  backImageKey?: string | null;  // Upload key for this lecture, max 500 chars
  ordering?: number;             // non-negative integer; defaults to 0
};
```

At least one front value (`frontText` or `frontImageKey`) and one back value
are required.

**Expected response — `201 Created`:** `Success<Flashcard>`.

## `PATCH /flashcards/:flashcardId` — Admin

**Job:** update one or more card fields.

**Path DTO:** `type Path = { flashcardId: string }; // UUID`

**Request DTO:** one or more fields from `Partial<Body>` above. After applying
the patch, a card must still have content on both front and back. New image keys
must have been uploaded for that card's lecture.

**Expected response — `200 OK`:** `Success<Flashcard>`.

## `DELETE /flashcards/:flashcardId` — Admin

**Job:** permanently delete a card. Images that are no longer referenced by any
other card are removed from private storage.

**Path DTO:** `type Path = { flashcardId: string }; // UUID`

**Expected response — `204 No Content`.**

## `PUT /flashcards/:flashcardId/state`

**Job:** save the signed-in user's knowledge, visibility, and/or viewed state
for one card. Use after the learner chooses known/don't know, hides a card, or
views it.

**Path DTO:** `type Path = { flashcardId: string }; // UUID`

**Request DTO**

```ts
type Body = {
  knowledge?: 'KNOWN' | 'UNKNOWN' | null;
  hidden?: boolean;
  viewed?: boolean;
};
```

At least one property is required. `viewed: true` records the current time;
`viewed: false` does not clear an already recorded `viewedAt`.

**Expected response — `200 OK`**

```ts
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

For a new state record, omitted `knowledge` and `hidden` values initialize to
`null` and `false`. On a partial update, only supplied `knowledge`/`hidden`
values are persisted (and `viewed: true` records a timestamp). Treat this
write response as an acknowledgement; reload the card/list if the client needs
the complete canonical state after a partial update.

After successful `hidden: true`, remove the card from a non-admin learner's
local list; it will also be omitted on the next list request.

## `GET /lectures/:lectureId/flashcards/progress`

**Job:** load the learner's aggregate study progress for a lecture.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`**

```ts
type Response = Success<{ total: number; known: number; hidden: number }>;
```

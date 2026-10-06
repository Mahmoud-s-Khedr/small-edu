# System integration guide

Read [README.md](README.md) first for the base URL, authentication header, and
shared response envelopes.

## `GET /health`

**Job:** lets a client, monitoring system, or deployment check that the Worker
is responding. This is the only public endpoint.

**Authentication:** none.

**Request DTO:** none.

**Expected response — `200 OK`**

```json
{ "data": { "status": "ok" } }
```

## Client request rules

- Send JSON requests with `Content-Type: application/json`.
- Send dates as ISO 8601 UTC strings, such as
  `2026-09-29T12:00:00.000Z`.
- For files, POST the file metadata and a `purpose` to `/uploads`, `PUT` the
  raw bytes directly to the returned URL with the returned `Content-Type`,
  then POST the returned key and the same metadata to `/uploads/complete`.
  Lecture-material and flashcard-image uploads also require `lectureId` in both
  API calls. Do not use `multipart/form-data` or send the Firebase token to R2.
  `payment-receipt` completion verifies the upload and returns the key;
  `lecture-material` completion also creates the material record.
- Treat the returned upload URL as a short-lived bearer credential. It is
  scoped to one named object and expires after 10 minutes; retrying the PUT
  before expiry replaces that same object.
- Treat `204 No Content` as a successful response with no JSON to parse.
- For binary download endpoints, consume the response as bytes/blob/file
  rather than JSON. The response supplies `Content-Type` and an attachment
  filename in `Content-Disposition`.

## Standard client error handling

| Status | Client action |
| --- | --- |
| `401` | Refresh/retrieve the Firebase token. If the user has just signed in, call `POST /auth/session`; otherwise return to sign-in if refresh fails. |
| `403` | Keep the user signed in; show the feature as unavailable or locked. A lecture-video `403` means no accepted module access. |
| `404` | The referenced item no longer exists or is unavailable. Refresh the current screen/list. |
| `409` | Show the conflict message. Common examples are a duplicate active booking or deciding a booking that was already decided. |
| `422` | Show field-level validation feedback using `error.details` when useful. |
| `500` | Show a retryable generic failure and log enough client context for support. |
| `503` | Presigned R2 URL creation is not configured on the Worker (affecting `/uploads` and flashcard-image URLs). Do not fall back to a public bucket; contact the deployment owner. |

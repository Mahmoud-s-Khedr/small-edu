# Bookings integration guide

Read [README.md](README.md) first for the base URL and common envelopes. All
endpoints require a Firebase bearer token. Admin endpoints require a local
`ADMIN` or `SUPER_ADMIN` role.

```ts
type BookingStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

type Booking = {
  id: string;
  userId: string | null; // Null after account deletion.
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

## Student booking flow

```text
POST /uploads (purpose: 'payment-receipt')
  → PUT bytes to data.uploadUrl with data.requiredHeaders
  → POST /uploads/complete
  → retain data.objectKey
POST /bookings with moduleId + receiptKey
  → show PENDING booking
admin accepts booking
  → video becomes available through the lecture endpoints
```

There is no `POST /bookings/receipt` endpoint. Receipt uploads use the shared
`/uploads` protocol below. All payment receipts are retained, including
unsubmitted uploads and receipts belonging to deleted accounts. There is no
automatic cleanup of payment receipts.

## Direct receipt upload

**Job:** upload a payment receipt before submitting a booking request.

1. `POST /uploads` with:

   ```ts
   type Body = { purpose: 'payment-receipt'; filename: string; contentType: string; sizeBytes: number }; // max 100 MiB
   ```

2. `PUT` file bytes to `data.uploadUrl` with `data.requiredHeaders`.
3. `POST /uploads/complete` with `data.objectKey`, `purpose`, and the same
   metadata to verify the R2 object.

Allowed MIME types are `application/pdf`, `image/jpeg`, and `image/png`.
The completion response is `201 Created`:

```ts
type Response = Success<Upload>;
```

Keep `data.objectKey` only long enough to submit the receipt; it is an
opaque server storage key and is never returned in booking-list responses.

## `POST /bookings`

**Job:** create a pending module-access request from an uploaded receipt.

**Request DTO**

```ts
type Body = {
  moduleId: string;   // UUID
  receiptKey: string; // data.objectKey from POST /uploads/complete
};
```

**Expected response — `201 Created`:** `Success<Booking>`.

**Important errors:** `409 CONFLICT` if the receipt does not belong to the
signed-in user or they already have a `PENDING`/`ACCEPTED` booking for that
module; `404` if the module or uploaded receipt cannot be found.

## `DELETE /bookings/receipt`

**Job:** compatibility endpoint; payment receipt deletion is disabled.

```ts
type Body = { receiptKey: string };
```

**Expected response — `409 CONFLICT`.** An owned receipt is retained regardless
of submission status. A key outside the caller's receipt prefix also returns
`409`; no R2 object is deleted.

## `GET /bookings`

**Job:** list the signed-in student's booking history, newest first.

**Request DTO:** none.

**Expected response — `200 OK`:** `Success<Booking[]>`.

## `GET /admin/bookings` — Admin

**Job:** list submitted booking requests for a payment-review queue.

**Request DTO**

```ts
type Query = {
  page?: number;
  pageSize?: number;
  status?: BookingStatus;
};
```

**Expected response — `200 OK`**

```ts
type Response = {
  data: Booking[];
  meta: { page: number; pageSize: number; limit: number; offset: number };
};
```

Unlike the standard paginated response, this endpoint currently does not return
`meta.total`.

## `GET /admin/bookings/:bookingId/receipt` — Admin

**Job:** obtain a newly signed private-receipt URL for legacy clients.

**Path DTO:** `type Path = { bookingId: string }; // UUID`

**Expected response — `302 Found`:** redirects to a 10-minute signed R2 `GET`
URL. Prefer `receiptDownloadUrl` returned by the admin booking list. The client
never receives the receipt storage key.

## `PATCH /admin/bookings/:bookingId` — Admin

**Job:** accept or reject a pending booking. Accepting the booking grants the
student access to the module's videos as part of the same server-side operation.

**Path DTO:** `type Path = { bookingId: string }; // UUID`

**Request DTO**

```ts
type Body = { status: 'ACCEPTED' | 'REJECTED' };
```

**Expected response — `200 OK`:** `Success<Booking>`.

Bookings retained after account deletion have `userId: null`. Their receipts
remain downloadable; decisions do not grant access when no active user exists.

Only a `PENDING` booking may be decided. A second decision attempt returns
`409 CONFLICT`; the UI should refresh the queue item.

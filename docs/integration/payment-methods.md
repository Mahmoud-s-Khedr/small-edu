# Payment methods

Payment methods store manual-transfer instructions. They do not process or
verify transfers. Continue using the [booking flow](bookings.md) to upload a
receipt and request module access.

All paths below are relative to `/api/v1` and require a Firebase bearer token.
Any authenticated user can list methods. Only `ADMIN` and `SUPER_ADMIN` can
create, edit, or delete them.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/payment-methods` | `200 { data: PaymentMethod[] }` |
| POST | `/payment-methods` | `201 { data: PaymentMethod }` |
| PATCH | `/payment-methods/:paymentMethodId` | `200 { data: PaymentMethod }` |
| DELETE | `/payment-methods/:paymentMethodId` | `204`, no body |

The list returns all methods sorted by `key`, without pagination.
`paymentMethodId` is a UUID.

```ts
type PaymentMethod = {
  id: string;
  key: string;
  value: string;
  description: string;
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
};
```

Create a method with all three fields:

```json
{
  "key": "instapay",
  "value": "your-account@instapay",
  "description": "Transfer to this account, then upload your receipt."
}
```

`key` is unique and case-sensitive, with 1–100 characters. `value` has
1–2,000 characters. `description` has up to 10,000 characters and may be empty.
All three strings are trimmed. PATCH accepts any nonempty subset of these
fields, including a new key. Omitted fields keep their current values.

Errors: `401` for unauthenticated requests; `403` for student writes;
`404` for editing/deleting a missing method; `409 CONFLICT` for a duplicate
key; `422 VALIDATION_ERROR` for invalid fields, an invalid UUID, or an empty
PATCH. Deleting a method leaves existing bookings and receipts intact.

Fetch this list for the booking screen instead of embedding transfer accounts
in the client build.

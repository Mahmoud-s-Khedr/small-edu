# Module faculties: frontend integration update

The faculty update is deployed. Use this guide to update the student catalogue
and admin module forms.

Base URL: `https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1`

[Live API documentation](https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/docs)
· [Full modules and lectures guide](modules-and-lectures.md)

## Required frontend changes

- Add `facultyName: string` to the shared module model, including modules nested
  inside lecture and booking responses.
- Add a required faculty field to the admin create-module form.
- Allow admins to assign or change a module's faculty in the edit form.
- Populate the student faculty picker with `GET /faculties`, including pagination.
- Send the selected faculty to module and catalogue filter endpoints.
- Handle older modules whose `facultyName` is `""`.

## Authentication

Every endpoint below requires a provisioned Medly session and a current
Firebase ID token:

```http
Authorization: Bearer <Firebase ID token>
```

For `USER` accounts, also send the persistent installation UUID in `X-Device-ID`
when device restriction is enabled. Admins are exempt from that device header.
See [device registration](device-registration-update.md).

## Module model

```ts
type Module = {
  id: string;
  title: string;
  number: string;
  facultyName: string; // New; may be "" for an older, unassigned module.
  academicYear: string;
  semester: string;
  priceCents: number;
  access_status: 'default' | 'full_access' | 'pending' | 'approved';
  createdAt: string;
  updatedAt: string;
};
```

Faculty names are strings, not IDs. There is no separate faculty resource or
faculty CRUD endpoint. The available names come from existing modules.

Names are trimmed and matched exactly, including capitalization. For example,
`Medicine` and `medicine` are different faculties. Reuse the exact string
returned by the API when selecting an existing faculty.

## Faculty picker

```http
GET /faculties?page=1&pageSize=20
```

Returns distinct, nonempty faculty names in alphabetical order:

```json
{
  "data": ["Dentistry", "Medicine"],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "limit": 20,
    "offset": 0,
    "total": 2
  }
}
```

`page` must be an integer of at least 1. `pageSize` must be an integer from 1
through 50. Defaults are page 1 and 20 items. `meta.total` counts faculties,
not modules. A page past the last page returns an empty `data` array.

Use load-more behavior or fetch subsequent pages until
`meta.offset + data.length >= meta.total`. Do not assume the first page is the
complete faculty list. An empty list is a valid result, including when all
modules are still unassigned.

For admin forms, provide existing-name suggestions plus text entry for a new
faculty. A select restricted to existing names would prevent creation of the
first module for a new faculty. Creating that module makes the name available
in `/faculties`; removing or reassigning the last module removes its old name.

## Faculty-aware catalogue requests

All paths below are relative to the base URL. All supplied filters are combined
with AND. Omit optional filters when they are not selected; do not send
`facultyName=` or whitespace, because those values return `422`.

| Endpoint | Supported filters | Successful response |
| --- | --- | --- |
| `GET /modules` | `facultyName`, `number`, `academicYear`, `semester`, `page`, `pageSize` | `{ data: Module[], meta: { page, pageSize, limit, offset, total } }` |
| `GET /academic-years` | `facultyName` | `{ data: string[] }`, newest year string first |
| `GET /semesters` | `facultyName`, `academicYear` | `{ data: string[] }`, alphabetical |
| `GET /subjects` | `facultyName`, `academicYear`, `semester`, `moduleId` | `{ data: string[] }`, alphabetical |

The three catalogue endpoints after `/modules` return distinct values without
pagination. Unknown faculties or incompatible filter combinations return empty
arrays; they do not return `404`.

Example requests:

```http
GET /academic-years?facultyName=Medicine
GET /semesters?facultyName=Medicine&academicYear=2026
GET /modules?facultyName=Medicine&academicYear=2026&semester=Fall&page=1&pageSize=20
GET /subjects?facultyName=Medicine&academicYear=2026&semester=Fall
```

Build query strings with `URLSearchParams` so spaces, Arabic text, `&`, and
other characters in faculty names are encoded correctly:

```ts
const params = new URLSearchParams({
  facultyName: selectedFaculty,
  academicYear: selectedYear,
  semester: selectedSemester,
  page: '1',
  pageSize: '20',
});
// Use the existing authenticated API client.
const response = await api.get(`/modules?${params.toString()}`);
```

For cascading pickers, use this sequence:

1. Load faculties.
2. After faculty selection, clear the selected year, semester, module, and
   subject; load academic years for that faculty.
3. After year selection, clear the semester, module, and subject; load semesters
   for that faculty and year.
4. Load modules with the selected faculty, year, and semester. Reset the module
   list to page 1 whenever a filter changes.
5. For a module's subject picker, call `/subjects?moduleId=<moduleId>`. For a
   broader subject picker, send the selected faculty/year/semester instead.

Include filters and pagination in request cache keys. Cancel or ignore stale
requests when a selection changes so an earlier response cannot overwrite the
current picker options. Refresh faculty and affected catalogue caches after
admin module creation, deletion, or changes to faculty/year/semester/number.

`facultyName` is supported only on the endpoints listed above. The global
`GET /lectures` endpoint does not apply a faculty filter. For lectures in a
selected module, use `GET /modules/:moduleId/lectures` or
`GET /lectures?moduleId=<moduleId>`.

## Admin create and update

`POST /modules` now requires `facultyName`. Older create payloads without it
return `422 VALIDATION_ERROR`.

```http
POST /modules
Content-Type: application/json

{
  "title": "Anatomy",
  "number": "101",
  "facultyName": "Medicine",
  "academicYear": "2026",
  "semester": "Fall",
  "priceCents": 4900
}
```

Success: `201 Created` with `{ data: Module }`.

`PATCH /modules/:moduleId` can assign or change the faculty:

```json
{ "facultyName": "Dentistry" }
```

Success: `200 OK` with `{ data: Module }`. A patch can omit `facultyName` to
keep its current value. At least one recognized module field is required.

On create and update, faculty names must contain 1–256 characters after
trimming. Missing names on create, `null`, empty/whitespace-only strings, and
names longer than 256 characters are rejected. A patch cannot clear a faculty
by sending `""` or `null`.

The combination **facultyName + academicYear + semester + number** must be
unique. Titles do not affect uniqueness. The same year, semester, and number
can exist in different faculties. A conflicting create or update returns:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A module with this faculty, academic year, semester, and number already exists"
  }
}
```

Use the HTTP status and `error.code` for handling errors; display an actionable
message beside the relevant form fields and preserve the user's input.

| Status | Frontend handling |
| --- | --- |
| `401` | Use the existing authentication/device recovery flow. |
| `403` | Only `ADMIN` and `SUPER_ADMIN` can create or update modules. |
| `404` | The module being edited no longer exists. Refresh the list. |
| `409 CONFLICT` | Ask the admin to change the conflicting faculty, year, semester, or module number. |
| `422 VALIDATION_ERROR` | Show validation feedback; `error.details` may contain field errors. |

## Older modules and rollout behavior

Existing modules retain `facultyName: ""` until an admin assigns a faculty.
They remain accessible by ID and in unfiltered module lists. Display a label
such as “Faculty not assigned” while retaining the empty string in the model.

Empty faculty names never appear in `/faculties`. There is no “unassigned”
faculty filter. Keep an “All faculties” option that omits `facultyName`; do not
send the UI placeholder label to the API. An admin assignment screen can
identify unassigned records from paginated, unfiltered module responses.

Renaming a faculty on one module updates only that module. It does not rename
the faculty on other modules. Existing module IDs, lecture associations,
bookings, and access grants continue to reference the same modules.

## Frontend acceptance checks

- A faculty list with more than 20 names remains fully browsable.
- Faculty names with spaces, Arabic characters, and `&` filter correctly.
- Switching faculty clears dependent selections and resets module pagination.
- Empty faculties and empty filtered results show valid empty states.
- Admin creation requires a faculty and permits a new name.
- Duplicate module combinations show a conflict message without losing input.
- Editing an older module can assign a faculty; editing its title alone can
  omit `facultyName`.
- Legacy modules remain visible through “All faculties” and render without a
  missing-field error, including in lecture and booking screens.

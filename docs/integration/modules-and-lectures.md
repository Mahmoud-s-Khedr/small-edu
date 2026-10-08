# Modules and lectures integration guide

Read [README.md](README.md) first for the base URL and common envelopes.

All endpoints in this guide require a Firebase bearer token. Routes marked
**Admin** require a local `ADMIN` or `SUPER_ADMIN` role.

```ts
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
```

## Catalogue filters

These read-only endpoints return unique strings already in use by modules and
lectures. They require a Firebase bearer token and return `Success<string[]>`.

### `GET /academic-years`

Returns the academic years with at least one module, newest string first.

### `GET /semesters?academicYear=<year>`

Returns the distinct semester labels for modules in the selected academic year.
The `academicYear` query parameter is optional when a client needs every label.

### `GET /subjects`

Returns distinct lecture subjects. It accepts optional `moduleId` (UUID),
`academicYear`, and `semester` filters, which can be combined. For a module's
subject picker, use `GET /subjects?moduleId=<moduleId>`.

## Modules

### `GET /modules`

**Job:** list the module catalogue.

**Request DTO**

```ts
type Query = {
  page?: number;
  pageSize?: number;
  number?: string;
  academicYear?: string;
  semester?: string;
};
```

**Expected response — `200 OK`:** `Paginated<Module>`.

### `POST /modules` — Admin

**Job:** create a module.

**Request DTO**

```ts
type Body = {
  title: string;        // trimmed, 1–200 characters
  number: string;       // trimmed, 1–50 characters
  academicYear: string; // trimmed, 1–30 characters
  semester: string;     // trimmed, 1–30 characters
  priceCents: number;   // non-negative integer
};
```

**Expected response — `201 Created`:** `Success<Module>`.

### `GET /modules/:moduleId`

**Job:** return one module.

**Path DTO:** `type Path = { moduleId: string }; // UUID`

**Expected response — `200 OK`:** `Success<Module>`.

### `PATCH /modules/:moduleId` — Admin

**Job:** update one or more module fields.

**Path DTO:** `type Path = { moduleId: string }; // UUID`

**Request DTO:** at least one property from `Partial<Body>` from the create
endpoint.

**Expected response — `200 OK`:** `Success<Module>`.

### `DELETE /modules/:moduleId` — Admin

**Job:** permanently delete a module and its related records. Associated
private lecture-material and flashcard-image objects are also removed.

**Path DTO:** `type Path = { moduleId: string }; // UUID`

**Expected response — `204 No Content`.**

## Module lectures

### `GET /modules/:moduleId/lectures`

**Job:** list lectures in one module, including the full `module` object in each item.

**Path DTO:** `type Path = { moduleId: string }; // UUID`

**Request DTO**

```ts
type Query = {
  page?: number;
  pageSize?: number;
  subject?: string;
  from?: string; // ISO 8601 recommended
  to?: string;
};
```

**Expected response — `200 OK`**

```ts
type LectureListItem = Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
  module: Module;
};

type Response = Paginated<LectureListItem>;
```

For a student without accepted access to this module, `videoUrl` is `null` and
`videoLocked` is `true`. Do not treat the absence of a URL as a missing
lecture; show the paid-video state instead.

### `POST /modules/:moduleId/lectures` — Admin

**Job:** create a lecture in a module.

**Path DTO:** `type Path = { moduleId: string }; // UUID`

**Request DTO**

```ts
type Body = {
  title: string;        // trimmed, 1–250 characters
  description?: string; // up to 10,000 characters; defaults to ''
  subject: string;      // trimmed, 1–150 characters
  lectureDate: string;  // ISO 8601 UTC recommended
  videoUrl: string;     // valid URL, up to 2,000 characters
};
```

**Expected response — `201 Created`:** `Success<Lecture>`.

## Lecture catalogue and details

### `GET /lectures`

**Job:** list lectures across all modules, optionally filtered for a catalogue
or search screen.

**Request DTO**

```ts
type Query = {
  page?: number;
  pageSize?: number;
  moduleId?: string; // UUID
  subject?: string;
  academicYear?: string;
  semester?: string;
  from?: string;
  to?: string;
};
```

**Expected response — `200 OK`**

```ts
type LectureListItem = Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
  academicYear: string;
  semester: string;
};

type Response = Paginated<LectureListItem>;
```

### `GET /lectures/:lectureId`

**Job:** return the data for a lecture-detail screen.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`**

```ts
type Response = Success<Omit<Lecture, 'videoUrl'> & {
  videoUrl: string | null;
  videoLocked: boolean;
}>;
```

### `PATCH /lectures/:lectureId` — Admin

**Job:** update one or more lecture fields.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Request DTO:** at least one property from `Partial<Body>` in the
create-lecture DTO above.

**Expected response — `200 OK`:** `Success<Lecture>`.

### `DELETE /lectures/:lectureId` — Admin

**Job:** permanently delete one lecture and its database children. Its private
materials and flashcard images are also removed.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `204 No Content`.**

### `GET /lectures/:lectureId/video`

**Job:** explicitly retrieve the external video URL. This is the endpoint to
call when the user starts playback.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`**

```ts
type Response = Success<{ videoUrl: string }>;
```

**Important error:** `403 FORBIDDEN` when the user is not an admin and lacks
accepted access to the lecture's module.

## Lecture materials

### `GET /lectures/:lectureId/materials`

**Job:** list downloadable material metadata. Private R2 object keys are never
returned to the client. Any authenticated user can list and download materials;
unlike video playback, these routes do not require accepted module access.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`:** `Success<Material[]>`.

### Direct material upload — Admin

**Job:** upload one private lecture file without routing its bytes through the
Worker.

1. `POST /uploads` with:

   ```ts
   type Body = { purpose: 'lecture-material'; lectureId: string; filename: string; contentType: string; sizeBytes: number }; // max 100 MiB
   ```

2. `PUT` the file bytes to `data.uploadUrl`, using exactly
   `data.requiredHeaders`. Do not send the Firebase token to R2.
3. `POST /uploads/complete` with `purpose: 'lecture-material'`, the same
   `lectureId`, the returned `objectKey`, and the same `filename`,
   `contentType`, and `sizeBytes`.

The completion endpoint verifies R2 contains an object with the exact declared
size and MIME type, then returns `Success<Material>` with `201 Created`.
Lecture materials have no MIME-type allowlist.

### `GET /lectures/:lectureId/materials/:materialId/download`

**Job:** download the private material bytes.

**Path DTO**

```ts
type Path = { lectureId: string; materialId: string }; // UUIDs
```

**Expected response — `200 OK`:** binary data with the original MIME type and
an attachment filename in `Content-Disposition`.

### `PATCH /lectures/:lectureId/materials/:materialId` — Admin

**Job:** change the displayed/download filename without replacing the object.

**Path DTO:** `type Path = { lectureId: string; materialId: string };`

**Request DTO**

```ts
type Body = { originalFilename: string }; // trimmed, 1–255 characters
```

**Expected response — `200 OK`:** `Success<Material>`.

### `DELETE /lectures/:lectureId/materials/:materialId` — Admin

**Job:** permanently remove a material record and the corresponding private
file.

**Path DTO:** `type Path = { lectureId: string; materialId: string };`

**Expected response — `204 No Content`.**

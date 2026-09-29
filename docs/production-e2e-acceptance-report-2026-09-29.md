# Medly Production API End-to-End Acceptance Report

## Executive result

**PASS.** The production API completed **84 assertions with 0 failures** in an
initial run on 2026-09-29, then completed a second clean **84/84** run from
11:49:27 to 11:49:44 UTC with full non-secret request-body logging enabled.
Each run made 70 live HTTP calls across 51 method/path variants against the
real Worker, D1 database, R2 bucket, and Firebase project. It uploaded real
PDF and PNG files, then verified downloaded file bytes by SHA-256.

| Evidence item | Result |
| --- | --- |
| Production URL | <code>https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1</code> |
| Run ID | <code>medly-production-e2e-20260929</code> |
| Assertions | 84 passed / 0 failed |
| HTTP results | 200: 39; 201: 15; 204: 7; expected negative results: 401: 1, 403: 5, 404: 2, 409: 1 |
| Request-level evidence | [events.jsonl](../artifacts/api-e2e/medly-production-e2e-20260929/events.jsonl) |
| Run conclusion | [summary.json](../artifacts/api-e2e/medly-production-e2e-20260929/summary.json) |
| Uploaded source files | [fixtures](../artifacts/api-e2e/medly-production-e2e-20260929/fixtures) |

The local Worker-backed integration suite also passed 17/17 tests and
TypeScript checking passed after the production test.

## Test identities and conventions

The production run used three separately verified Firebase accounts. Bearer
tokens and generated passwords are intentionally absent from this report and
the JSONL log.

| Actor | Medly role | Used to prove |
| --- | --- | --- |
| Student | USER | Catalogue visibility, locked content, materials, flashcards, MCQs, payment submission, and unlocked video after approval |
| Admin | ADMIN | Content authoring, file administration, booking review, and cleanup |
| Super admin | SUPER_ADMIN | User listing and operational-admin role assignment |

All protected calls send an Authorization bearer token. Successful JSON calls
use an envelope with a data field; paginated calls add meta; 204 calls have no
response body. Dynamic UUIDs are written as path parameters below. Exact values
are retained in the private execution log.

## End-to-end business sequence

<pre class="mermaid">
flowchart LR
  SA[Super admin] -->|promotes| A[Admin]
  A -->|creates| M[Module and lecture]
  S[Student] -->|sees locked content| M
  A -->|adds files cards and MCQs| M
  S -->|submits receipt| B[Pending booking]
  A -->|accepts| B
  B -->|grants entitlement| V[Video playback]
  A -->|deletes test content| C[Clean catalogue]
</pre>

## Flow 1 — Health, documentation, and anonymous protection

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Public | <code>GET /health</code> | No body | <code>200 {"data":{"status":"ok"}}</code> |
| Public | <code>GET /openapi</code> | No body | 200; OpenAPI 3.1.0 contract returned |
| Public | <code>GET /docs</code> | No body | 200 text/html; Swagger UI returned |
| Anonymous | <code>GET /modules</code> | No token | <code>401 {"error":{"code":"UNAUTHORIZED",...}}</code> |

This proves the deployment is live, self-documenting, and does not expose the
catalogue without authentication.

## Flow 2 — Firebase session provisioning and identity restoration

**User story:** a verified user signs in through Firebase, provisions or links
a Medly user, and restores their local role-aware session.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Student | <code>POST /auth/session</code> | No body; Firebase bearer token | <code>200</code>; user <code>9d4d6906-2774-46cb-a1c9-0a9a825b0a89</code>, role <code>USER</code>, <code>created:false</code> |
| Admin | <code>POST /auth/session</code> | No body; Firebase bearer token | <code>200</code>; user <code>b16e10e4-90ec-4877-be7a-35d6f404727a</code>, role <code>ADMIN</code>, <code>created:false</code> |
| Super admin | <code>POST /auth/session</code> | No body; Firebase bearer token | <code>200</code>; user <code>65da3fe5-a239-4b64-8c27-955e7a10267b</code>, role <code>SUPER_ADMIN</code>, <code>created:false</code> |
| Student | <code>GET /me</code> | No body | <code>200</code>; <code>{"id":"9d4d6906-2774-46cb-a1c9-0a9a825b0a89","role":"USER"}</code> |
| Admin | <code>GET /me</code> | No body | <code>200</code>; <code>{"id":"b16e10e4-90ec-4877-be7a-35d6f404727a","role":"ADMIN"}</code> |
| Super admin | <code>GET /me</code> | No body | <code>200</code>; <code>{"id":"65da3fe5-a239-4b64-8c27-955e7a10267b","role":"SUPER_ADMIN"}</code> |

The local integration suite additionally proves invalid signatures, expired
tokens, unverified emails, email-link conflicts, legacy account linking, and
repeated-session idempotency.

## Flow 3 — Super-admin operations and authorization boundaries

**User story:** only a super admin can assign the operational ADMIN role.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Student | <code>GET /admin/users</code> | No body | <code>403 {"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action"}}</code> |
| Unpromoted admin account | <code>GET /admin/users</code> | No body | <code>403 {"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action"}}</code> |
| Super admin | <code>GET /admin/users</code> | No body | <code>200</code>; returned the four concrete user records shown immediately below |
| Super admin | <code>PATCH /admin/users/b16e10e4-90ec-4877-be7a-35d6f404727a/role</code> | <code>{"role":"ADMIN"}</code> | <code>200</code>; returned <code>{"id":"b16e10e4-90ec-4877-be7a-35d6f404727a","role":"ADMIN"}</code> |

The initial super-admin account was created through the existing remote D1
bootstrap mechanism. The public role-change endpoint then promoted the content
administrator.

Actual <code>GET /admin/users</code> response captured during the second run:

<pre>
HTTP 200 application/json
{
  "data": [
    {"id":"65da3fe5-a239-4b64-8c27-955e7a10267b","email":"mahmoud.s.khedr.2+medly-e2e-superadmin@gmail.com","name":"Medly E2E superadmin medly-production-e2e-20260929","role":"SUPER_ADMIN","createdAt":"2026-09-29T11:13:11.923Z","updatedAt":"2026-09-29T11:49:29.799Z"},
    {"id":"b16e10e4-90ec-4877-be7a-35d6f404727a","email":"mahmoud.s.khedr.2+medly-e2e-admin@gmail.com","name":"Medly E2E admin medly-production-e2e-20260929","role":"ADMIN","createdAt":"2026-09-29T11:13:11.677Z","updatedAt":"2026-09-29T11:13:15.239Z"},
    {"id":"9d4d6906-2774-46cb-a1c9-0a9a825b0a89","email":"mahmoud.s.khedr.2+medly-e2e-student@gmail.com","name":"Medly E2E student medly-production-e2e-20260929","role":"USER","createdAt":"2026-09-29T11:13:11.417Z","updatedAt":"2026-09-29T11:13:11.417Z"},
    {"id":"b986b060-4732-4f0e-a6b2-a04eb541afed","email":"mahmoud.s.khedr.2@gmail.com","name":"mahmoud.s.khedr.2","role":"SUPER_ADMIN","createdAt":"2026-09-28T11:01:15.712Z","updatedAt":"2026-09-28T11:24:31.750Z"}
  ]
}
</pre>

## Flow 4 — Module catalogue administration

**User story:** an admin publishes, finds, edits, and removes a module. A
learner can read catalogue data but cannot publish it.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Student | <code>POST /modules</code> | <code>{"title":"Denied","number":"DENIED","academicYear":"2026","semester":"E2E","priceCents":0}</code> | <code>403 {"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action"}}</code> |
| Admin | <code>POST /modules</code> | <code>{"title":"Medly E2E medly-production-e2e-20260929","number":"E2E-20260929","academicYear":"2026","semester":"E2E","priceCents":1250}</code> | <code>201</code>; module <code>03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code>, created <code>2026-09-29T11:49:32.953Z</code> |
| Student | <code>GET /modules?page=1&pageSize=1&number=E2E-20260929&academicYear=2026&semester=E2E</code> | Exact URL shown | <code>200</code>; one result, <code>meta:{limit:1,offset:0,page:1,pageSize:1,total:1}</code> |
| Student | <code>GET /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code> | No body | <code>200</code>; title <code>Medly E2E medly-production-e2e-20260929</code>, price <code>1250</code> |
| Admin | <code>PATCH /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code> | <code>{"title":"Medly E2E medly-production-e2e-20260929 updated"}</code> | <code>200</code>; updated timestamp <code>2026-09-29T11:49:33.368Z</code> |
| Admin | <code>DELETE /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code> | No body | <code>204 No Content</code> |
| Student | <code>GET /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code> | After deletion | <code>404 {"error":{"code":"NOT_FOUND","message":"Module not found"}}</code> |

The create response contained an API-generated UUID and UTC timestamps; the
filtered list accepted pagination and all documented module filters.

## Flow 5 — Lecture publishing and paid-video gate

**User story:** the admin attaches a YouTube video to a lecture. A learner can
discover the lecture but cannot obtain the video URL until payment approval.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Admin | <code>POST /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9/lectures</code> | <code>{"title":"E2E lecture medly-production-e2e-20260929","description":"Automated end-to-end test lecture.","subject":"E2E","lectureDate":"2026-09-29T12:00:00.000Z","videoUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}</code> | <code>201</code>; lecture <code>55eb0638-85cf-411a-85e5-b0be5e8dcdb8</code> |
| Student | <code>GET /modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9/lectures?page=1&pageSize=10&subject=E2E&from=2026-01-01T00%3A00%3A00.000Z&to=2026-12-31T23%3A59%3A59.000Z</code> | Exact URL shown | <code>200</code>; one locked lecture, <code>meta.total:1</code> |
| Student | <code>GET /lectures?page=1&pageSize=10&moduleId=03ec05e8-d01a-4fcf-9363-1e912b1d2db9&subject=E2E&academicYear=2026&semester=E2E</code> | Exact URL shown | <code>200</code>; one locked lecture, <code>meta.total:1</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8</code> | Before payment acceptance | <code>200</code>; <code>videoUrl:null</code>, <code>videoLocked:true</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/video</code> | Before payment acceptance | <code>403 {"error":{"code":"FORBIDDEN","message":"This module video requires accepted module access"}}</code> |
| Admin | <code>PATCH /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8</code> | <code>{"description":"Updated by the automated E2E suite."}</code> | <code>200</code>; updated <code>2026-09-29T11:49:34.219Z</code> |
| Admin | <code>DELETE /lectures/03335988-42e4-45b0-a529-bcd148669698</code> | Separate cleanup lecture | <code>204 No Content</code> |
| Student | <code>GET /lectures/03335988-42e4-45b0-a529-bcd148669698</code> | After deletion | <code>404 {"error":{"code":"NOT_FOUND","message":"Lecture not found"}}</code> |

## Flow 6 — Private lecture materials with real binary files

**User story:** the admin uploads notes; the signed-in learner lists and
downloads them; the admin renames and removes the material.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Admin | <code>POST /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials</code> | PDF <code>medly-e2e-notes.pdf</code>, 272 bytes, SHA-256 <code>c3a80634b08356ba930baa96d4b9a36e5eef4d35f03112ccfe3292e90c89dc43</code> | <code>201</code>; material <code>451e7754-3957-4632-8bb5-85036c2ca65f</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials</code> | No body | <code>200</code>; one material, name <code>medly-e2e-notes.pdf</code>, key not present |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f/download</code> | No body | <code>200 application/pdf</code>; 272 bytes; SHA-256 matched upload |
| Admin | <code>PATCH /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f</code> | <code>{"originalFilename":"renamed-e2e-notes.pdf"}</code> | <code>200</code>; filename changed to <code>renamed-e2e-notes.pdf</code> |
| Admin | <code>DELETE /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f</code> | No body | <code>204 No Content</code> |

A second real PDF was uploaded to a cleanup lecture before that lecture was
deleted, exercising deletion of lecture-attached private assets.

## Flow 7 — Flashcard content, private images, and learner state

**User story:** the admin publishes image-backed cards. The learner retrieves
authenticated private images, records study state, hides a card, and sees the
state reflected in progress and listing responses.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Admin | <code>POST /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards/image</code> | PNG <code>medly-e2e-card.png</code>, 68 bytes, SHA-256 <code>431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460</code>; called twice | Both <code>201</code>; returned keys <code>flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/c495b1aa-f6d0-4c37-b78b-3746663e0f5d-medly-e2e-card.png</code> and <code>flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/10869e5a-c728-4c3f-b919-b0b207c23f9c-medly-e2e-card.png</code> |
| Admin | <code>POST /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards</code> | Two returned object keys and <code>{"ordering":3}</code> | <code>201</code>; card <code>bf410473-d60d-4ee6-84e0-a5f0400ec2fc</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards</code> | No body | <code>200</code>; one card, image URLs present and object keys absent |
| Student | <code>GET /flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/front</code> | No body | <code>200 image/png</code>; 68 bytes; SHA-256 matched upload |
| Student | <code>GET /flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/back</code> | No body | <code>200 image/png</code>; 68 bytes; SHA-256 matched upload |
| Admin | <code>PATCH /flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc</code> | <code>{"frontText":"Updated image-backed front"}</code> | <code>200</code>; updated timestamp <code>2026-09-29T11:49:36.970Z</code> |
| Student | <code>PUT /flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/state</code> | <code>{"knowledge":"KNOWN","hidden":true,"viewed":true}</code> | <code>200</code>; state timestamp <code>2026-09-29T11:49:37.122Z</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards/progress</code> | No body | <code>200 {"data":{"total":1,"known":1,"hidden":1}}</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards</code> | After hiding | <code>200 {"data":[]}</code> |
| Admin | <code>DELETE /flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc</code> | No body | <code>204 No Content</code> |

## Flow 8 — MCQ authoring and answer privacy

**User story:** an admin creates a four-choice quiz. The learner sees choices
without answer keys, submits wrong and correct answers, and the admin updates
then deletes the question.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Admin | <code>POST /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/mcqs</code> | Question <code>Which option is correct?</code>; choices A-D, only B correct | <code>201</code>; MCQ <code>f1c5b7d5-0f95-487e-95b5-611ab27a9e1e</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/mcqs</code> | No body | <code>200</code>; choice IDs returned, no <code>isCorrect</code> field |
| Student | <code>POST /mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e/check-answer</code> | <code>{"choiceId":"98d76106-99ae-4762-aafc-54a2a67b154c"}</code> | <code>200 {"data":{"correct":false,"correctChoiceId":"486b31d3-1a44-4648-b7c1-5dacdfb43595"}}</code> |
| Student | <code>POST /mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e/check-answer</code> | <code>{"choiceId":"486b31d3-1a44-4648-b7c1-5dacdfb43595"}</code> | <code>200 {"data":{"correct":true,"correctChoiceId":"486b31d3-1a44-4648-b7c1-5dacdfb43595"}}</code> |
| Admin | <code>PATCH /mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e</code> | <code>{"questionText":"Updated MCQ question","choices":["One","Two","Three","Four"]}</code> with One correct | <code>200</code>; replacement choices returned without answer key |
| Admin | <code>DELETE /mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e</code> | No body | <code>204 No Content</code> |

## Flow 9 — Receipt, booking, decision, and entitlement

**User story:** the learner uploads a real receipt, submits a payment request,
and remains locked out of the video until the admin accepts that request.

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Student | <code>POST /bookings/receipt</code> | PDF <code>medly-e2e-receipt.pdf</code>, 135 bytes, SHA-256 <code>c7e715daa5cb0b9a69dc651ad380b32be49c1ea1ab3a7d8cc0e55219eb5b3890</code> | <code>201</code>; disposable key <code>payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/fa3cdfc6-404d-4ffb-a65f-74893d31f6c4-medly-e2e-receipt.pdf</code> |
| Student | <code>DELETE /bookings/receipt</code> | Actual disposable receipt key | <code>204 No Content</code> |
| Student | <code>POST /bookings/receipt</code> | Same 135-byte PDF | <code>201</code>; receipt key ending <code>be8264f3-f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf</code> |
| Student | <code>POST /bookings</code> | Main module ID <code>03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code> and exact receipt key | <code>201</code>; booking <code>6132b734-6ba4-4f47-8d0c-735ae9ca1884</code>, status <code>PENDING</code> |
| Student | <code>GET /bookings</code> | No body | <code>200</code>; returned booking <code>6132b734-6ba4-4f47-8d0c-735ae9ca1884</code> as <code>PENDING</code> |
| Student | <code>GET /admin/bookings</code> | No body | <code>403 {"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action"}}</code> |
| Admin | <code>GET /admin/bookings?page=1&pageSize=10&status=PENDING</code> | Exact URL shown | <code>200</code>; returned booking <code>6132b734-6ba4-4f47-8d0c-735ae9ca1884</code>, <code>meta:{limit:10,offset:0,page:1,pageSize:10}</code> |
| Admin | <code>GET /admin/bookings/6132b734-6ba4-4f47-8d0c-735ae9ca1884/receipt</code> | No body | <code>200 application/pdf</code>; 135 bytes; SHA-256 matched uploaded receipt |
| Admin | <code>PATCH /admin/bookings/6132b734-6ba4-4f47-8d0c-735ae9ca1884</code> | <code>{"status":"ACCEPTED"}</code> | <code>200</code>; status <code>ACCEPTED</code>, updated <code>2026-09-29T11:49:41.480Z</code> |
| Student | <code>GET /lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/video</code> | After acceptance | <code>200 {"data":{"videoUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}</code> |

The same student received a 403 before acceptance and the video URL only after
the administrator accepted the booking.

## Flow 10 — Rejection and conflicting booking decisions

| Actor | API path | Request | Observed response |
| --- | --- | --- | --- |
| Admin | <code>POST /modules</code> | <code>{"title":"Rejected E2E medly-production-e2e-20260929","number":"REJ-20260929","academicYear":"2026","semester":"E2E","priceCents":500}</code> | <code>201</code>; module <code>fd6a9c99-cb85-41cc-b652-463f84388d56</code> |
| Student | <code>POST /bookings/receipt</code>, then <code>POST /bookings</code> | 135-byte PDF, then module <code>fd6a9c99-cb85-41cc-b652-463f84388d56</code> plus returned key | Both <code>201</code>; booking <code>1a129a67-28e5-4420-9062-33d4aaf6f3b7</code> |
| Admin | <code>PATCH /admin/bookings/1a129a67-28e5-4420-9062-33d4aaf6f3b7</code> | <code>{"status":"REJECTED"}</code> | <code>200</code>; status <code>REJECTED</code> |
| Admin | <code>PATCH /admin/bookings/1a129a67-28e5-4420-9062-33d4aaf6f3b7</code> | <code>{"status":"ACCEPTED"}</code> | <code>409 {"error":{"code":"CONFLICT","message":"Only pending booking requests can be decided"}}</code> |

The 409 result demonstrates that only a pending booking can be decided.

## Flow 11 — Cleanup and cascade verification

The runner created cleanup lecture <code>03335988-42e4-45b0-a529-bcd148669698</code>,
uploaded the 272-byte PDF as material <code>6802033f-4221-4199-b628-27d515071429</code>,
then deleted that lecture with <code>204</code>. A learner then received
<code>404 {"error":{"code":"NOT_FOUND","message":"Lecture not found"}}</code>
from the same concrete lecture URL. It deleted rejection module
<code>fd6a9c99-cb85-41cc-b652-463f84388d56</code> and primary module
<code>03ec05e8-d01a-4fcf-9363-1e912b1d2db9</code>; both returned <code>204</code>.
The final read of the primary-module URL returned
<code>404 {"error":{"code":"NOT_FOUND","message":"Module not found"}}</code>.

The runner also has a failure-path cleanup handler. If a later assertion fails,
it removes every uniquely named E2E module already created and records the
attempt in events.jsonl.

## Contract coverage inventory

The following is only a route-template index. It is not an evidence table;
every concrete request, UUID, payload, and response is in the flow tables and
the exact transcript below.

Every documented API operation was exercised in at least one production flow.

| Area | Paths exercised | Result |
| --- | --- | --- |
| System | <code>GET /health</code>, <code>GET /openapi</code>, <code>GET /docs</code> | 200 |
| Auth | <code>POST /auth/session</code>, <code>GET /me</code> | 200 for all three roles |
| User admin | <code>GET /admin/users</code>, <code>PATCH /admin/users/:userId/role</code> | Authorized 200; insufficient role 403 |
| Modules | <code>GET/POST /modules</code>, <code>GET/PATCH/DELETE /modules/:moduleId</code> | Create/read/filter/update/delete plus 403 and 404 |
| Module lectures | <code>GET/POST /modules/:moduleId/lectures</code> | 200/201 |
| Lectures | <code>GET /lectures</code>, <code>GET/PATCH/DELETE /lectures/:lectureId</code>, <code>GET /lectures/:lectureId/video</code> | Locked 403 and entitled 200 verified |
| Materials | All list/upload/download/rename/delete material paths | Real upload/download/rename/delete |
| Bookings | All receipt and personal-booking paths | Real receipt and booking flow |
| Booking admin | All queue, receipt, and decision paths | Queue, receipt, accept/reject, conflict |
| Flashcards | All content, image, state, progress, and image-download paths | Image privacy, state, progress, deletion |
| MCQs | All list/create/update/delete/check-answer paths | Authoring, answer privacy, checks, deletion |

## Conclusion

The production backend is working across its intended roles and business
journeys. The proof includes positive work (create/read/update/delete,
downloads, payment approval, video entitlement) and deliberate negative cases
(anonymous access, insufficient roles, locked video, deleted resources, and
conflicting booking decisions). All temporary course content was removed at the
end of the run.

The three dedicated E2E accounts remain so the same automated proof can run
again without another email-verification round. Their credentials are kept only
in the ignored mode-600 state file and are not included in this report or Git.

+## Exact production request/response transcript

This transcript is generated from the clean repeat production run that began at 11:49:27 UTC. Every non-secret request body, binary-file fingerprint, received status, content type, and response body is included. Firebase bearer tokens are redacted.

### health

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/health
Authorization: Bearer [REDACTED] (not sent)
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "status": "ok"
  }
}
</pre>

### openapi

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/openapi
Authorization: Bearer [REDACTED] (not sent)
</pre>
<pre>
HTTP 200 application/json
{
  "note": "The live OpenAPI 3.1 document was returned; its full body is retained in events.jsonl."
}
</pre>

### swagger

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/docs
Authorization: Bearer [REDACTED] (not sent)
</pre>
<pre>
HTTP 200 text/html; charset=UTF-8
{
  "note": "Swagger UI HTML was returned."
}
</pre>

### anonymous-modules

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules
Authorization: Bearer [REDACTED] (not sent)
</pre>
<pre>
HTTP 401 application/json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication is required"
  }
}
</pre>

### session-student

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/auth/session
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "user": {
      "id": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
      "email": "mahmoud.s.khedr.2+medly-e2e-student@gmail.com",
      "name": "Medly E2E student medly-production-e2e-20260929",
      "role": "USER"
    },
    "created": false
  }
}
</pre>

### me-student

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/me
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "email": "mahmoud.s.khedr.2+medly-e2e-student@gmail.com",
    "name": "Medly E2E student medly-production-e2e-20260929",
    "role": "USER"
  }
}
</pre>

### session-admin

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/auth/session
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "user": {
      "id": "b16e10e4-90ec-4877-be7a-35d6f404727a",
      "email": "mahmoud.s.khedr.2+medly-e2e-admin@gmail.com",
      "name": "Medly E2E admin medly-production-e2e-20260929",
      "role": "ADMIN"
    },
    "created": false
  }
}
</pre>

### me-admin

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/me
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "b16e10e4-90ec-4877-be7a-35d6f404727a",
    "email": "mahmoud.s.khedr.2+medly-e2e-admin@gmail.com",
    "name": "Medly E2E admin medly-production-e2e-20260929",
    "role": "ADMIN"
  }
}
</pre>

### session-superadmin

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/auth/session
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "user": {
      "id": "65da3fe5-a239-4b64-8c27-955e7a10267b",
      "email": "mahmoud.s.khedr.2+medly-e2e-superadmin@gmail.com",
      "name": "Medly E2E superadmin medly-production-e2e-20260929",
      "role": "SUPER_ADMIN"
    },
    "created": false
  }
}
</pre>

### me-superadmin

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/me
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "65da3fe5-a239-4b64-8c27-955e7a10267b",
    "email": "mahmoud.s.khedr.2+medly-e2e-superadmin@gmail.com",
    "name": "Medly E2E superadmin medly-production-e2e-20260929",
    "role": "SUPER_ADMIN"
  }
}
</pre>

### me-superadmin-after-bootstrap

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/me
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "65da3fe5-a239-4b64-8c27-955e7a10267b",
    "email": "mahmoud.s.khedr.2+medly-e2e-superadmin@gmail.com",
    "name": "Medly E2E superadmin medly-production-e2e-20260929",
    "role": "SUPER_ADMIN"
  }
}
</pre>

### student-list-users

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/users
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 403 application/json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action"
  }
}
</pre>

### admin-list-users

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/users
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 403 application/json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action"
  }
}
</pre>

### superadmin-list-users

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/users
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "65da3fe5-a239-4b64-8c27-955e7a10267b",
      "email": "mahmoud.s.khedr.2+medly-e2e-superadmin@gmail.com",
      "name": "Medly E2E superadmin medly-production-e2e-20260929",
      "role": "SUPER_ADMIN",
      "createdAt": "2026-09-29T11:13:11.923Z",
      "updatedAt": "2026-09-29T11:49:29.799Z"
    },
    {
      "id": "b16e10e4-90ec-4877-be7a-35d6f404727a",
      "email": "mahmoud.s.khedr.2+medly-e2e-admin@gmail.com",
      "name": "Medly E2E admin medly-production-e2e-20260929",
      "role": "ADMIN",
      "createdAt": "2026-09-29T11:13:11.677Z",
      "updatedAt": "2026-09-29T11:13:15.239Z"
    },
    {
      "id": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
      "email": "mahmoud.s.khedr.2+medly-e2e-student@gmail.com",
      "name": "Medly E2E student medly-production-e2e-20260929",
      "role": "USER",
      "createdAt": "2026-09-29T11:13:11.417Z",
      "updatedAt": "2026-09-29T11:13:11.417Z"
    },
    {
      "id": "b986b060-4732-4f0e-a6b2-a04eb541afed",
      "email": "mahmoud.s.khedr.2@gmail.com",
      "name": "mahmoud.s.khedr.2",
      "role": "SUPER_ADMIN",
      "createdAt": "2026-09-28T11:01:15.712Z",
      "updatedAt": "2026-09-28T11:24:31.750Z"
    }
  ]
}
</pre>

### promote-admin

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/users/b16e10e4-90ec-4877-be7a-35d6f404727a/role
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "role": "ADMIN"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "b16e10e4-90ec-4877-be7a-35d6f404727a",
    "externalSubject": "sqlImF7IIPXxbMSj2TMgMe5HnwY2",
    "email": "mahmoud.s.khedr.2+medly-e2e-admin@gmail.com",
    "name": "Medly E2E admin medly-production-e2e-20260929",
    "role": "ADMIN",
    "createdAt": "2026-09-29T11:13:11.677Z",
    "updatedAt": "2026-09-29T11:49:32.723Z"
  }
}
</pre>

### student-create-module

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "Denied",
  "number": "DENIED",
  "academicYear": "2026",
  "semester": "E2E",
  "priceCents": 0
}
</pre>
<pre>
HTTP 403 application/json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action"
  }
}
</pre>

### create-main-module

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "Medly E2E medly-production-e2e-20260929",
  "number": "E2E-20260929",
  "academicYear": "2026",
  "semester": "E2E",
  "priceCents": 1250
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "Medly E2E medly-production-e2e-20260929",
    "number": "E2E-20260929",
    "academicYear": "2026",
    "semester": "E2E",
    "priceCents": 1250,
    "createdAt": "2026-09-29T11:49:32.953Z",
    "updatedAt": "2026-09-29T11:49:32.953Z"
  }
}
</pre>

### list-modules-filtered

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules?page=1&pageSize=1&number=E2E-20260929&academicYear=2026&semester=E2E
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
      "title": "Medly E2E medly-production-e2e-20260929",
      "number": "E2E-20260929",
      "academicYear": "2026",
      "semester": "E2E",
      "priceCents": 1250,
      "createdAt": "2026-09-29T11:49:32.953Z",
      "updatedAt": "2026-09-29T11:49:32.953Z"
    }
  ],
  "meta": {
    "limit": 1,
    "offset": 0,
    "page": 1,
    "pageSize": 1,
    "total": 1
  }
}
</pre>

### get-main-module

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "Medly E2E medly-production-e2e-20260929",
    "number": "E2E-20260929",
    "academicYear": "2026",
    "semester": "E2E",
    "priceCents": 1250,
    "createdAt": "2026-09-29T11:49:32.953Z",
    "updatedAt": "2026-09-29T11:49:32.953Z"
  }
}
</pre>

### patch-main-module

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "Medly E2E medly-production-e2e-20260929 updated"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "Medly E2E medly-production-e2e-20260929 updated",
    "number": "E2E-20260929",
    "academicYear": "2026",
    "semester": "E2E",
    "priceCents": 1250,
    "createdAt": "2026-09-29T11:49:32.953Z",
    "updatedAt": "2026-09-29T11:49:33.368Z"
  }
}
</pre>

### create-main-lecture

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9/lectures
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "E2E lecture medly-production-e2e-20260929",
  "description": "Automated end-to-end test lecture.",
  "subject": "E2E",
  "lectureDate": "2026-09-29T12:00:00.000Z",
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "E2E lecture medly-production-e2e-20260929",
    "description": "Automated end-to-end test lecture.",
    "subject": "E2E",
    "lectureDate": "2026-09-29T12:00:00.000Z",
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "createdAt": "2026-09-29T11:49:33.479Z",
    "updatedAt": "2026-09-29T11:49:33.479Z"
  }
}
</pre>

### list-module-lectures

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9/lectures?page=1&pageSize=10&subject=E2E&from=2026-01-01T00%3A00%3A00.000Z&to=2026-12-31T23%3A59%3A59.000Z
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
      "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
      "title": "E2E lecture medly-production-e2e-20260929",
      "description": "Automated end-to-end test lecture.",
      "subject": "E2E",
      "lectureDate": "2026-09-29T12:00:00.000Z",
      "videoUrl": null,
      "createdAt": "2026-09-29T11:49:33.479Z",
      "updatedAt": "2026-09-29T11:49:33.479Z",
      "videoLocked": true
    }
  ],
  "meta": {
    "limit": 10,
    "offset": 0,
    "page": 1,
    "pageSize": 10,
    "total": 1
  }
}
</pre>

### list-lectures

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures?page=1&pageSize=10&moduleId=03ec05e8-d01a-4fcf-9363-1e912b1d2db9&subject=E2E&academicYear=2026&semester=E2E
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
      "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
      "title": "E2E lecture medly-production-e2e-20260929",
      "description": "Automated end-to-end test lecture.",
      "subject": "E2E",
      "lectureDate": "2026-09-29T12:00:00.000Z",
      "videoUrl": null,
      "createdAt": "2026-09-29T11:49:33.479Z",
      "updatedAt": "2026-09-29T11:49:33.479Z",
      "videoLocked": true,
      "academicYear": "2026",
      "semester": "E2E"
    }
  ],
  "meta": {
    "limit": 10,
    "offset": 0,
    "page": 1,
    "pageSize": 10,
    "total": 1
  }
}
</pre>

### student-get-locked-lecture

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "E2E lecture medly-production-e2e-20260929",
    "description": "Automated end-to-end test lecture.",
    "subject": "E2E",
    "lectureDate": "2026-09-29T12:00:00.000Z",
    "videoUrl": null,
    "createdAt": "2026-09-29T11:49:33.479Z",
    "updatedAt": "2026-09-29T11:49:33.479Z",
    "videoLocked": true
  }
}
</pre>

### student-locked-video

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/video
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 403 application/json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "This module video requires accepted module access"
  }
}
</pre>

### patch-main-lecture

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "description": "Updated by the automated E2E suite."
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "E2E lecture medly-production-e2e-20260929",
    "description": "Updated by the automated E2E suite.",
    "subject": "E2E",
    "lectureDate": "2026-09-29T12:00:00.000Z",
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "createdAt": "2026-09-29T11:49:33.479Z",
    "updatedAt": "2026-09-29T11:49:34.219Z"
  }
}
</pre>

### upload-material

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials
Authorization: Bearer [REDACTED]
Content-Type: application/pdf
X-Filename: medly-e2e-notes.pdf
Content-Length: 272
SHA-256: c3a80634b08356ba930baa96d4b9a36e5eef4d35f03112ccfe3292e90c89dc43
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "451e7754-3957-4632-8bb5-85036c2ca65f",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "originalFilename": "medly-e2e-notes.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 272,
    "createdAt": "2026-09-29T11:49:34.556Z",
    "updatedAt": "2026-09-29T11:49:34.556Z"
  }
}
</pre>

### list-materials

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "451e7754-3957-4632-8bb5-85036c2ca65f",
      "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
      "originalFilename": "medly-e2e-notes.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 272,
      "createdAt": "2026-09-29T11:49:34.556Z",
      "updatedAt": "2026-09-29T11:49:34.556Z"
    }
  ]
}
</pre>

### download-material

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f/download
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/pdf
Binary/no-content response; received 272 bytes.
</pre>

### rename-material

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "originalFilename": "renamed-e2e-notes.pdf"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "451e7754-3957-4632-8bb5-85036c2ca65f",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "originalFilename": "renamed-e2e-notes.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 272,
    "createdAt": "2026-09-29T11:49:34.556Z",
    "updatedAt": "2026-09-29T11:49:35.072Z"
  }
}
</pre>

### delete-material

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/materials/451e7754-3957-4632-8bb5-85036c2ca65f
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### upload-front-image

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards/image
Authorization: Bearer [REDACTED]
Content-Type: image/png
X-Filename: medly-e2e-card.png
Content-Length: 68
SHA-256: 431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "objectKey": "flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/c495b1aa-f6d0-4c37-b78b-3746663e0f5d-medly-e2e-card.png",
    "filename": "medly-e2e-card.png",
    "contentType": "image/png",
    "sizeBytes": 68
  }
}
</pre>

### upload-back-image

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards/image
Authorization: Bearer [REDACTED]
Content-Type: image/png
X-Filename: medly-e2e-card.png
Content-Length: 68
SHA-256: 431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "objectKey": "flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/10869e5a-c728-4c3f-b919-b0b207c23f9c-medly-e2e-card.png",
    "filename": "medly-e2e-card.png",
    "contentType": "image/png",
    "sizeBytes": 68
  }
}
</pre>

### create-flashcard

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "frontImageKey": "flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/c495b1aa-f6d0-4c37-b78b-3746663e0f5d-medly-e2e-card.png",
  "backImageKey": "flashcards/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/10869e5a-c728-4c3f-b919-b0b207c23f9c-medly-e2e-card.png",
  "ordering": 3
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "bf410473-d60d-4ee6-84e0-a5f0400ec2fc",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "frontText": null,
    "backText": null,
    "ordering": 3,
    "createdAt": "2026-09-29T11:49:36.213Z",
    "updatedAt": "2026-09-29T11:49:36.213Z",
    "frontImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/front",
    "backImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/back",
    "state": null
  }
}
</pre>

### student-list-flashcards

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "bf410473-d60d-4ee6-84e0-a5f0400ec2fc",
      "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
      "frontText": null,
      "backText": null,
      "ordering": 3,
      "createdAt": "2026-09-29T11:49:36.213Z",
      "updatedAt": "2026-09-29T11:49:36.213Z",
      "frontImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/front",
      "backImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/back",
      "state": null
    }
  ]
}
</pre>

### download-flashcard-front

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/front
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 image/png
Binary/no-content response; received 68 bytes.
</pre>

### download-flashcard-back

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/back
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 image/png
Binary/no-content response; received 68 bytes.
</pre>

### patch-flashcard

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "frontText": "Updated image-backed front"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "bf410473-d60d-4ee6-84e0-a5f0400ec2fc",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "frontText": "Updated image-backed front",
    "backText": null,
    "ordering": 0,
    "createdAt": "2026-09-29T11:49:36.213Z",
    "updatedAt": "2026-09-29T11:49:36.970Z",
    "frontImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/front",
    "backImageUrl": "/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/image/back",
    "state": null
  }
}
</pre>

### set-flashcard-state

<pre>
PUT https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc/state
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "knowledge": "KNOWN",
  "hidden": true,
  "viewed": true
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "flashcardId": "bf410473-d60d-4ee6-84e0-a5f0400ec2fc",
    "knowledge": "KNOWN",
    "hidden": true,
    "viewedAt": "2026-09-29T11:49:37.122Z",
    "updatedAt": "2026-09-29T11:49:37.122Z",
    "viewed": true
  }
}
</pre>

### flashcard-progress

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards/progress
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "total": 1,
    "known": 1,
    "hidden": 1
  }
}
</pre>

### student-list-hidden-flashcards

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/flashcards
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": []
}
</pre>

### delete-flashcard

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/flashcards/bf410473-d60d-4ee6-84e0-a5f0400ec2fc
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### create-mcq

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/mcqs
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "questionText": "Which option is correct?",
  "ordering": 1,
  "choices": [
    {
      "text": "A",
      "isCorrect": false
    },
    {
      "text": "B",
      "isCorrect": true
    },
    {
      "text": "C",
      "isCorrect": false
    },
    {
      "text": "D",
      "isCorrect": false
    }
  ]
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "questionText": "Which option is correct?",
    "ordering": 1,
    "choices": [
      {
        "id": "98d76106-99ae-4762-aafc-54a2a67b154c",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "A",
        "ordering": 0
      },
      {
        "id": "486b31d3-1a44-4648-b7c1-5dacdfb43595",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "B",
        "ordering": 1
      },
      {
        "id": "7a9f21a8-9f52-4dae-b551-86d2af07acad",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "C",
        "ordering": 2
      },
      {
        "id": "803589fb-363e-42a5-9cd5-392b8d8cfd4d",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "D",
        "ordering": 3
      }
    ]
  }
}
</pre>

### list-mcqs

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/mcqs
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
      "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
      "questionText": "Which option is correct?",
      "ordering": 1,
      "choices": [
        {
          "id": "98d76106-99ae-4762-aafc-54a2a67b154c",
          "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
          "choiceText": "A",
          "ordering": 0
        },
        {
          "id": "486b31d3-1a44-4648-b7c1-5dacdfb43595",
          "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
          "choiceText": "B",
          "ordering": 1
        },
        {
          "id": "7a9f21a8-9f52-4dae-b551-86d2af07acad",
          "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
          "choiceText": "C",
          "ordering": 2
        },
        {
          "id": "803589fb-363e-42a5-9cd5-392b8d8cfd4d",
          "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
          "choiceText": "D",
          "ordering": 3
        }
      ]
    }
  ]
}
</pre>

### check-wrong-mcq

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e/check-answer
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "choiceId": "98d76106-99ae-4762-aafc-54a2a67b154c"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "correct": false,
    "correctChoiceId": "486b31d3-1a44-4648-b7c1-5dacdfb43595"
  }
}
</pre>

### check-correct-mcq

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e/check-answer
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "choiceId": "486b31d3-1a44-4648-b7c1-5dacdfb43595"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "correct": true,
    "correctChoiceId": "486b31d3-1a44-4648-b7c1-5dacdfb43595"
  }
}
</pre>

### patch-mcq

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "questionText": "Updated MCQ question",
  "choices": [
    {
      "text": "One",
      "isCorrect": true
    },
    {
      "text": "Two",
      "isCorrect": false
    },
    {
      "text": "Three",
      "isCorrect": false
    },
    {
      "text": "Four",
      "isCorrect": false
    }
  ]
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
    "lectureId": "55eb0638-85cf-411a-85e5-b0be5e8dcdb8",
    "questionText": "Updated MCQ question",
    "ordering": 0,
    "choices": [
      {
        "id": "66848911-767c-408e-81be-8ed1d526fb21",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "One",
        "ordering": 0
      },
      {
        "id": "4e140033-2c89-4491-aff1-f20e973efaf4",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "Two",
        "ordering": 1
      },
      {
        "id": "c241a066-1618-423e-8f0e-c52c285006f8",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "Three",
        "ordering": 2
      },
      {
        "id": "efe48d06-958c-4567-9bdf-59468170c521",
        "mcqId": "f1c5b7d5-0f95-487e-95b5-611ab27a9e1e",
        "choiceText": "Four",
        "ordering": 3
      }
    ]
  }
}
</pre>

### delete-mcq

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/mcqs/f1c5b7d5-0f95-487e-95b5-611ab27a9e1e
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### upload-disposable-receipt

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings/receipt
Authorization: Bearer [REDACTED]
Content-Type: application/pdf
X-Filename: medly-e2e-receipt.pdf
Content-Length: 135
SHA-256: c7e715daa5cb0b9a69dc651ad380b32be49c1ea1ab3a7d8cc0e55219eb5b3890
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "objectKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/fa3cdfc6-404d-4ffb-a65f-74893d31f6c4-medly-e2e-receipt.pdf",
    "filename": "medly-e2e-receipt.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 135
  }
}
</pre>

### delete-disposable-receipt

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings/receipt
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "receiptKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/fa3cdfc6-404d-4ffb-a65f-74893d31f6c4-medly-e2e-receipt.pdf"
}
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### upload-booking-receipt

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings/receipt
Authorization: Bearer [REDACTED]
Content-Type: application/pdf
X-Filename: medly-e2e-receipt.pdf
Content-Length: 135
SHA-256: c7e715daa5cb0b9a69dc651ad380b32be49c1ea1ab3a7d8cc0e55219eb5b3890
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "objectKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/be8264f3-f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf",
    "filename": "medly-e2e-receipt.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 135
  }
}
</pre>

### create-booking

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
  "receiptKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/be8264f3-f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf"
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "6132b734-6ba4-4f47-8d0c-735ae9ca1884",
    "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "receiptFilename": "f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf",
    "receiptContentType": "application/pdf",
    "receiptSizeBytes": 135,
    "status": "PENDING",
    "createdAt": "2026-09-29T11:49:40.479Z",
    "updatedAt": "2026-09-29T11:49:40.479Z"
  }
}
</pre>

### list-student-bookings

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "6132b734-6ba4-4f47-8d0c-735ae9ca1884",
      "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
      "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
      "receiptFilename": "f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf",
      "receiptContentType": "application/pdf",
      "receiptSizeBytes": 135,
      "status": "PENDING",
      "createdAt": "2026-09-29T11:49:40.479Z",
      "updatedAt": "2026-09-29T11:49:40.479Z"
    }
  ]
}
</pre>

### student-admin-bookings

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 403 application/json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action"
  }
}
</pre>

### list-pending-bookings

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings?page=1&pageSize=10&status=PENDING
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": [
    {
      "id": "6132b734-6ba4-4f47-8d0c-735ae9ca1884",
      "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
      "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
      "receiptFilename": "f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf",
      "receiptContentType": "application/pdf",
      "receiptSizeBytes": 135,
      "status": "PENDING",
      "createdAt": "2026-09-29T11:49:40.479Z",
      "updatedAt": "2026-09-29T11:49:40.479Z"
    }
  ],
  "meta": {
    "limit": 10,
    "offset": 0,
    "page": 1,
    "pageSize": 10
  }
}
</pre>

### download-booking-receipt

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings/6132b734-6ba4-4f47-8d0c-735ae9ca1884/receipt
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/pdf
Binary/no-content response; received 135 bytes.
</pre>

### accept-booking

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings/6132b734-6ba4-4f47-8d0c-735ae9ca1884
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "status": "ACCEPTED"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "6132b734-6ba4-4f47-8d0c-735ae9ca1884",
    "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "receiptFilename": "f12b-48d3-b2c8-ef8759db3795-medly-e2e-receipt.pdf",
    "receiptContentType": "application/pdf",
    "receiptSizeBytes": 135,
    "status": "ACCEPTED",
    "createdAt": "2026-09-29T11:49:40.479Z",
    "updatedAt": "2026-09-29T11:49:41.480Z"
  }
}
</pre>

### student-unlocked-video

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/55eb0638-85cf-411a-85e5-b0be5e8dcdb8/video
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }
}
</pre>

### create-rejected-module

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "Rejected E2E medly-production-e2e-20260929",
  "number": "REJ-20260929",
  "academicYear": "2026",
  "semester": "E2E",
  "priceCents": 500
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "fd6a9c99-cb85-41cc-b652-463f84388d56",
    "title": "Rejected E2E medly-production-e2e-20260929",
    "number": "REJ-20260929",
    "academicYear": "2026",
    "semester": "E2E",
    "priceCents": 500,
    "createdAt": "2026-09-29T11:49:41.840Z",
    "updatedAt": "2026-09-29T11:49:41.840Z"
  }
}
</pre>

### upload-rejection-receipt

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings/receipt
Authorization: Bearer [REDACTED]
Content-Type: application/pdf
X-Filename: medly-e2e-receipt.pdf
Content-Length: 135
SHA-256: c7e715daa5cb0b9a69dc651ad380b32be49c1ea1ab3a7d8cc0e55219eb5b3890
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "objectKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/27f5fe06-5809-4853-a075-3dffb64e1bb6-medly-e2e-receipt.pdf",
    "filename": "medly-e2e-receipt.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 135
  }
}
</pre>

### create-rejection-booking

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/bookings
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "moduleId": "fd6a9c99-cb85-41cc-b652-463f84388d56",
  "receiptKey": "payment-receipts/9d4d6906-2774-46cb-a1c9-0a9a825b0a89/27f5fe06-5809-4853-a075-3dffb64e1bb6-medly-e2e-receipt.pdf"
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "1a129a67-28e5-4420-9062-33d4aaf6f3b7",
    "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "moduleId": "fd6a9c99-cb85-41cc-b652-463f84388d56",
    "receiptFilename": "5809-4853-a075-3dffb64e1bb6-medly-e2e-receipt.pdf",
    "receiptContentType": "application/pdf",
    "receiptSizeBytes": 135,
    "status": "PENDING",
    "createdAt": "2026-09-29T11:49:42.439Z",
    "updatedAt": "2026-09-29T11:49:42.439Z"
  }
}
</pre>

### reject-booking

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings/1a129a67-28e5-4420-9062-33d4aaf6f3b7
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "status": "REJECTED"
}
</pre>
<pre>
HTTP 200 application/json
{
  "data": {
    "id": "1a129a67-28e5-4420-9062-33d4aaf6f3b7",
    "userId": "9d4d6906-2774-46cb-a1c9-0a9a825b0a89",
    "moduleId": "fd6a9c99-cb85-41cc-b652-463f84388d56",
    "receiptFilename": "5809-4853-a075-3dffb64e1bb6-medly-e2e-receipt.pdf",
    "receiptContentType": "application/pdf",
    "receiptSizeBytes": 135,
    "status": "REJECTED",
    "createdAt": "2026-09-29T11:49:42.439Z",
    "updatedAt": "2026-09-29T11:49:42.629Z"
  }
}
</pre>

### repeat-booking-decision

<pre>
PATCH https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/admin/bookings/1a129a67-28e5-4420-9062-33d4aaf6f3b7
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "status": "ACCEPTED"
}
</pre>
<pre>
HTTP 409 application/json
{
  "error": {
    "code": "CONFLICT",
    "message": "Only pending booking requests can be decided"
  }
}
</pre>

### create-cleanup-lecture

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9/lectures
Authorization: Bearer [REDACTED]
Content-Type: application/json

{
  "title": "Cleanup lecture medly-production-e2e-20260929",
  "subject": "E2E",
  "lectureDate": "2026-09-29T12:00:00.000Z",
  "videoUrl": "https://www.youtube.com/watch?v=3JZ_D3ELwOQ"
}
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "03335988-42e4-45b0-a529-bcd148669698",
    "moduleId": "03ec05e8-d01a-4fcf-9363-1e912b1d2db9",
    "title": "Cleanup lecture medly-production-e2e-20260929",
    "description": "",
    "subject": "E2E",
    "lectureDate": "2026-09-29T12:00:00.000Z",
    "videoUrl": "https://www.youtube.com/watch?v=3JZ_D3ELwOQ",
    "createdAt": "2026-09-29T11:49:43.016Z",
    "updatedAt": "2026-09-29T11:49:43.016Z"
  }
}
</pre>

### upload-cleanup-material

<pre>
POST https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/03335988-42e4-45b0-a529-bcd148669698/materials
Authorization: Bearer [REDACTED]
Content-Type: application/pdf
X-Filename: medly-e2e-notes.pdf
Content-Length: 272
SHA-256: c3a80634b08356ba930baa96d4b9a36e5eef4d35f03112ccfe3292e90c89dc43
</pre>
<pre>
HTTP 201 application/json
{
  "data": {
    "id": "6802033f-4221-4199-b628-27d515071429",
    "lectureId": "03335988-42e4-45b0-a529-bcd148669698",
    "originalFilename": "medly-e2e-notes.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 272,
    "createdAt": "2026-09-29T11:49:43.343Z",
    "updatedAt": "2026-09-29T11:49:43.343Z"
  }
}
</pre>

### delete-cleanup-lecture

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/03335988-42e4-45b0-a529-bcd148669698
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### get-deleted-lecture

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/lectures/03335988-42e4-45b0-a529-bcd148669698
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 404 application/json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Lecture not found"
  }
}
</pre>

### delete-rejection-module

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/fd6a9c99-cb85-41cc-b652-463f84388d56
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### delete-main-module

<pre>
DELETE https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 204 (no content type)
Binary/no-content response; received 0 bytes.
</pre>

### get-deleted-main-module

<pre>
GET https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1/modules/03ec05e8-d01a-4fcf-9363-1e912b1d2db9
Authorization: Bearer [REDACTED]
</pre>
<pre>
HTTP 404 application/json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Module not found"
  }
}
</pre>

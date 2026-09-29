# Medly UI review

**Reviewed:** 2026-09-29  
**Source:** supplied Figma authentication and home screens  
**Scope:** client-flow implications and alignment with the current Medly API

## Screens reviewed

| Screen | Intended user action |
| --- | --- |
| Welcome Back | Sign in with email/password, Apple, or Google; navigate to sign-up or password recovery. |
| Welcome To Medly | Enter first name, last name, and email to begin sign-up; alternatively continue with Apple or Google. |
| Set Your Password | Enter and confirm the password for the email sign-up flow. |
| Verify Your Email | Enter a six-digit email verification code and optionally resend it. |
| Welcome to Medly | Confirm successful account creation and provide a Log In action. |

## API and Firebase alignment

The Medly Worker does not handle passwords, send verification messages, or
validate email verification codes. It only accepts a Firebase ID token with a
verified email address, then creates or links the local Medly account through:

```http
POST /api/v1/auth/session
Authorization: Bearer <Firebase ID token>
```

The server returns `401 UNAUTHORIZED` while the Firebase token does not contain
`email_verified: true`. The local account is created with the `USER` role;
Firebase claims cannot assign a Medly admin role.

## Recommended client flow

### Email/password sign-up

1. Collect first name, last name, and email on **Welcome To Medly**.
2. Collect and validate password/confirmation on **Set Your Password**.
3. Combine the names into one display name, for example `"Mona Hassan"`.
4. Create the Firebase email/password account and set Firebase `displayName`
   to the combined name.
5. Start Firebase email verification.
6. After Firebase reports the user's email as verified, obtain a refreshed ID
   token and call `POST /auth/session`.
7. Show the success state only after the session endpoint succeeds. The
   existing design then sends the user to the log-in experience.

The API has a single local `name` value, not separate `firstName` and
`lastName` fields. There is no Medly API endpoint that accepts these fields, so
the client must pass the combined value through Firebase's profile/display-name
mechanism if that name should appear in Medly.

### Email/password login

1. Sign in with Firebase using the email and password.
2. Retrieve a current Firebase ID token.
3. Call `POST /auth/session` to ensure the Firebase account is linked to the
   local Medly user.
4. Continue to the authenticated app on success.

If Firebase reports an unverified email, do not continue to the Medly API.
Return the user to the verification flow and allow a resend action.

### Apple and Google login

1. Complete the provider flow using the Firebase client SDK.
2. Retrieve a current Firebase ID token.
3. Call `POST /auth/session`.

Provider flows may return a verified email immediately. In that case, skip the
email verification-code screen and proceed to session provisioning. The client
should handle a provider not returning a usable verified email as an
authentication error rather than attempting protected Medly requests.

## Six-digit verification screen: required product decision

The **Verify Your Email** design assumes an OTP-style, six-digit verification
code. The current Medly API cannot implement that experience by itself; it has
no endpoint for issuing, resending, or confirming a code.

The authentication team must choose one of these approaches:

1. Configure and use a Firebase/client authentication flow that supports the
   six-digit code UI, with all code issuance and confirmation handled by that
   authentication provider; or
2. Adapt the design to the verification experience supported by the configured
   Firebase email provider (for example, an email verification link), then
   refresh the Firebase user/token after completion.

In both cases, the only backend handoff remains a refreshed, verified Firebase
ID token sent to `POST /auth/session`.

## UI implementation notes

- Disable primary buttons until their required fields are valid, as shown in
  the designs. The client should still handle server-side Firebase errors such
  as duplicate email, invalid credentials, cancelled provider login, and an
  expired verification action.
- The API does not offer a password-reset endpoint. The **Forgot Password?**
  action must use Firebase's password-reset capability in the client flow.
- The Worker returns generic authorization failures for invalid/expired tokens;
  do not expose raw server error details to the user. Ask them to sign in again
  or complete verification as appropriate.
- Preserve the current Firebase ID token and refresh it before protected API
  requests. A valid Firebase token still cannot access Medly until
  `/auth/session` has created or linked the local user.
- The UI's welcome/success screen should not be treated as proof of Medly
  access. The authoritative completion point is a successful `/auth/session`
  response.

## Backend gaps revealed by the review

No backend changes are required for standard Firebase authentication. The
following features would require separately scoped API/product work if wanted:

- A Medly-owned six-digit email-OTP system instead of Firebase/provider-owned
  verification.
- Separate first-name and last-name storage or profile-editing APIs.
- Password-reset or credential-management endpoints owned by Medly rather than
  Firebase.

---

## Home screen review

The supplied home screen contains a greeting, a “Continue Learning” card,
module discovery, recent lectures, and bottom navigation. The layout is a good
fit for the existing catalogue endpoints, but the current API does not yet
provide every piece of personalized or visual data shown in the design.

### Screen elements and API mapping

| UI element | Current source | Integration note |
| --- | --- | --- |
| `Hi, Zainab` greeting | `GET /api/v1/me` → `data.name` | Supported after `POST /auth/session` completes. The API stores one display name, not separate first/last names. |
| Explore Modules cards | `GET /api/v1/modules` | Supported for title, module number, academic year, semester, and pagination. The UI can use `pageSize=2` for a two-card preview. |
| Module “View” action | Module `id` from the list | Navigate to the module detail/lecture list, then call `GET /modules/:moduleId/lectures`. |
| Latest Lectures | `GET /api/v1/lectures?page=1&pageSize=<n>` | Supported for title, subject, lecture date, academic year, semester, and locked-video state. Results are ordered by newest lecture date. |
| “See all” module/lecture links | Existing list endpoints | Supported. Navigate to the relevant paginated list screen. |
| Bottom navigation | Client navigation state | No backend API required for Home, Modules, or Profile routing. |
| Repeated login screen | Authentication section above | It has the same API implications as the earlier Welcome Back screen; no additional backend requirement is revealed. |

### “Continue Learning” requires a client decision or new backend support

The card shows a specific module/lecture and a **Continue** action. The Worker
currently has no user-level lecture history, last-opened lecture, video watch
position, or course-progress record. It cannot determine what a learner should
resume.

For the first mobile release, choose one of these approaches:

1. Store the most recently opened lecture and any video resume position on the
   device. The client can then request the current lecture detail and use its
   ID when the user taps **Continue**.
2. Derive a non-personalized card from the newest lecture returned by
   `GET /lectures`. This is simple but is not genuinely “continue learning.”
3. Scope a backend learning-progress feature if resume state must follow the
   learner across devices. This needs a new data model and API; the existing
   flashcard state only records flashcard knowledge, visibility, and viewed
   time.

On Continue, request `GET /lectures/:lectureId/video` only when playback is
about to begin. Handle `403 FORBIDDEN` as a locked/paid lecture and direct the
user to the booking flow rather than showing a broken player.

### Module and lecture images are not in the API

The design includes a thumbnail image on module cards and lecture rows. The
current `Module` and `Lecture` DTOs do not include an image URL or image key.

Until image support is added, the client must use one of these intentional
alternatives:

- ship fixed or generated client-side artwork keyed by module/subject;
- show a neutral branded placeholder; or
- add a separately scoped module/lecture thumbnail field and private/public
  image-delivery design to the backend.

The client must not attempt to infer an image URL from the module or lecture
ID; no corresponding storage route exists.

### Latest lecture card data

`GET /lectures` returns `moduleId`, but it does not return the module title or
module number. The home screen’s `Module 04` style label therefore needs one of
the following:

- a client-side lookup from a previously loaded `GET /modules` response; or
- a future API addition that includes module display data in lecture-list
  items.

The endpoint does already return `academicYear` and `semester`, so those labels
do not need an additional request.

### Recommended initial home-screen requests

After a successful authenticated session, the Home tab can load in parallel:

```text
GET /me
GET /modules?page=1&pageSize=2
GET /lectures?page=1&pageSize=3
```

Use the module list as a local lookup for module labels on lecture rows. Avoid
calling individual lecture/video endpoints for every card; the list responses
already include each card's display data and `videoLocked` state.

---

## Modules, subjects, and lecture-detail review

The supplied screens cover the module browser, academic-year/semester selection,
module details, subject details, and the lecture-detail learning hub. Their
underlying content model is mostly supported, but subjects and several visual
or aggregate fields must be derived by the client today.

### Screen elements and API mapping

| UI element | Current source | Integration note |
| --- | --- | --- |
| Academic-year selector | `GET /modules` | `academicYear` is a free-form module string. There is no distinct-years endpoint; derive available years from loaded module pages or maintain the approved years in client configuration. |
| Semester selector | `GET /modules` | Filter with `GET /modules?academicYear=<year>&semester=<semester>`. There is no distinct-semesters endpoint. |
| All Modules grid | `GET /modules?academicYear=<year>&semester=<semester>` | Supported for title, number, academic year, semester, and price. `meta.total` supports the module count. |
| My Modules tab | `GET /bookings` plus `GET /modules` | There is no direct “my accessible modules” endpoint. Filter locally to `ACCEPTED` booking `moduleId` values, then join them to modules. |
| Module details | `GET /modules/:moduleId` | Supported for title, number, year, semester, and `priceCents`. |
| Module subjects | `GET /lectures?moduleId=<moduleId>` | There is no subjects resource. Group returned lectures by their `subject` string and count each group. |
| Subject lecture list | `GET /lectures?moduleId=<moduleId>&subject=<subject>` | Supported. Use `meta.total` for the subject's lecture count. |
| Lecture details | `GET /lectures/:lectureId` | Supported for title, description, subject, lecture date, locked state, and conditionally the video URL. |
| Lecture materials tab | `GET /lectures/:lectureId/materials` | Supported. Download an item with `GET /lectures/:lectureId/materials/:materialId/download`. Materials are available to all authenticated users; only video access is paid/locked. |
| Flashcards tab and progress | Flashcard endpoints | Use `GET /lectures/:lectureId/flashcards` and `GET /lectures/:lectureId/flashcards/progress`. |
| MCQs tab and quiz count | `GET /lectures/:lectureId/mcqs` | Supported, but the client must load the MCQ array to display its count; there is no count-only endpoint. |
| Book Module button | Booking endpoints | The button must begin receipt selection/upload, then create a booking; it cannot grant access directly. |

### Booking module flow

The locked-video banner accurately reflects the API's access policy: a student
can see lecture metadata and materials, but cannot receive its external video
URL until an admin accepts their module booking.

```text
User taps Book Module
  → chooses receipt (PDF, JPEG, or PNG)
  → POST /uploads (purpose: payment-receipt) → direct R2 PUT → POST /uploads/complete
  → POST /bookings with moduleId + returned objectKey
  → show PENDING status
  → admin accepts request
  → GET /lectures/:lectureId/video returns videoUrl
```

Do not label a booking as successful video access immediately after
`POST /bookings`; the response is normally `PENDING`. Use `GET /bookings` when
the user returns to the module or refreshes the relevant state. If the user
already has an `ACCEPTED` booking, hide/replace the booking CTA and allow video
playback.

### Subject model is derived, not first-class

The Figma screens treat **Anatomy**, **Physiology**, and similar values as
subjects with their own screens. The API currently stores `subject` only as a
string on each lecture. It has no subject ID, description, thumbnail, custom
ordering, or standalone subject endpoint.

For the current implementation, the client can:

1. Request the module's lectures.
2. Group items by exact `subject` value.
3. Navigate using the module ID and an URL-encoded subject string.
4. Request `GET /lectures?moduleId=<id>&subject=<subject>` for the detail list.

This is sufficient for the displayed subject names and counts. If admins need
to define subject metadata, control subject order, or rename subjects safely,
the backend needs a first-class `subjects` model and migration.

### Lecture order and labels need definition

The subject screen displays labels such as **Lecture 01** through **Lecture
04**. Current lectures have a `lectureDate` but no lecture number or ordering
field. List results are ordered by newest `lectureDate` first, which may not
match the intended syllabus order.

For a temporary client-only label, number the filtered result set after sorting
by the desired date order. This is not stable if lectures are inserted or
backdated. Add a lecture `ordering`/`sequenceNumber` field if the numbered,
curriculum order shown in Figma is product-critical.

### Flashcard completion wording needs a product rule

The lecture-detail screen shows **8 of 20 completed** and **40%**. The progress
endpoint returns:

```ts
{ total: number; known: number; hidden: number }
```

It does not return a generic completed count. The client can display
`known / total` and calculate `known / total * 100` only if the product defines
“completed” as “marked known.” Hidden cards are separate from known cards and
should not silently be counted as completed. If completion instead means a card
was viewed, the current progress endpoint must be extended.

### Missing images and currency metadata

The supplied module, subject, and lecture screens use image thumbnails. Neither
`Module` nor `Lecture` provides an image URL/key, and subjects are only strings.
Use a deliberate client-side placeholder/artwork system until image fields are
separately added; do not invent storage URLs from IDs.

The module API returns `priceCents` but no currency code. The `EGP 120` label
therefore requires a product-level currency choice or client configuration. Do
not assume EGP solely from the numeric API value if the application may support
another currency later.

### Efficient client loading

For a module-details screen, load these in parallel:

```text
GET /modules/:moduleId
GET /lectures?moduleId=:moduleId&page=1&pageSize=100
GET /bookings
```

Use the lecture collection to derive subject cards and counts, and use bookings
to determine whether the module has an accepted booking. If a module can exceed
100 lectures, paginate through all pages before deriving complete subject
counts, or add a backend aggregation endpoint.

For the lecture-detail screen, load in parallel:

```text
GET /lectures/:lectureId
GET /lectures/:lectureId/materials
GET /lectures/:lectureId/flashcards/progress
GET /lectures/:lectureId/mcqs
```

Fetch the full flashcard list only when the user opens the tab or starts study.
Request the protected video endpoint only when playback begins.

---

## Booking and payment review

The supplied booking screens correctly present payment as a manual transfer
followed by receipt review. The current API supports receipt upload, pending
booking creation, booking-history status, and admin acceptance/rejection. It
does not manage payment instructions, payment-provider accounts, or transfer
verification itself.

### Screen state and API mapping

| UI state | API action/state | Integration note |
| --- | --- | --- |
| Empty receipt picker | No request yet | Keep **Submit Booking Request** disabled until a receipt upload succeeds. |
| “Uploaded successfully” receipt row | upload URL → R2 PUT → `POST /uploads/complete` succeeded | This is only a private-file upload, not a submitted booking. Retain the returned `data.objectKey` in temporary client state. |
| Remove (`×`) uploaded receipt | `DELETE /bookings/receipt` | Send `{ receiptKey }` only while no booking has been submitted. |
| Submit Booking Request | `POST /bookings` | Send `{ moduleId, receiptKey }`; only then is the booking created with `PENDING` status. |
| “Pending Review” receipt row | A booking returned with `status: 'PENDING'` | This is the correct state after successful submission. Do not show upload/remove controls for this retained review record. |
| Back to Module | Client navigation | Refresh `GET /bookings` when the module is reopened to reflect an admin decision. |

### Required receipt-upload flow

First request `POST /api/v1/uploads` with JSON metadata:

```ts
{ purpose: 'payment-receipt', filename: 'receipt_payment.jpg', contentType: 'image/jpeg', sizeBytes: 12345 }
```

PUT the bytes directly to the returned `data.uploadUrl` using
`data.requiredHeaders`, then call `POST /api/v1/uploads/complete` with the
returned `objectKey`, `purpose`, and the same metadata. Do not send the
Firebase token to R2.

The supported formats shown in Figma map to these exact MIME types:

| User-facing format | Required HTTP `Content-Type` |
| --- | --- |
| PNG | `image/png` |
| JPG/JPEG | `image/jpeg` |
| PDF | `application/pdf` |

The response is:

```ts
type Upload = {
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};
```

Do not show or persist `objectKey` in visible UI. It is an opaque temporary
storage key needed only for the next `POST /bookings` or a delete request.

### Upload size mismatch to resolve

The Figma upload placeholder says **“PNG, JPG or PDF, up to 10MB.”** The
implemented API accepts receipt uploads up to **100 MiB (104,857,600 bytes)**.

Either choice is viable, but the product must choose one explicit contract:

- retain a 10 MB client-side cap and change the implementation guide to state
  that it is a deliberate UX cap stricter than the server limit; or
- change the Figma copy to “up to 100 MB” (or “100 MiB” for exactness) so it
  matches the API.

In either case, validate file type and size before upload for a clear user
message, while still handling server-side `400 BAD_REQUEST` validation errors.

### Payment instructions are not API data

The displayed **InstaPay Account**, account handle, and account name do not
come from the current Medly API. The screen needs an intentional source for
these values, such as reviewed client configuration or a future CMS/settings
endpoint. Do not hard-code production payment details into an app build if they
may change.

Similarly, the module API provides `priceCents` but no currency code. The app
can display `EGP 120` only when EGP is a defined client/product configuration;
format the numeric amount from `priceCents` rather than duplicating a price in
the booking UI.

### Booking-state handling

After `POST /bookings` returns success, render the **Pending Review** screen
using the returned booking data. A `PENDING` booking does not unlock videos.
Only `ACCEPTED` creates the server-side module access grant.

When entering a module, fetch `GET /bookings`, find a record for that module,
and render the CTA by status:

| Booking status | Recommended module UI |
| --- | --- |
| No record | Show **Book Module**. |
| `PENDING` | Show a pending-review state; do not allow a duplicate submit. |
| `ACCEPTED` | Hide booking CTA and enable video playback. |
| `REJECTED` | Show the product-approved retry/contact-support experience. The current API supplies no rejection reason. |

Submitting another booking for a module with an existing `PENDING` or
`ACCEPTED` record returns `409 CONFLICT`. A rejected booking does not block a
new request, but the client must upload a new receipt and submit it as a new
booking.

### Failure and cleanup behavior

- If upload succeeds but booking creation fails or the user abandons the flow,
  call `DELETE /bookings/receipt` when possible. The Worker also removes
  unsubmitted uploads after 24 hours.
- If the receipt has already been submitted, it cannot be removed by the
  student; it is retained for admin review.
- There is no booking-reason field, receipt preview URL, or student booking
  cancellation endpoint. These would need separately scoped product/API work
  if required by the UX.

---

## Flashcard study review

The supplied screens show one card in three local UI states: question/front,
answer/back, and answer marked completed. The existing flashcard API supports
the card content and per-user study state, with a small terminology decision
needed for the **Completed** wording.

### Screen state and API mapping

| UI element/state | API source/action | Integration note |
| --- | --- | --- |
| `8 / 20` and progress bar | `GET /lectures/:lectureId/flashcards/progress` | The API returns `total`, `known`, and `hidden`; use `known / total` only if “completed” means “marked known.” |
| Current card content | `GET /lectures/:lectureId/flashcards` | Each card returns front/back text, protected image URLs, `ordering`, and the current user's state. |
| Tap to reveal answer | Client-only flip state | Both sides already arrive in the list response. Do not call the API just to flip the card. |
| Mark as Completed | `PUT /flashcards/:flashcardId/state` | Send `{ knowledge: 'KNOWN', viewed: true }` after the learner marks the card complete. |
| Completed confirmation | Returned/update local `state.knowledge` | Render completed when the local/API state is `KNOWN`. |
| Previous / Next | Client index over the ordered card array | The API returns cards sorted ascending by `ordering`; maintain the current index locally. |

### Recommended initial load

Load the card list and aggregate progress in parallel when the user starts the
flashcard experience:

```text
GET /lectures/:lectureId/flashcards
GET /lectures/:lectureId/flashcards/progress
```

The list contains each card's personal state, so no additional request is
needed while moving between cards. After marking a card known, update the local
card state and increment the local `known` count only when it changed from a
different value. Re-fetch progress when returning to the lecture-detail screen
or after a failed/retried state update.

### Completed, known, and viewed are different concepts

The API has no `completed` property. It supports:

```ts
type FlashcardState = {
  knowledge: 'KNOWN' | 'UNKNOWN' | null;
  hidden: boolean;
  viewedAt: string | null;
};
```

The design's **Mark as Completed** and **Completed** states should therefore be
defined as `knowledge: 'KNOWN'` for the current MVP. `viewed: true` can be sent
at the same time to retain the last-viewed timestamp, but viewed cards are not
included in the aggregate progress response.

If the intended meaning is “the learner reached this card,” rather than “the
learner knows this card,” the current backend cannot calculate the shown
completion progress. It would need a progress endpoint that counts `viewedAt`
or an explicit completed state.

The API allows a learner to set `knowledge: 'UNKNOWN'` or `null` later, but the
Figma screens do not show an undo/not-yet-known action. Product should decide
whether to expose one; otherwise a user cannot correct an accidental completed
tap through the current design.

### Hidden cards and denominator behavior

A learner's `hidden: true` cards are omitted from the flashcard list, but the
progress endpoint's `total` includes all lecture cards and reports `hidden`
separately. Therefore `8 / 20` can be misleading if cards are hidden: the
visible card array may have fewer than 20 items.

Choose and document one UI rule:

- show `known / total` and make the total include hidden cards; or
- calculate the visible-card denominator locally from the returned list and
  label it clearly; or
- extend the progress API with a `visibleTotal` field.

The client should not assume the progress total always equals `flashcards.length`.

### Flashcard images

`frontImageUrl` and `backImageUrl` are short-lived presigned R2 download URLs.
They can be passed directly to a browser or native image component without a
Firebase bearer token. They expire after 10 minutes; reload the list or
`GET /flashcards/:flashcardId` to receive fresh URLs.

The same rule applies to a card that has both text and an image: render any
present content from the front or back response fields; do not infer a storage
URL from the card ID.

### Navigation and state persistence

The backend stores state per card, but not which card the learner was viewing
when they left the screen. Previous/Next position, card shuffle order, flip
state, and fullscreen state are client-owned in the current MVP. Persist the
current card index locally if resume-at-card behavior is desired; a
cross-device resume position would require new backend support.

---

## Profile review

The supplied profile screen shows initials, a short account number, email,
phone number, editable-looking account rows, and logout. The current API
supports only the display name and email for a regular user.

### Screen elements and API mapping

| UI element | Current source/action | Integration note |
| --- | --- | --- |
| Profile name/initials (`AM`) | `GET /api/v1/me` → `data.name` | Supported. Derive initials in the client from the single display-name string. |
| Email address | `GET /api/v1/me` → `data.email` | Supported as read-only local account data. |
| Profile/account ID (`#10245`) | None | The API exposes a UUID `data.id`, not a short numeric student/account number. Do not derive or display a misleading truncated UUID. |
| Phone number | None | The `User` DTO has no phone field. |
| Email/phone row chevrons | None | There is no current profile-update endpoint. Do not route these rows to an editable screen until product/API support exists. |
| Log Out | Firebase client sign-out + client cleanup | No Medly logout endpoint is needed because the Worker is stateless and uses Firebase bearer tokens. |

### Recommended initial load

The Profile tab can render from the user returned by `POST /auth/session` or
refresh its data with:

```text
GET /api/v1/me
```

Avoid treating the Firebase UID or Medly UUID as a user-friendly account number.
If the design requires `#10245`, add a server-issued, stable, non-sensitive
public account identifier with its own uniqueness and display rules.

### Logout behavior

When the user taps **Log Out**:

1. Call the Firebase client SDK sign-out operation.
2. Clear the cached Firebase token, local Medly user, pending protected-image
   blobs/files, and client-owned learning/booking navigation state as
   appropriate.
3. Navigate to the Welcome Back screen.

Do not call `/auth/session` during logout. The Worker does not create a server
session or retain a logout state. Previously issued Firebase tokens remain
valid until Firebase expires, refreshes, or revokes them; the client must stop
sending them once signed out.

### Backend gaps revealed by the profile design

The following require separately scoped product and backend work:

- User phone-number storage, validation, verification, and privacy policy.
- A profile update endpoint for name and/or phone, including the decision of
  whether Firebase or Medly is the source of truth for each field.
- A stable user-facing account/student number if `#10245` is a product
  requirement.

---

## MCQ quiz and answer-review review

The supplied quiz screens cover unanswered and selected-choice states,
previous/next navigation, completion, and a final answer-review score. The
current MCQ API supports this flow, but it is intentionally stateless: quiz
answers, score, question position, and review data must be retained by the
client for the duration of an attempt.

### Screen state and API mapping

| UI element/state | API source/action | Integration note |
| --- | --- | --- |
| `Question 1 of 10` and progress bar | `GET /lectures/:lectureId/mcqs` | Load the array, then calculate the total and current index locally. |
| Question and four choices | MCQ list response | Supported. The API returns exactly four ordered choices, including each choice's `isCorrect` flag. |
| Selected answer | Client attempt state | Store `mcqId` → `choiceId` locally to preserve selection when Previous/Next is used. |
| Disabled Next without a choice | Client validation | Supported client behavior; no API call is needed to enable/disable the button. |
| Next / Previous | Client question index | The API has no quiz-session endpoint or navigation state. |
| Quiz completion | Client compares all selected answers | Compare selected choice IDs with the loaded `isCorrect` flags, then calculate the score locally. `POST /mcqs/:mcqId/check-answer` remains available for future progress tracking. |
| `8 / 10` and `80%` review header | Client calculation | `score = correctCount`; `percent = correctCount / questionCount * 100`. No server score exists. |
| Correct/incorrect answer review | Loaded MCQ list | Use each choice's `isCorrect` flag to show the correct answer. |

### Recommended attempt flow

```text
GET /lectures/:lectureId/mcqs
  → keep ordered questions and choices in client state
  → learner selects a choice for each question
  → keep mcqId → choiceId in local attempt state
  → at completion, compare selections with each choice's isCorrect flag
  → calculate score and construct review rows locally
```

The client can calculate immediate feedback and final review from the loaded
`isCorrect` flags. Keep `check-answer` available for a future progress-tracking
flow, where each submitted answer needs a server-side event or validation.

### Retained answer-check endpoint

```http
POST /api/v1/mcqs/:mcqId/check-answer
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{ "choiceId": "<selected-choice UUID>" }
```

**Expected response:**

```ts
type Response = {
  data: {
    correct: boolean;
    correctChoiceId: string;
  };
};
```

The response returns the correct choice ID, not its text. A choice belonging to
another question returns `404 NOT_FOUND`.

### No server-side quiz attempt exists

The backend does not persist:

- selected answers;
- score, percentage, completion time, or pass/fail state;
- review results;
- current question index; or
- previous quiz attempts/history.

Consequently, leaving the app or losing local attempt state prevents the client
from reconstructing the review screen from the API alone. For the MVP, retain
the attempt in local state and decide whether short-lived device persistence is
needed for interruption recovery. Cross-device resume, saved grades, teacher
reporting, or an authoritative completion record require a separately scoped
quiz-attempt backend model.

### Product decisions revealed by the design

- The quiz UI requires an answer before Next, but the product should decide
  whether a learner may return and change an earlier answer. The API permits
  repeated checks but does not define an attempt-finalization rule.
- The API deliberately reveals the correct answer only after it receives a
  selected `choiceId`. The client must not place correct-answer metadata in
  bundled content or cached list DTOs before submission.
- Define rounding for the displayed percentage. For example, show `80%` for
  `8 / 10`; use a consistent integer/decimal rule for non-whole percentages.
- The completion screen says all questions are complete but does not show the
  score. Decide whether this is intentional or whether the score should also
  be shown before the learner taps **Review Answers**.

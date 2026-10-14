# Medly Firebase API test client

This is a disposable browser client for validating the real Firebase-to-Worker authentication path and every implemented API route. It is intentionally separate from the backend and is not a production UI.

## Before running it

1. In Firebase Authentication, enable **Email/Password** sign-in.
2. Add `localhost` in **Firebase Authentication → Settings → Authorized domains** if it is not already present.
3. Set the GitHub `production` environment variable `CORS_ORIGINS` to include `http://localhost:5173`, then deploy the Worker. Firebase authorized domains and Worker CORS origins are separate settings.
4. Confirm the deployed Worker has `FIREBASE_PROJECT_ID=test-e5d8b`.

## Run

```bash
cd test-client
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

## Test flow

1. Create an email/password account and use the verification email.
2. Return to this page, sign in, and use **Refresh verification status**. It must show `email verified`.
3. Choose **Provision API session**. A `201` response means the Worker created the local D1 user; a repeat request should return `200` with `created: false`.
4. Use **Call GET /me** and **Call GET /modules** to prove the same Firebase token can access protected Worker routes.

## Test every backend route

The **API explorer** groups presets for all system, user, module, lecture/material, booking, flashcard, and MCQ routes. It automatically sends the current Firebase ID token for every protected route. Each operation has normal form controls for its path, query, and body fields—no request JSON needs to be written. The **Activity log** records requests, response statuses, timing, and failures without recording passwords or bearer tokens.

1. Select an operation and fill in its fields. IDs and upload keys returned by prior requests are offered as suggestions in later fields.
2. For receipt, material, or flashcard-image upload presets, select a file. The console requests a short-lived upload plan, sends the bytes directly to private R2 with the required `Content-Type`, then verifies the upload with the API.
3. Download routes return a downloadable file link instead of attempting to render file bytes as JSON.
4. The console does not make a user privileged. To exercise admin routes, seed a super admin, use `GET /admin/users` to locate a test account, then grant it `ADMIN`. The seed command is documented in [the authentication runbook](../docs/authentication.md#bootstrap-the-first-super-admin).

Suggested end-to-end sequence: create a module and lecture as an admin; upload/list/download a material; create flashcards/MCQs; upload a receipt as a student; accept it as an admin; then verify that the student can retrieve the lecture video URL.

If a direct upload fails in the browser with a CORS error, check both the deployed Worker configuration and the R2 bucket CORS policy include the exact origin `http://localhost:5173`; the R2 rule must permit `PUT` and the `Content-Type` header.

The Firebase web configuration in `src/main.ts` is public client configuration, not a secret. Do not add a Firebase service-account key or user password to this repository.

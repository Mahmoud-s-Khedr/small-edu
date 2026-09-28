# Medly Firebase API test client

This is a disposable browser client for validating the real Firebase-to-Worker authentication path. It is intentionally separate from the backend and is not a production UI.

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

If an API call fails in the browser with a CORS error, check that the deployed Worker configuration includes the exact origin `http://localhost:5173` in `CORS_ORIGINS` and has been redeployed.

The Firebase web configuration in `src/main.ts` is public client configuration, not a secret. Do not add a Firebase service-account key or user password to this repository.

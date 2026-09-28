# Authentication implementation and launch runbook

Medly uses Firebase Authentication for one account with three sign-in methods:

- Email and password
- Google
- Apple

The API only accepts Firebase ID tokens with a verified email. Firebase performs
password handling, OAuth, token refresh, and password reset. The Cloudflare
Worker never receives a password and does not store a Firebase service-account
key.

## Architecture and client contract

Firebase's user UID is the stable identity. It becomes `users.external_subject`
in D1. The email address is profile data and is used only to attach a pre-Firebase
legacy account that has no Firebase UID. Roles are sourced only from D1.

```text
Email/password, Google, or Apple
             |
             v
       Firebase authenticated user
             |
             v
  getIdToken() -- verified bearer token --> Worker
             |                              |
             v                              v
POST /api/v1/auth/session           local D1 account and role
             |
             v
Current ID token on each protected API request
```

The client must follow this sequence after every interactive sign-in:

1. Complete a Firebase sign-in method.
2. For email/password registration, call Firebase's email-verification action and
   do not call the Medly API until `user.emailVerified` is true. Refresh or reload
   the Firebase user before checking that value.
3. Call `getIdToken()` and send `POST /api/v1/auth/session` with
   `Authorization: Bearer <token>`. This is provisioning, not a cookie session.
4. Retain no application auth token of its own. For every API request, get a
   current Firebase ID token (Firebase refreshes it) and send it as a Bearer token.
5. On `401`, refresh the Firebase ID token once and retry once. If that fails,
   sign the person out and return to the sign-in screen. On `409` from
   `/auth/session`, show account-support guidance; do not create a second local
   profile.

The first local provisioning gives the user D1 role `USER`. Firebase custom
claims must never grant a local role. A deployment-time seeder creates the
first `SUPER_ADMIN`; that role can grant and revoke `ADMIN` through the
super-admin user-management API, but cannot create additional super admins.

## Bootstrap the first super admin

Run migrations, then seed the exact verified Firebase email address of the
initial owner. This may be done before their first sign-in: the seeder creates
a local record without a Firebase UID, and `/auth/session` links it safely on
their first verified login.

```bash
# Local development
npm run db:migrate:local
npm run seed:superadmin -- --email owner@example.com --local

# Production
npm run db:migrate:remote
npm run seed:superadmin -- --email owner@example.com --remote
```

The seed command is idempotent. Re-running it for the same email restores its
`SUPER_ADMIN` role without changing its Firebase UID or profile. Keep access to
the deployment environment restricted and record who ran it and why.

## Client work to implement

Use the Firebase SDK for the selected client platform. The UI needs these paths:

- **Create account with email/password:** collect email and password, call
  Firebase registration, send verification email, and show a "check your email"
  state. Do not offer course data until verified.
- **Sign in with email/password:** call Firebase sign-in. If the email is not
  verified, resend verification and block API provisioning.
- **Forgot password:** use Firebase's password-reset email action. The Worker
  has no reset endpoint.
- **Continue with Google / Apple:** use the platform-native Firebase provider
  flow. On web, prefer redirect over pop-up on mobile browsers.
- **Sign out:** call Firebase sign-out and clear only local cached application
  data that should not be visible to the next device user.
- **Manage sign-in methods:** show the methods from Firebase `providerData` and
  let an authenticated user add another method. Require recent authentication
  before sensitive actions such as changing a password or unlinking a provider.

### Account linking is required

Do not create separate Firebase accounts for someone who first used Google and
later wants Apple or a password. While they are signed in, attach the new
credential/provider to their existing Firebase user with the Firebase SDK's
account-linking API. A linked provider retains the same Firebase UID, so it maps
to the same local Medly account automatically.

If Firebase says the new credential is already attached to another Firebase
user, stop and show a support/merge path. Do not silently merge D1 records and
do not use an email match to merge two Firebase UIDs. Course access, bookings,
and learning state are user data and need an explicit audited merge procedure.

## Firebase Console work (outside this repository)

Complete these separately for development, staging (if used), and production.
Use distinct Firebase projects where practical so test identities and redirect
settings cannot affect production.

1. Create the Firebase project and add every target client app (web origin,
   Android package and SHA fingerprints, iOS bundle ID).
2. In **Authentication → Sign-in method**, enable **Email/Password**, **Google**,
   and **Apple**. Keep Firebase's one-account-per-email behaviour enabled unless
   there is a reviewed reason to change it.
3. In **Authentication → Settings → Authorized domains**, add every deployed web
   domain. Add `localhost` deliberately for local web development; newer Firebase
   projects do not necessarily include it by default.
4. Configure Firebase email templates for verification and password resets:
   branded sender/name, approved action URLs, support contact, and a tested
   redirect/deep-link destination in each client.
5. Set the non-secret Worker variable `FIREBASE_PROJECT_ID` to the exact Firebase
   project ID. Set `CORS_ORIGINS` to the exact deployed web client origins.
6. Restrict the client Firebase API key appropriately in Google Cloud. It is
   normal for it to be in a client application, but it is not a credential that
   authorizes access to this API.

## Apple-specific setup (outside this repository)

Apple sign-in requires active Apple Developer Program membership.

1. Create/configure the App ID with the **Sign In with Apple** capability.
2. For web sign-in, create a Service ID associated with the website and App ID.
   Register Firebase's handler as an Apple return URL:
   `https://<firebase-project-id>.firebaseapp.com/__/auth/handler`.
3. Create an Apple Sign In key and record its key ID, team ID, Service ID, and
   private key. Enter them in Firebase Authentication's Apple provider setup.
   Treat the Apple private key as a secret in Apple/Firebase configuration, not
   a Cloudflare Worker secret.
4. Configure Apple's private email relay with Firebase's sender address (normally
   `noreply@<firebase-project-id>.firebaseapp.com`, or the configured custom
   template sender). Without this, verification and reset messages can fail for
   users who chose Hide My Email.
5. Add consent copy before associating an Apple private-relay address with a
   direct email address or another identity provider. Apple users can receive a
   `@privaterelay.appleid.com` address, and Apple usually supplies their name
   only on the first authorization. Preserve the name Firebase initially stored;
   do not overwrite it with an empty later response.

## What must not be added to this Worker

- Passwords, password hashes, or a custom password-reset endpoint.
- A Firebase service-account JSON credential.
- The Firebase web API key as a Worker secret.
- Firebase custom claims as a way to grant `ADMIN`.
- An application-issued browser cookie or duplicate long-lived session token.

## Release checklist

- [ ] Sign up with email/password; verify the address; provision the API account.
- [ ] Confirm an unverified email/password account receives `401` from the API.
- [ ] Reset password and confirm the new password signs in.
- [ ] Sign in with Google and provision the API account.
- [ ] Sign in with Apple using both shared and private-relay email options.
- [ ] Confirm Apple verification/reset email is delivered through private relay.
- [ ] Link Google, Apple, and email/password to one Firebase user and confirm the
      same D1 user ID, bookings, course access, and progress are retained.
- [ ] Confirm a credential already linked to another Firebase user cannot silently
      merge accounts.
- [ ] Confirm expired, wrong-project, unsigned, and unverified-email tokens are
      rejected by the Worker.
- [ ] Confirm regular users cannot call admin routes and Firebase claims do not
      change that result.
- [ ] Confirm every environment has the exact `FIREBASE_PROJECT_ID` and
      `CORS_ORIGINS` values.

## Primary references

- [Firebase: email/password authentication](https://firebase.google.com/docs/auth)
- [Firebase: link multiple providers](https://firebase.google.com/docs/auth/web/account-linking)
- [Firebase: Apple authentication for web](https://firebase.google.com/docs/auth/web/apple)

# Online V3 setup

V3 is isolated from every older ZF Operativa deployment. Copy `.env.example` to `.env.local`, then fill only configuration values from a new Firebase web app and the optional Sentry/PostHog projects.

The app stays local until all four `VITE_FIREBASE_*` values exist. When configured, it signs in anonymously and synchronizes only the current V3 board document at `zf-operativa-v3/current`.

Before production, create a new Firebase project, enable Anonymous Authentication, create a Standard Firestore database, configure prototype rules, add the Vercel domain to Firebase Auth, and complete two-device verification. Do not reuse any legacy Firebase project or credentials.

OCR images are not uploaded by the current client. They remain in the active browser session only; session metadata is purged after seven days. Cloud image retention requires a separate reviewed Storage lifecycle implementation before photo upload is enabled.

Sentry and PostHog are opt-in through environment variables. Their client integration never receives names, photos, OCR text, phone numbers, or the contents of a shift.

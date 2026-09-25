# Phase 14 — UI Polish and Verification

## Changes

- POST forms now add a polite live status message when a valid submission starts, set `aria-busy`, and mark the submitter unavailable while that request is pending. A second submission is prevented. Browser back/forward cache restoration clears the pending state and restores any changed button label.
- Long-running or important actions supply a clear status message, including sign-in, document upload and correction, temporary Form 137 scanning, grade import, finance transactions, and account changes. Existing server-rendered success, error, and empty-state messages remain in place.
- Upload instructions for file type and size are associated with the corresponding file and type controls through `aria-describedby`.
- Shared styles apply focus and invalid-state feedback consistently to inputs, selects, and textareas. Small-screen action groups wrap, financial balances use the available width, table actions and checkboxes have larger targets, and in-page anchors leave room around the focused target.

No routes, data access, role rules, school policy, or OCR decision wording changed. The templates continue to render dynamic content with escaped EJS output.

## Browser review

Used Google Chrome 153 headless with a temporary local Express app, in-memory session store, synthetic test accounts, and mocked auth/data services. The browser session did not connect to SQL Server, send email, or write persistent records or files. The test password and displayed student data were synthetic.

At **390×844** and **1440×1000**, the following role screens rendered with no horizontal document overflow:

| Role | Checked routes |
| --- | --- |
| Student | `/dashboard/student`, `/documents` |
| Registrar | `/dashboard/registrar`, `/records` |
| Database administrator | `/admin`, `/finance` |
| Finance | `/finance` |

At 390×844, student dashboard and document upload, registrar records, database-administrator dashboard, and finance workspace layouts were visually inspected. At 1440×1000, the registrar dashboard layout was visually inspected and the student dashboard, registrar records, database-administrator dashboard, and finance workspace were checked for overflow. On the desktop login page, a keyboard Tab focused the “Skip to main content” link; Chrome reported a solid focus outline. A mock invalid login rendered the `role="alert"` message “Invalid email or password.” at both widths, and the login inputs had associated labels.

In Chrome, a canceled synthetic `submit` event on the login form showed the live “Checking your sign-in. Please wait.” status and `aria-busy`; a second event was canceled; dispatching `pageshow` cleared the busy state and status. These synthetic events exercised only the client feedback and did not submit a request.

The in-app CUA browser was unavailable in this environment, so the review used the installed Chrome binary and its DevTools protocol. This was a visual review of local mocked behavior, not a live SQL, email-2FA, or persistent document workflow.

## Automated evidence

- `node --test tests/smoke.test.js tests/documents.test.js` — **47 passed**. Includes a focused client-script check for announced submit feedback, prevented duplicate submission, respect for an earlier `preventDefault()`, and state restoration after `pageshow`; document route rendering checks confirm the upload instructions are associated with the file control.
- `npm test` — **173 tests: 171 passed, 2 skipped, 0 failed**. The skipped tests are opt-in OCR integration cases.
- `npm run check` — passed.
- `npm run db:check` — passed against the configured local development database, including migrations 001–008 and the documented schema checks.
- `git diff --check` — passed.

## Remaining limits

The screenshots and keyboard check used the role routes above and the mock login flow with synthetic data. No production database, live email flow, document upload/OCR result, or actual finance transaction was exercised. Browser coverage does not establish school approval of the existing document rules or replace the Phase 13 objective gaps recorded in its evidence report.

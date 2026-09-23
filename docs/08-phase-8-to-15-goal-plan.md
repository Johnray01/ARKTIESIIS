# Goal Plan: Phases 8–15

The development roadmap marks Phases 1–7 complete. This Goal Mode handoff covers Phases 8–15 in the existing roadmap order. Phases 8–10 are described in greater detail because they are the immediate work: secure document management, Google Document AI integration, and configurable validation. Keep each phase reviewable, commit each completed phase locally after its acceptance gate passes, and continue automatically to the next phase under the new-chat authorization.

## Current repository state

- `database/schema.sql` already defines `documents` and `document_validations`, the four approved document types, file metadata, uploader, processing/review fields, and status constraints. The baseline is version `001`; schema changes must use new numbered, forward-only migrations.
- `src/config/environment.js` already reads the Google Document AI processor settings and `MAX_UPLOAD_MB` (default 10 MB).
- `src/config/documentAI.js` configures the Document AI client and processor resource name. `src/services/documentAIService.js` sends a local file to the configured processor. `src/services/documentValidationService.js` has a basic required-text helper.
- The existing services are not connected to document upload, authorized download, per-student document history, re-upload, reviewer actions, or end-to-end validation routes. Those are future phase work.
- The existing role, CSRF, SQL, and audit patterns in the application should be followed. Do not change the one-time schema baseline to update an initialized database.

## Role and document access matrix

All permissions must be enforced on server routes and every file download. Student identifiers supplied in a URL or form must never substitute for the authenticated student's own record link.

| Role | Good Moral Certificate | Report card | Form 137 | PSA birth certificate |
| --- | --- | --- | --- | --- |
| `student` | Upload, view, check status, and re-upload for own record only | Upload, view, check status, and re-upload for own record only | No access | No access |
| `registrar` | Manage, review, and download for authorized student records | Manage, review, and download for authorized student records | Upload, manage, review, and download | Upload, manage, review, and download |
| `database_admin` | Oversee, manage, review, and download | Oversee, manage, review, and download | Oversee, manage, review, and download | Oversee, manage, review, and download |
| `finance` | No access | No access | No access | No access |

“Manage” permits the authorized staff workflow for a school record; it does not grant a student access to another student's records. Record any material upload, re-upload, review, or administrative change through the existing audit approach without logging document contents, extracted text, secrets, or raw provider errors.

## Phase 8 — Document Management

1. Inspect the current document schema and application conventions before changing them. Confirm the upload size limit, storage location, and any institution-approved retention requirements; do not invent retention or naming policy.
2. Add role-protected upload, list/detail, download, review handoff, and re-upload routes and matching views. Use CSRF protection for mutations and repeat active-role and ownership checks inside service writes where the existing pattern does so.
3. Accept only PDF, JPEG, and PNG. Validate the extension, declared MIME type, actual file signature where applicable, and configured size limit on the server. Reject missing, empty, oversized, or mismatched uploads with a user-safe message.
4. Generate opaque stored names. Store files outside the public directory and resolve every path beneath the configured storage root. Never render a filesystem path. Download handlers must recheck role and record ownership before streaming a file.
5. Persist the existing metadata: student, selected document type, original filename, opaque stored filename, MIME type, byte size, uploader/source, status, and timestamp. Clean up an unreferenced file if the database write fails; report a safe error if cleanup also fails.
6. Treat each corrected re-upload as a new immutable submission. Preserve the previous file and validation history. If the current schema cannot link revisions clearly, add a numbered migration for a version/supersedes relationship rather than overwriting a file or editing the baseline.
7. Build student history/status views and staff search/review views under the role matrix above. Do not expose OCR output to students unless the institution explicitly approves that behavior.

### Phase 8 acceptance checks

- Students can upload and retrieve only their own Good Moral Certificates and report cards. Attempts to change a student ID, URL, or document ID cannot reveal another student's file.
- Registrar and database administrator access follows the matrix, including restricted Form 137 and PSA birth certificates. Finance receives no document access.
- Disallowed types, MIME/extension mismatches, empty files, invalid file signatures, and size-limit violations are rejected. Stored files are not served from the public static directory.
- A failed database write does not leave an untracked file. An unauthorized or stale download request is denied.
- Re-upload creates a new submission while prior files, statuses, validation results, and review history remain available to authorized staff.
- Mutations use CSRF checks, parameterized SQL, and audit events consistent with existing application patterns.

## Phase 9 — Google Document AI

1. Keep the configured Google Cloud project, location, processor ID, and credentials in environment/runtime configuration. Do not commit service-account keys or log credential material.
2. Call the existing `documentAIService.processDocument` only for a securely stored, authorized upload with a supported MIME type. Add safe timeout and provider-error handling at the integration boundary.
3. Move a submitted document through the existing `pending` and `processing` states. Persist a normalized extraction result in `document_validations`; limit access to extracted text because it contains student information.
4. Handle successful extraction, empty/unreadable output, missing configuration, provider rejection, timeout, and transient service failure. Store a safe result/status and user-facing retry or review guidance; never expose raw provider or database errors.
5. Do not classify documents or infer authenticity. OCR output is untrusted input: escape it in views, do not execute it, and pass only the uploader-selected type to validation.

### Phase 9 acceptance checks

- A valid configured PDF/image reaches the configured processor and its extracted text/result is associated with the correct immutable document submission.
- Missing configuration, provider errors, timeouts, empty OCR, and malformed provider responses are contained, recorded safely, and do not leave a document indefinitely marked as processing.
- Extracted text and validation details are inaccessible to unauthorized roles and are rendered safely when shown to authorized staff.
- No provider result or UI claims authenticity, forgery detection, signature/seal verification, forensic review, or automatic type classification.

## Phase 10 — Validation Rules and Review

1. Obtain institution-approved required fields and format/compliance rules for each document type before configuring production checks. Existing examples in `docs/04-document-ai.md` are examples only, not approved requirements.
2. Keep rules explicit and keyed to the uploader-selected document type. Validate only OCR-readable required information, completeness, and configured format/compliance constraints. Do not invent school-specific fields, formats, grading periods, or acceptance rules.
3. Apply the status meanings already documented in [04-document-ai.md](04-document-ai.md):
   - `valid`: configured completeness/format checks passed.
   - `needs_review`: OCR is uncertain or checks need human judgment.
   - `failed`: processing failed or required checks could not be satisfied.
   - `pending` and `processing`: workflow states already allowed by the schema.
4. The baseline schema also permits `rejected`, but the existing AI documentation does not define it. Before using it, define it as a human review outcome and keep that decision distinct from OCR/automated validation. If new persisted fields or constraints are needed, add a numbered migration.
5. Provide a registrar/database-administrator review flow for cases requiring human judgment: show the selected type, source file, configured check results, and reviewer identity/time; record the decision and allow the student to receive a correction/re-upload instruction where applicable. A `valid` automated result is not evidence of authenticity and does not replace any required human acceptance.
6. Do not mark a document `valid` when the institution has not supplied the applicable validation rules. Agree on the safe unconfigured-rule behavior before release.

### Phase 10 acceptance checks

- Unit-level checks cover configured required fields, complete/incomplete text, configured format rules, empty OCR, and uncertain OCR.
- Each document type uses only its institution-approved rule set. No rules are silently inferred from sample documents or from the AI provider.
- A document is `valid` only when the configured checks pass; uncertain results enter `needs_review`; processing/check failures enter `failed`; human rejection, if used, is recorded as a distinct review decision.
- Registrar and database administrator can review authorized submissions, and the recorded reviewer and decision remain attached to the correct submission/version. Students see only their own permitted status and instructions. Finance cannot view or review documents.
- A corrected re-upload starts a new validation run without changing the prior OCR result or reviewer history.

## Phase 11 — Dashboards and Reporting

Build the student, registrar, finance, and database administrator dashboards from the role-specific capabilities already in scope. Add useful counts and status summaries only; do not add analytics or reports that require new school policy or expose data across roles.

**Acceptance gate:** each role sees the expected workspace and summaries; students see only their own document/academic information, finance sees finance data only, and no dashboard action bypasses server authorization.

## Phase 12 — Security and Audit

Review authorization, input validation, upload hardening, session protections, audit coverage, and sensitive data exposure across the completed workflows. Address findings in the existing stack and document backup/restore procedures needed before deployment.

**Acceptance gate:** server-side role and ownership checks cover protected reads and writes; upload and download paths remain private; important actions are auditable without storing secrets or raw document contents; production errors do not expose SQL, stack traces, or provider details; security checks pass.

## Phase 13 — Testing

Complete the roadmap test coverage for validation rules, authentication and roles, CRUD workflows, document upload/re-upload/download, and the manual role/access matrix. Run the relevant automated checks and an end-to-end workflow against a configured environment where available; record any environment-dependent checks that could not run.

**Acceptance gate:** automated tests and project checks pass; manual role/access scenarios pass; each document lifecycle path has verified success and safe failure behavior; remaining failures or unavailable dependencies are documented before UI polish or deployment work.

## Phase 14 — UI Polish

Polish responsive layouts, empty/loading/error states, form feedback, and accessibility basics across the completed role workflows. Keep labels and status wording understandable without implying that OCR proves authenticity.

**Acceptance gate:** core screens remain usable at narrow and desktop widths; forms and status changes provide clear feedback; keyboard navigation, visible focus, labels, and error messages work across the main flows; no role-specific information is exposed by presentation changes.

## Phase 15 — Deployment and Defense Readiness

Prepare production environment configuration, document and verify the database backup/restore procedure, provide development-only demo accounts and sample records through a guarded idempotent seeder, complete an end-to-end demo, and write a defense demonstration checklist.

**Acceptance gate:** production settings require secrets from the environment and do not permit development-only authentication or seed operations; backup and restore steps have been exercised; the demo seeder is explicitly guarded and safe to rerun; the final demo follows the approved role/document boundaries and has a written checklist.

## Stop conditions

- Run Phases 8–15 continuously in order as one Goal Mode objective. After each phase passes its acceptance gate, report a concise checkpoint, create one local commit for that completed phase with a plain human message, and continue to the next phase automatically. Never push.
- If a gate fails, resolve it within the current phase before proceeding. Pause only when a required gate cannot be resolved without user input, institution-approved rules or credentials are missing, or an irreversible action requires approval.
- Do not commit a phase that is incomplete or blocked.
- Do not invent a substitute for missing institution policy, credentials, or deployment details.
- After Phase 15 passes its gate, report completion and stop. Do not add unrequested features or proceed beyond the roadmap.

## Goal Mode objective

> Complete ARKTIESIIS roadmap Phases 8–15 in order within this single goal: secure document management, Google Document AI integration, institution-approved validation rules and review, role-specific dashboards and reporting, security and audit review, test coverage, UI polish, and deployment/defense readiness. Preserve the fixed project stack and all user changes. Enforce the documented role and document rules on the server. Complete each phase gate, report a concise checkpoint, and continue automatically to the next phase. After each completed phase passes its acceptance gate, create one local commit for that phase using a plain human message; do not commit incomplete or blocked phases, and never push. Pause only for truly required user input, an irreversible action requiring approval, or an unresolved gate. Do not invent institution policy.

## Copy/paste prompt for the new chat

```text
Start one Goal Mode objective using the objective in docs/08-phase-8-to-15-goal-plan.md. Work in this ARKTIESIIS repository. Use this same local checkout, not a fresh worktree, so these docs and all uncommitted work are available. First read AGENTS.md and docs/07-paper-objectives-scope-limitations.md plus docs/08-phase-8-to-15-goal-plan.md. Phases 1–7 are complete; implement Phases 8–15 in roadmap order using the existing Node.js/Express/EJS/SQL Server/Google Document AI/email-2FA stack. This prompt authorizes completing all eight phases continuously within this goal: after each phase passes its acceptance gate, report a concise checkpoint, create one local commit for that phase using a plain human message, and continue automatically. Never push or commit an incomplete or blocked phase. Follow the exact role matrix and security gates in the plan. Preserve existing uncommitted changes. For each phase, make reviewable changes, run relevant checks, review access/security, and update docs as needed. Pause only for truly required user input, an irreversible action requiring approval, or an unresolved gate. Do not invent school requirements: pause for institution-approved document rules or other required inputs when needed. Never claim AI proves authenticity or detects forgery.
```

## Out of scope

- Training a new AI model, document-type classification, or automated claims that a document is genuine.
- Forgery detection, signature/seal authentication, paper/material authenticity checks, or forensic analysis.
- Changing the fixed Node.js/Express/EJS/SQL Server/Google Document AI/email-2FA stack.
- Adding multi-school support, unapproved AI capabilities, or features beyond roadmap scope.

## Inputs required before production validation

- Institution-approved required fields and format/compliance rules for Form 137, report cards, Good Moral Certificates, and PSA birth certificates.
- Confirmation of which validation cases require registrar review and what human outcomes/decision wording the system should record.
- Confirmation of upload size and retention limits. The repository currently has a configurable 10 MB default; that value is not asserted as school policy.
- Google Cloud project, location, processor, runtime credentials, and stable Internet access in the deployment environment.

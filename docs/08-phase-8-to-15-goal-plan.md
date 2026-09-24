# Goal Plan: Phases 8–15

The development roadmap marks Phases 1–7 complete. This plan is split into two separate Goal Mode runs in the existing roadmap order. Goal 1 covers Phases 8–10: secure document management, local OCR, and configurable validation. Goal 2 covers Phases 11–15 and may start only after Goal 1 is complete. Phase 10 remains paused until the institution supplies approved document requirements and review rules. Keep each phase reviewable and create one local commit for each completed phase after its acceptance gate passes; never push. The user has authorized the Phase 9 commit only after the full native OCR acceptance gate passes on Linux and Windows. Use the same local checkout for both runs so the docs and completed work remain available. Do not overlap the goals or begin Goal 2 early.

## Current repository state

- `database/schema.sql` defines `documents` and `document_validations`, the four approved document types, file metadata, uploader, processing/review fields, and status constraints. The baseline is version `001`; migrations `002` and `003` add two-factor limits and document revision/review-event support; migration `004` adds processing leases; migration `005` changes the default processor label while preserving existing validation rows. Schema changes use new numbered, forward-only migrations.
- `src/config/environment.js` reads configurable Tesseract/Poppler executable paths, English OCR language, a bounded timeout, bounded worker concurrency, and `MAX_UPLOAD_MB` (default 10 MB).
- `src/services/localOcrService.js` securely copies a private upload into a temporary directory, uses `pdfinfo` and page-by-page `pdftoppm` rendering for PDFs, and calls Tesseract with native `execFile` argument arrays. `src/services/documentProcessingService.js` atomically claims pending immutable submissions, bounds concurrency/time/output/page count, recovers stale processing leases to a safe failed result, normalizes OCR outcomes, and stores a per-submission result. `src/server.js` starts the bounded queue/recovery scan after database connection and repeats it periodically. `src/services/documentValidationService.js` has a basic required-text helper; it is not yet wired to institution-approved rules.
- Phase 8 connects upload, authorized private download, per-student document history, immutable corrected re-upload, review handoff, and correction requests. Phase 9 connects OCR and staff-only extraction display. Phase 10 institution-approved validation rules remain future work.
- The existing role, CSRF, SQL, and audit patterns in the application should be followed. Do not change the one-time schema baseline to update an initialized database.

## Role and document access matrix

All permissions must be enforced on server routes and every file download. Student identifiers supplied in a URL or form must never substitute for the authenticated student's own record link.

| Role | Good Moral Certificate | Report card | Form 137 | PSA birth certificate |
| --- | --- | --- | --- | --- |
| `student` | Upload, view, check status, and re-upload for own record only | Upload, view, check status, and re-upload for own record only | No access | No access |
| `registrar` | Manage, review, and download for authorized student records | Manage, review, and download for authorized student records | Upload, manage, review, and download | Upload, manage, review, and download |
| `database_admin` | Oversee, manage, review, and download | Oversee, manage, review, and download | Oversee, manage, review, and download | Oversee, manage, review, and download |
| `finance` | No access | No access | No access | No access |

“Manage” permits the authorized staff workflow for a school record; it does not grant a student access to another student's records. Record any material upload, re-upload, review, or administrative change through the existing audit approach without logging document contents, extracted text, secrets, or raw command/database errors.

## Phase 8 — Document Management

1. Inspect the current document schema and application conventions before changing them. Confirm the upload size limit, storage location, and any institution-approved retention requirements; do not invent retention or naming policy.
2. Add role-protected upload, list/detail, download, review handoff, and re-upload routes and matching views. Use CSRF protection for mutations and repeat active-role and ownership checks inside service writes where the existing pattern does so.
3. Accept only PDF, JPEG, and PNG. Validate the extension, declared MIME type, actual file signature where applicable, and configured size limit on the server. Reject missing, empty, oversized, or mismatched uploads with a user-safe message.
4. Generate opaque stored names. Store files outside the public directory and resolve every path beneath the configured storage root. Never render a filesystem path. Download handlers must recheck role and record ownership before streaming a file.
5. Persist the existing metadata: student, selected document type, original filename, opaque stored filename, MIME type, byte size, uploader/source, status, and timestamp. Clean up an unreferenced file if the database write fails; report a safe error if cleanup also fails.
6. Treat each corrected re-upload as a new immutable submission. Students may re-upload only their own Good Moral Certificates and report cards; registrar/database administrators may submit linked corrections for any document type they are allowed to manage. Preserve the previous file and validation history. If the current schema cannot link revisions clearly, add a numbered migration for a version/supersedes relationship rather than overwriting a file or editing the baseline.
7. Build student history/status views and staff search/review views under the role matrix above. Do not expose OCR output to students unless the institution explicitly approves that behavior.

### Phase 8 acceptance checks

- Students can upload and retrieve only their own Good Moral Certificates and report cards. Attempts to change a student ID, URL, or document ID cannot reveal another student's file.
- Registrar and database administrator access follows the matrix, including restricted Form 137 and PSA birth certificates. Finance receives no document access.
- Disallowed types, MIME/extension mismatches, empty files, invalid file signatures, and size-limit violations are rejected. Stored files are not served from the public static directory.
- A failed database write does not leave an untracked file. An unauthorized or stale download request is denied.
- Re-upload creates a new submission while prior files, statuses, validation results, and review history remain available to authorized staff.
- Mutations use CSRF checks, parameterized SQL, and audit events consistent with existing application patterns.

## Phase 9 — Local OCR with Tesseract and Poppler

1. Require local Tesseract with English trained data and Poppler's `pdfinfo`/`pdftoppm`; configure executable paths, language, timeout, and concurrency through runtime environment settings. Windows paths may contain spaces and must be passed directly without a shell.
2. Keep uploads in private storage. Copy a verified regular file to a private temporary directory, call Tesseract directly for JPEG/PNG, and use `pdfinfo` then page-by-page `pdftoppm` rendering plus Tesseract for PDFs. Clean rendered pages immediately and always remove the private temporary directory.
3. Enforce a technical 20-page PDF maximum (`OCR_MAX_PDF_PAGES` may lower it), bounded render dimensions/output, a bounded timeout that aborts active subprocesses, and bounded worker concurrency. Preserve the existing configurable 10 MB upload default.
4. Upload handlers schedule background work and return without waiting for OCR. Startup and periodic scans recover stale leases and drain pending rows. Claim one row atomically under SQL Server read-committed locking so parallel workers do not process a submission twice.
5. Persist normalized extraction results in `document_validations`; limit access to extracted text because it contains student information. Handle empty OCR, malformed/encrypted/over-limit PDFs, missing tools, timeout, and processing errors with fixed safe messages. Do not save partial PDF text as a completed result or expose raw command/database errors.
6. Do not classify documents or infer authenticity. OCR output is untrusted input: escape it in views, do not execute it, and pass only the uploader-selected type to validation.

### Phase 9 acceptance checks

- Valid image/PDF fixtures reach Tesseract and their text/result is associated with the correct immutable submission; `npm run ocr:smoke` passes on Linux and Windows using installed binaries, English data, and configured paths.
- PDF pages preserve input order; page, file, output, timeout, and concurrency limits are enforced; subprocesses are cancelled on timeout and temporary files are removed on success and failure.
- Concurrent workers claim distinct pending rows; upload responses do not wait for OCR; startup and periodic recovery handle stale leases.
- Missing binaries, malformed/encrypted/over-limit PDFs, timeouts, empty OCR, and tool errors are recorded safely and do not leave a document indefinitely marked as processing.
- Extracted text and validation details are inaccessible to unauthorized roles and are rendered safely when shown to authorized staff.
- No OCR result or UI claims authenticity, forgery detection, signature/seal verification, forensic review, or automatic type classification.

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
- Each document type uses only its institution-approved rule set. No rules are silently inferred from sample documents or OCR output.
- A document is `valid` only when the configured checks pass; uncertain results enter `needs_review`; processing/check failures enter `failed`; human rejection, if used, is recorded as a distinct review decision.
- Registrar and database administrator can review authorized submissions, and the recorded reviewer and decision remain attached to the correct submission/version. Students see only their own permitted status and instructions. Finance cannot view or review documents.
- A corrected re-upload starts a new validation run without changing the prior OCR result or reviewer history.

## Phase 11 — Dashboards and Reporting

Build the student, registrar, finance, and database administrator dashboards from the role-specific capabilities already in scope. Add useful counts and status summaries only; do not add analytics or reports that require new school policy or expose data across roles.

**Acceptance gate:** each role sees the expected workspace and summaries; students see only their own document/academic information, finance sees finance data only, and no dashboard action bypasses server authorization.

## Phase 12 — Security and Audit

Review authorization, input validation, upload hardening, session protections, audit coverage, and sensitive data exposure across the completed workflows. Address findings in the existing stack and document backup/restore procedures needed before deployment.

**Acceptance gate:** server-side role and ownership checks cover protected reads and writes; upload and download paths remain private; important actions are auditable without storing secrets or raw document contents; production errors do not expose SQL, stack traces, or native utility details; security checks pass.

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

- **Goal 1:** Run Phases 8–10 in order within one Goal Mode objective. After each phase passes its acceptance gate, report a concise checkpoint and create one local commit for that completed phase. Phase 9's gate includes a successful real native OCR smoke on both Linux and Windows; the user has authorized its local commit only after both pass. Continue to Phase 10 only after approved required fields, format rules, review cases, and decision wording are supplied. If those rules are missing, keep Phase 10 paused and do not mark Goal 1 complete. Never push. Stop after Phase 10 passes its gate and report Goal 1 complete. Do not start Phase 11 or any later phase in this goal.
- **Goal 2:** Start a separate Goal Mode objective only after Goal 1 has completed Phase 10 and stopped. Run Phases 11–15 continuously and in order. After each phase passes its acceptance gate, report a concise checkpoint, create one local commit for that completed phase with a plain human message, and continue to the next phase automatically. Stop after Phase 15 passes its gate and report Goal 2 complete.
- Never push. If a gate fails, resolve it within the current phase before proceeding. Pause when a required gate cannot be resolved without user input, institution-approved rules or credentials are missing, or an irreversible action requires approval. A paused or incomplete Goal 1 does not authorize starting Goal 2.
- Do not commit a phase that is incomplete or blocked.
- Do not invent a substitute for missing institution policy, credentials, or deployment details.
- After each goal's final phase passes its gate, report completion and stop. Do not add unrequested features or proceed beyond that goal's phase boundary or the roadmap.

## Goal Mode objectives

### Goal 1 — Phases 8–10

> Complete ARKTIESIIS roadmap Phases 8–10 in order: secure document management, local Tesseract/Poppler OCR, and institution-approved validation rules and review. Preserve the fixed project stack and all user changes. Enforce the documented role and document rules on the server. Complete each phase gate, report a concise checkpoint, and create one local commit for each completed phase. Phase 9's acceptance gate includes a successful real native OCR smoke on both Linux and Windows; the user authorized its commit only after both pass. Never push. Keep Phase 10 paused until institution-approved required fields, format/compliance rules, review cases, and decision wording are supplied. Do not invent institution policy. Stop after Phase 10 passes its gate; do not begin Phase 11.

### Goal 2 — Phases 11–15

> Only after Goal 1 is complete and has stopped after Phase 10, start a separate Goal Mode run in the same local checkout. Complete ARKTIESIIS roadmap Phases 11–15 in order: dashboards and reporting, security and audit, testing, UI polish, and deployment/defense readiness. Preserve the fixed project stack and all user changes. Enforce the documented role and document rules on the server. Complete each phase gate, report a concise checkpoint, and continue automatically to the next phase. After each completed phase passes its acceptance gate, create one local commit for that phase using a plain human message; do not commit incomplete or blocked phases, and never push. Pause when required user input, institution-approved rules or credentials, an irreversible-action approval, or an unresolved gate prevents safe completion. Do not invent institution policy. Stop after Phase 15 passes its gate.

## Copy/paste prompts for the two new chats

Run Prompt 1 first. Start Prompt 2 only after Prompt 1's Goal 1 is complete and has stopped. These are separate, sequential Goal Mode runs in the same local checkout; do not overlap them.

### Prompt 1 — Goal 1, Phases 8–10

```text
Start Goal 1 using the Goal 1 objective in docs/08-phase-8-to-15-goal-plan.md. Work in this ARKTIESIIS repository and this same local checkout; do not create a fresh worktree. First read AGENTS.md, docs/07-paper-objectives-scope-limitations.md, and docs/08-phase-8-to-15-goal-plan.md. Phases 1–7 are complete; implement Phases 8–10 in roadmap order, using Node.js/Express/EJS/SQL Server/local Tesseract and Poppler/email-2FA. After each phase passes its acceptance gate, report a concise checkpoint and create one local commit for that phase. Phase 9's acceptance gate includes a successful real native OCR smoke on both Linux and Windows; the user authorized its local commit only after both pass. Never push. Follow the exact role matrix and security gates in the plan. Preserve all existing user changes. For each phase, make reviewable changes, run relevant checks, review access/security, and update docs as needed. Keep Phase 10 paused until institution-approved required fields, format/compliance rules, review cases, and decision wording are supplied; do not invent school requirements. Never claim OCR proves authenticity or detects forgery. After Phase 10 passes its acceptance gate, report Goal 1 complete and stop. Do not begin Phase 11 or Goal 2.
```

### Prompt 2 — Goal 2, Phases 11–15

```text
Start Goal 2 using the Goal 2 objective in docs/08-phase-8-to-15-goal-plan.md. This is a separate Goal Mode run. Start only after Goal 1 completed Phases 8–10, passed the Phase 10 acceptance gate, and stopped. If Goal 1 is incomplete, blocked, or paused, stop and report that; do not overlap or prematurely begin Goal 2. Work in this ARKTIESIIS repository and the same local checkout used for Goal 1; do not create a fresh worktree. First read AGENTS.md, docs/07-paper-objectives-scope-limitations.md, and docs/08-phase-8-to-15-goal-plan.md. Implement only Phases 11–15, in roadmap order, using the existing Node.js/Express/EJS/SQL Server/local Tesseract and Poppler/email-2FA stack. After each phase passes its acceptance gate, report a concise checkpoint, create one local commit for that completed phase with a plain human message, then continue to the next phase. Never push or commit an incomplete or blocked phase. Follow the exact role matrix and security gates in the plan. Preserve all existing user changes. For each phase, make reviewable changes, run relevant checks, review access/security, and update docs as needed. Pause if required institution-approved rules, other user input, or approval for an irreversible action is missing, or if a gate is unresolved; do not invent school requirements. Never claim OCR proves authenticity or detects forgery. After Phase 15 passes its acceptance gate, report Goal 2 complete and stop.
```

## Out of scope

- Training a new AI model, document-type classification, or automated claims that a document is genuine.
- Forgery detection, signature/seal authentication, paper/material authenticity checks, or forensic analysis.
- Changing the fixed Node.js/Express/EJS/SQL Server/local Tesseract and Poppler/email-2FA stack.
- Adding multi-school support, unapproved AI capabilities, or features beyond roadmap scope.

## Inputs required before production validation

- Institution-approved required fields and format/compliance rules for Form 137, report cards, Good Moral Certificates, and PSA birth certificates.
- Confirmation of which validation cases require registrar review and what human outcomes/decision wording the system should record.
- Confirmation of upload size and retention limits. The repository currently has a configurable 10 MB default; that value is not asserted as school policy.
- Installed Tesseract with English trained data and installed Poppler command-line tools in the deployment environment.

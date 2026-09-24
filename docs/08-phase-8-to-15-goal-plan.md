# Goal Plan: Phases 8–15

The development roadmap marks Phases 1–7 complete. This plan is split into two separate Goal Mode runs in the existing roadmap order. Goal 1 covers Phases 8–10: secure document management, local OCR, and validation/review. Goal 2 covers Phases 11–15 and may start only after Goal 1 is complete. Capstone leader-directed advisory and manual-review behavior may be implemented, but policy-dependent Phase 10 acceptance checks remain on hold until the institution supplies approved document requirements and review rules. Keep each phase reviewable and create one local commit for each completed phase after its acceptance gate passes; never push. The user has authorized the Phase 9 commit only after the full native OCR acceptance gate passes on Linux and Windows. Use the same local checkout for both runs so the docs and completed work remain available. Do not overlap the goals or begin Goal 2 early.

## Current repository state

- `database/schema.sql` defines `documents` and `document_validations`, the four paper-listed document types, file metadata, uploader, processing/review fields, and status constraints. The baseline is version `001`; migrations `002`–`005` add two-factor limits, document revisions/review events, processing leases, and the local OCR default while preserving existing validation rows. Migration `006` adds immutable digital review decisions and a separate Form 137 physical-status history. Schema changes use new numbered, forward-only migrations.
- `src/config/environment.js` reads configurable Tesseract/Poppler executable paths, English OCR language, a bounded timeout, bounded worker concurrency, and `MAX_UPLOAD_MB` (default 10 MB).
- `src/services/localOcrService.js` securely copies a private upload into a temporary directory, uses `pdfinfo` and page-by-page `pdftoppm` rendering for PDFs, and calls Tesseract with native `execFile` argument arrays. `src/services/documentProcessingService.js` atomically claims pending immutable submissions, bounds concurrency/time/output/page count, recovers stale processing leases to a safe failed result, normalizes OCR outcomes, and stores a per-submission result. `src/server.js` starts the bounded queue/recovery scan after database connection and repeats it periodically. `src/services/documentValidationService.js` provides advisory OCR clues for staff inspection; it does not implement institution-approved validation rules.
- Phase 8 connects upload, authorized private download, per-student document history, immutable corrected re-upload, review handoff, and correction requests. Phase 9 connects OCR and staff-only extraction display. Capstone leader-directed Phase 10 advisory and manual-review behavior is implemented; policy-dependent acceptance checks remain on hold pending school approval.
- The existing role, CSRF, SQL, and audit patterns in the application should be followed. Do not change the one-time schema baseline to update an initialized database.

## Role and document access matrix

All permissions must be enforced on server routes and every file download. Student identifiers supplied in a URL or form must never substitute for the authenticated student's own record link.

| Role | Good Moral Certificate | Report card | Form 137 | PSA birth certificate |
| --- | --- | --- | --- | --- |
| `student` | Upload, view, check status, and re-upload for own record only | Upload, view, check status, and re-upload for own record only | View own physical status and staff instruction; no file access | View/download only a staff-uploaded file for own record; no upload |
| `registrar` | Manage, manually review, and download authorized student records | Manage, manually review, and download authorized student records | Record physical status/instruction; historical files are staff-only; no new upload or OCR | Upload, manage, manually review, and download authorized student records |
| `database_admin` | Oversee, manage, manually review, and download | Oversee, manage, manually review, and download | Record physical status/instruction; historical files are staff-only; no new upload or OCR | Upload, oversee, manage, manually review, and download |
| `finance` | No access | No access | No access | No access |

Students may upload only Good Moral Certificates and report cards. “Manage” permits the authorized staff workflow for a school record; it does not grant a student access to another student's records. Form 137 is physical-status tracking only; a missing staff event displays “Not recorded.” Keep historical Form 137 files staff-only. Record material upload, re-upload, review decision, and status change through audit events without logging document contents, extracted text, instructions, secrets, or raw command/database errors.

## Phase 8 — Document Management

1. Inspect the current document schema and application conventions before changing them. Confirm the upload size limit, storage location, and any institution-approved retention requirements; do not invent retention or naming policy.
2. Add role-protected upload, list/detail, download, review handoff, and re-upload routes and matching views. Students upload their own Good Moral Certificates and report cards. Staff upload those types and PSA birth certificates; Form 137 is never a new file upload. Use CSRF protection for mutations and repeat active-role and ownership checks inside service writes where the existing pattern does so.
3. Accept only PDF, JPEG, and PNG. Validate the extension, declared MIME type, actual file signature where applicable, and configured size limit on the server. Reject missing, empty, oversized, or mismatched uploads with a user-safe message.
4. Generate opaque stored names. Store files outside the public directory and resolve every path beneath the configured storage root. Never render a filesystem path. Download handlers must recheck role and record ownership before streaming a file.
5. Persist the existing metadata: student, selected document type, original filename, opaque stored filename, MIME type, byte size, uploader/source, status, and timestamp. Clean up an unreferenced file if the database write fails; report a safe error if cleanup also fails.
6. Treat each corrected digital upload as a new immutable submission. Students may re-upload only their own Good Moral Certificates and report cards; registrar/database administrators may submit linked corrections for Good Moral Certificates, report cards, and PSA certificates. Preserve the previous file and validation history. Form 137 changes append a physical status event and never create or replace a file.
7. Build student history/status views and staff search/review views under the role matrix above. Students may view/download their own staff-uploaded PSA certificate. Do not expose OCR output or staff-only decision notes to students.

### Phase 8 acceptance checks

- Students can upload/retrieve only their own Good Moral Certificates and report cards and can view/download only their own staff-uploaded PSA certificate. Attempts to change a student ID, URL, or document ID cannot reveal another student's file or a historic Form 137 file.
- Staff can upload Good Moral Certificates, report cards, and PSA certificates. Form 137 has physical status events only; no new file upload is accepted, and historical files are staff-only. Finance receives no document access.
- Disallowed types, MIME/extension mismatches, empty files, invalid file signatures, and size-limit violations are rejected. Stored files are not served from the public static directory.
- A failed database write does not leave an untracked file. An unauthorized or stale download request is denied.
- Re-upload creates a new submission while prior files, statuses, validation results, and review history remain available to authorized staff.
- Mutations use CSRF checks, parameterized SQL, and audit events consistent with existing application patterns.

## Phase 9 — Local OCR with Tesseract and Poppler

1. Require local Tesseract with English trained data and Poppler's `pdfinfo`/`pdftoppm`; configure executable paths, language, timeout, and concurrency through runtime environment settings. Windows paths may contain spaces and must be passed directly without a shell.
2. Keep uploads in private storage. Copy a verified regular file to a private temporary directory, call Tesseract directly for JPEG/PNG, and use `pdfinfo` then page-by-page `pdftoppm` rendering plus Tesseract for PDFs. Clean rendered pages immediately and always remove the private temporary directory.
3. Enforce a technical 20-page PDF maximum (`OCR_MAX_PDF_PAGES` may lower it), bounded render dimensions/output, a bounded timeout that aborts active subprocesses, and bounded worker concurrency. Preserve the existing configurable 10 MB upload default.
4. Upload handlers schedule background work and return without waiting for OCR. Startup and periodic scans recover stale leases and drain pending digital rows. Form 137 is excluded from OCR claim and recovery queues. Claim one row atomically under SQL Server read-committed locking so parallel workers do not process a submission twice.
5. Persist normalized extraction results in `document_validations`; limit access to extracted text because it contains student information. Handle empty OCR, malformed/encrypted/over-limit PDFs, missing tools, timeout, and processing errors with fixed safe messages. Do not save partial PDF text as a completed result or expose raw command/database errors.
6. Do not classify documents or infer authenticity. OCR output is untrusted input: escape it in views, do not execute it, and pass only the uploader-selected type to advisory checks. Store possible school-name and apparent grade-entry candidate lines as bounded, escaped staff suggestions.

### Phase 9 acceptance checks

- Valid image/PDF fixtures reach Tesseract and their text/result is associated with the correct immutable submission; `npm run ocr:smoke` passes on Linux and Windows using installed binaries, English data, and configured paths.
- PDF pages preserve input order; page, file, output, timeout, and concurrency limits are enforced; subprocesses are cancelled on timeout and temporary files are removed on success and failure.
- Concurrent workers claim distinct pending rows; upload responses do not wait for OCR; startup and periodic recovery handle stale leases.
- Missing binaries, malformed/encrypted/over-limit PDFs, timeouts, empty OCR, and tool errors are recorded safely and do not leave a document indefinitely marked as processing.
- Extracted text and validation details are inaccessible to unauthorized roles and are rendered safely when shown to authorized staff.
- No OCR result or UI claims authenticity, forgery detection, signature/seal verification, forensic review, or automatic type classification.

## Phase 10 — Advisory Checks and Human Review

1. The current capstone leader-directed implementation uses advisory clues only: linked student name for each digital type; possible school-name lines for report cards and Good Moral Certificates; and apparent grade-entry lines for report cards. Candidate lines are bounded, escaped, and visibly labeled as suggestions requiring source inspection.
2. Do not use a school-name whitelist, grade threshold, completeness/format rule, or automatic acceptance. These would be new school policy. The paper's validation objective is preserved, but policy-dependent checks remain on hold until the institution approves their requirements.
3. Require registrar/database administrator source inspection after OCR and record one immutable manual decision: verify, correction request, or reject. Only manual verification sets `documents.status` to `valid`. A reason is required to verify despite OCR failure or a missed advisory check. Students see their own status and correction instructions, not OCR text or internal override notes.
4. Form 137 uses a separate physical status history with pending, received, verified, correction, and rejected outcomes. “Not recorded” is shown until staff add an event. No Form 137 file or OCR step is part of this workflow; historical files remain staff-only.
5. Keep decision/status events append-only and auditable. Use document row locks and status checks so OCR completion or recovery cannot overwrite a manual decision. Preserve all historical OCR rows and review history.

### Phase 10 acceptance checks

- Leader-decided role, advisory, manual-decision, override-reason, immutable-history, concurrency, and Form 137 physical-only behavior is covered by tests.
- Policy-dependent acceptance checks for required fields, completeness, school formats, grading rules, and final decision wording remain on hold until school approval. No approval is inferred from this capstone implementation.
- `valid` is written only by manual verification; OCR success and advisory matches do not auto-accept a document. Finance cannot access document routes or APIs.
- A corrected digital upload starts a new OCR run without changing the prior OCR result or decision history.

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

- **Goal 1:** Run Phases 8–10 in order within one Goal Mode objective. After each phase passes its acceptance gate, report a concise checkpoint and create one local commit for that completed phase. Phase 9's gate includes a successful real native OCR smoke on both Linux and Windows; the user has authorized its local commit only after both pass. Capstone leader-directed advisory/manual-review scaffolding may be implemented when requested. Keep policy-dependent Phase 10 checks on hold until approved required fields, format rules, review cases, and decision wording are supplied; do not mark Goal 1 complete while that gate is pending. Never push. Stop after Phase 10 passes its full gate and report Goal 1 complete. Do not start Phase 11 or any later phase in this goal.
- **Goal 2:** Start a separate Goal Mode objective only after Goal 1 has completed Phase 10 and stopped. Run Phases 11–15 continuously and in order. After each phase passes its acceptance gate, report a concise checkpoint, create one local commit for that completed phase with a plain human message, and continue to the next phase automatically. Stop after Phase 15 passes its gate and report Goal 2 complete.
- Never push. If a gate fails, resolve it within the current phase before proceeding. Pause when a required gate cannot be resolved without user input, institution-approved rules or credentials are missing, or an irreversible action requires approval. A paused or incomplete Goal 1 does not authorize starting Goal 2.
- Do not commit a phase that is incomplete or blocked.
- Do not invent a substitute for missing institution policy, credentials, or deployment details.
- After each goal's final phase passes its gate, report completion and stop. Do not add unrequested features or proceed beyond that goal's phase boundary or the roadmap.

## Goal Mode objectives

### Goal 1 — Phases 8–10

> Complete ARKTIESIIS roadmap Phases 8–10 in order: secure document management, local Tesseract/Poppler OCR, and advisory checks with manual review. Preserve the fixed project stack and all user changes. Enforce the documented role and document rules on the server. Complete each phase gate, report a concise checkpoint, and create one local commit for each completed phase. Phase 9's acceptance gate includes a successful real native OCR smoke on both Linux and Windows; the user authorized its commit only after both pass. Never push. Capstone leader-directed advisory/manual-review scaffolding may be implemented when requested, but keep policy-dependent Phase 10 acceptance checks on hold until institution-approved requirements and decision wording are supplied. Do not invent institution policy. Stop after Phase 10 passes its full gate; do not begin Phase 11.

### Goal 2 — Phases 11–15

> Only after Goal 1 is complete and has stopped after Phase 10, start a separate Goal Mode run in the same local checkout. Complete ARKTIESIIS roadmap Phases 11–15 in order: dashboards and reporting, security and audit, testing, UI polish, and deployment/defense readiness. Preserve the fixed project stack and all user changes. Enforce the documented role and document rules on the server. Complete each phase gate, report a concise checkpoint, and continue automatically to the next phase. After each completed phase passes its acceptance gate, create one local commit for that phase using a plain human message; do not commit incomplete or blocked phases, and never push. Pause when required user input, institution-approved rules or credentials, an irreversible-action approval, or an unresolved gate prevents safe completion. Do not invent institution policy. Stop after Phase 15 passes its gate.

## Copy/paste prompts for the two new chats

Run Prompt 1 first. Start Prompt 2 only after Prompt 1's Goal 1 is complete and has stopped. These are separate, sequential Goal Mode runs in the same local checkout; do not overlap them.

### Prompt 1 — Goal 1, Phases 8–10

```text
Start Goal 1 using the Goal 1 objective in docs/08-phase-8-to-15-goal-plan.md. Work in this ARKTIESIIS repository and this same local checkout; do not create a fresh worktree. First read AGENTS.md, docs/07-paper-objectives-scope-limitations.md, and docs/08-phase-8-to-15-goal-plan.md. Phases 1–7 are complete; implement Phases 8–10 in roadmap order, using Node.js/Express/EJS/SQL Server/local Tesseract and Poppler/email-2FA. After each phase passes its acceptance gate, report a concise checkpoint and create one local commit for that phase. Phase 9's acceptance gate includes a successful real native OCR smoke on both Linux and Windows; the user authorized its local commit only after both pass. Never push. Follow the exact role matrix and security gates in the plan. Preserve all existing user changes. For each phase, make reviewable changes, run relevant checks, review access/security, and update docs as needed. Capstone leader-directed advisory/manual-review scaffolding may be implemented when requested, but keep policy-dependent Phase 10 checks on hold until institution-approved required fields, format/compliance rules, review cases, and decision wording are supplied; do not invent school requirements. Never claim OCR proves authenticity or detects forgery. After Phase 10 passes its full acceptance gate, report Goal 1 complete and stop. Do not begin Phase 11 or Goal 2.
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

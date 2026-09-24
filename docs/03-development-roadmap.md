# Development Roadmap

## Phase 1 - Foundation
- Verify project structure.
- Install dependencies.
- Configure Express/EJS.
- Configure SQL Server connection pool.
- Finalize schema/migrations approach.
- Add base error handling and health check.
- Create basic test/check workflow.

**Done when:** server starts, database connects, health endpoint works, and starter checks pass.

## Phase 2 - Authentication
- User login/logout.
- bcrypt password verification.
- Sessions.
- Login rate limiting.
- Role-based middleware and redirects.
- One-time database administrator bootstrap command.
- Development-only password login behind `NODE_ENV=development` and `DEV_PASSWORD_ONLY_LOGIN=true`.
- Login/logout session CSRF checks and database-backed active status/role checks.

**Phase 2 boundary:** email 2FA remains Phase 3. Password-only sessions are denied outside the explicitly enabled development environment. Registrar, finance, and student pages were placeholders at this phase and are implemented by later phases below.

## Phase 3 - Email 2FA
- Generate short-lived OTP.
- Store only hashed OTP.
- Send through SMTP.
- Verify and consume code.
- Enforce expiry, one-time use, CSRF, retry limits, and resend cooldowns.
- Share per-account attempt and send limits across sessions.

## Phase 4 - Database Admin
- [x] User account listing, creation, and updates.
- [x] Role management for the approved roles, including staff profile maintenance.
- [x] Account activation/deactivation with last-active-administrator and self-lockout safeguards.
- [x] Password reset with bcrypt hashing and pending sign-in code invalidation.
- [x] Database-admin-only audit log viewer that omits raw event details.
- [x] Student logins link to existing unlinked student records; Phase 4 does not create or edit student master records.
- [x] Database administrators may archive student records; linked login access and pending OTPs are disabled while academic and finance history remains.

## Phase 5 - Student Records
- [x] Registrar/database administrator student master list with bounded name/student-number search and term filter.
- [x] Master list shows at most 250 matches; selectors load up to 100 terms (current first) and 250 sections.
- [x] Student profile creation and editing; linked account relationships and academic history are retained.
- [x] Academic term creation and current-term management.
- [x] Sections tied to academic terms.
- [x] Enrollment create/update with server-side term/section consistency checks.
- [x] Student self-view resolved only through the authenticated account's linked student record.
- [x] Audit events for profile, term, section, and enrollment mutations.

## Phase 6 - Registrar / Academic Records
- [x] Registrar dashboard links to student records and the subject catalog.
- [x] Subject catalog creation and updates with validated code, name, and optional units.
- [x] Assign subjects only to an existing student's enrollment, with uniqueness enforcement.
- [x] Create or update grades by enrollment subject and caller-provided grading period.
- [x] Student information and enrollment history views with subjects and grade entries.
- [x] Student dashboard shows only grades joined through the authenticated user's linked student record.
- [x] Registrar and database administrator academic writes; finance is denied.
- [x] Academic writes use CSRF, serializable transactions, parameterized SQL, uniqueness checks, and audit records.

**Provisional grading assumption:** grades currently accept numeric values from 0 through 100, with up to two decimal places. The range is isolated in `normalizeGradeValue` so it can be replaced when the school confirms its grading scale. Grading period labels are provided by authorized staff and validated for length; the application does not invent period names.

## Phase 7 - Finance
- [x] Bounded finance search by student number or name, returning at most 100 matching students and finance identifiers only.
- [x] Finance staff can view a student's account, current balance, and latest 100 transactions; an account is created only by an explicit POST.
- [x] Charges and payments require positive PHP amounts; adjustments require a nonzero signed PHP amount and a reason. Amounts are limited to DECIMAL(12,2) precision.
- [x] Charges increase balance, payments decrease balance, and signed adjustments apply directly; a negative balance represents a credit.
- [x] Finance workspace is available to finance staff and database administrators; registrars and students are denied. Write transactions recheck the active role.
- [x] CSRF-protected, parameterized account and transaction writes use serializable transactions, row locks, duplicate-reference checks, and atomic audit records.
- [x] Registrar may deactivate a linked student login without archiving the student record.

**Reference number rule:** a nonempty reference number is accepted once per financial account after trimming. Duplicate matching follows the SQL Server database collation. Reuse on a different account is allowed.

## Phase 8 - Document Management
- Secure upload flow.
- File metadata.
- Access rules per document type and role.
- Student document history/status.
- Re-upload flow.

## Phase 9 - Local OCR
- Configure local Tesseract and Poppler executable paths and English OCR language.
- Render PDF pages individually and process supported images/PDFs with native command-line tools.
- Store normalized extraction results on immutable submissions and show OCR only to authorized staff.
- Bound PDF page count, worker concurrency, output size, and processing time; recover stale jobs safely.
- Keep role checks, file storage, and upload limit from Phase 8; do not classify documents or claim authenticity.

## Phase 10 - Validation Rules
- Define required fields per document type.
- Completeness checks.
- Basic configured format/compliance checks.
- Valid / Needs Review / Failed states.
- Registrar/admin review workflow.

## Phase 11 - Dashboards and Reporting
- Student dashboard.
- Registrar dashboard.
- Finance dashboard.
- Database admin dashboard.
- Useful counts/status summaries only; avoid scope creep.

## Phase 12 - Security and Audit
- Authorization review.
- Input validation.
- Upload hardening.
- Session security.
- Audit coverage.
- Sensitive data exposure review.

## Phase 13 - Testing
- Unit tests for validation rules.
- Integration tests for authentication/roles.
- CRUD tests.
- Document upload tests.
- Manual role/access matrix test.

## Phase 14 - UI polish
- Responsive layouts.
- Empty/loading/error states.
- Form feedback.
- Accessibility basics.

## Phase 15 - Deployment / Defense Readiness
- Production environment config.
- Database backup/restore procedure.
- Development-only demo accounts and sample records with a guarded, idempotent seeder.
- Final end-to-end test.
- Defense demo checklist.

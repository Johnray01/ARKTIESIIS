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

**Phase 2 boundary:** email 2FA remains Phase 3. Password-only sessions are denied outside the explicitly enabled development environment; role dashboard pages are placeholders.

## Phase 3 - Email 2FA
- Generate short-lived OTP.
- Store only hashed OTP.
- Send through SMTP.
- Verify and consume code.
- Enforce expiry, one-time use, CSRF, retry limits, and resend cooldowns.
- Share per-account attempt and send limits across sessions.

## Phase 4 - Database Admin
- User management.
- Role management within approved rules.
- Account activation/deactivation.
- Audit log viewer.

## Phase 5 - Student Records
- Student profiles.
- Search/filter.
- Master list.
- Academic terms, sections, enrollment.

## Phase 6 - Registrar / Academic Records
- Registrar dashboard.
- Enrollment history.
- Subjects.
- Grades.
- Student information views.

## Phase 7 - Finance
- Financial account records.
- Charges/payments/adjustments according to final approved scope.
- Balance display.
- Finance-only permissions.

## Phase 8 - Document Management
- Secure upload flow.
- File metadata.
- Access rules per document type and role.
- Student document history/status.
- Re-upload flow.

## Phase 9 - Google Document AI
- Configure service account securely.
- Send PDF/image files to processor.
- Store normalized extraction result.
- Handle API errors/timeouts safely.

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
- Demo accounts and sample data.
- Final end-to-end test.
- Defense demo checklist.

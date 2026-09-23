# ARKTIESIIS handoff prompt

Continue from the current Phase 2 authentication worktree in this repository. Start by reading `AGENTS.md`, `README.md`, `docs/02-scope-and-roles.md`, `docs/03-development-roadmap.md`, `docs/05-security-checklist.md`, and the current source and Git status. Treat the worktree as authoritative. Do not discard existing edits, auto-commit, push, or start Phase 3 without a new request.

## Project and completed work

- Fixed stack: Node.js 20+, Express, EJS, Microsoft SQL Server, Google Document AI, and email 2FA. No new packages unless the user approves them.
- Phase 1 foundation was implemented and committed locally as `1fe543a` (`Establish Phase 1 foundation`). Its schema baseline is for a fresh database. Live SQL Server verification was unavailable because this workspace had no configured `.env` or reachable SQL Server.
- Students may upload only Good Moral Certificates and report cards. Form 137 and PSA Birth Certificates are restricted to registrar and database admin workflows. AI checks are limited to OCR, completeness, and configured format rules; human review handles authenticity questions.

## Approved Phase 2 decisions

The user approved implementation of Phase 2 and chose **password-only access during development** plus a **secure one-time first-admin bootstrap command**. Password-only authentication must require both `NODE_ENV=development` and `DEV_PASSWORD_ONLY_LOGIN=true`; production login and protected routes must reject that session type until Phase 3 adds email 2FA.

Implement and verify:

1. `GET /login`, `POST /login`, and `POST /logout`; server-side validation, parameterized SQL lookup, bcrypt verification, generic failure for missing/inactive/incorrect accounts, session-based CSRF, and session regeneration after successful login.
2. Store only user ID and `authLevel='password_only_dev'` in the session. Add a dedicated login limit of 10 attempts per IP per 15 minutes. Logout destroys the session and clears the cookie.
3. Protected middleware re-queries active status and role from SQL Server and rejects password-only sessions outside the development gate. `/dashboard` redirects by role to protected placeholder pages for database admin, registrar, finance, and student. Do not add real dashboards or student data access in this phase.
4. Add `npm run admin:bootstrap`: private prompts for email, name, and password; bcrypt hash; a transaction that creates the first database admin and staff profile only if none exists; an audit log entry. No password command-line argument or secret logging.
5. Update the login view, configuration example, README/auth docs, syntax check script, and tests. Use existing dependencies only; no schema changes, email OTP, or Phase 3 code.

## Current execution status and remaining checks

The `coder_phase2_authentication` subagent (`gpt-6-luna`, xhigh) implemented the routes, session CSRF, role re-check middleware, placeholder views, development gate, and transactional bootstrap command. Root review found and corrected a hidden-password prompt hang, bcrypt timing difference for missing/inactive accounts, and a disabled-environment login page that created a session. The bootstrap prompt was exercised in a PTY and now exits after invalid input.

`npm run check` and `git diff --check` pass. The full `npm test` suite passes **18 tests with 0 failures**; HTTP tests require scoped loopback access because the default sandbox denies local binding. No packages or schema changes were added. Phase 2 edits and this handoff file are uncommitted; no push was made.

Live SQL Server and bootstrap checks remain unverified because this workspace has no configured `.env` or reachable SQL Server. When one is available, run `npm run db:check`, run `npm run admin:bootstrap` once from a private TTY, confirm a second run is refused, and manually test development login/logout and role access. Inspect the current diff before any commit and obtain a new explicit commit instruction from the user.

Do not commit Phase 2 automatically. The user previously requested a local Phase 1 commit only and explicitly said not to push. Ask for a new commit instruction if one is needed.

# ARKTIESIIS

**ARKTIESIIS: A Web-Based Information Management System with AI-Assisted Document Validation**

Starter repository for the thesis system of Ark Technological Institute Education System Incorporated - Lucena Branch.

## Stack
- Node.js + Express.js
- EJS / HTML / CSS / JavaScript
- Microsoft SQL Server
- Google Document AI
- Email-based two-factor authentication

## Important terminology
The thesis may use the phrase **AI-based document verification**, but the implemented AI scope is limited to OCR-assisted document completeness and format/compliance checks. It does not perform forensic authenticity or fraud detection.

## Quick start

1. Install Node.js 20+ and Microsoft SQL Server.
2. Copy `.env.example` to `.env`.
3. Configure the database and environment variables.
4. Run `database/schema.sql` once against a fresh SQL Server database. See [database/README.md](database/README.md) for the forward-only migration policy.
5. Install the locked package versions:

```bash
npm ci
```

6. Verify the database connection and baseline:

```bash
npm run db:check
```

7. Create the first database administrator from a private interactive terminal:

```bash
npm run admin:bootstrap
```

The command prompts for the administrator's email, name, and password. Password input is not echoed or accepted as a command-line argument. It creates the account only when no `database_admin` exists, and writes the user, staff profile, and audit event in one transaction.

8. Start the development server:

```bash
npm run dev
```

9. Open:

```text
http://localhost:3000
```

10. Check database connectivity while the server is running:

```text
http://localhost:3000/health
```

The server checks the database before opening its HTTP listener. `/health` returns `200` when SQL Server responds and `503` when the database is unavailable; it does not include database error details.

## Phase 2 authentication

Password-only login is a temporary development path. Set both `NODE_ENV=development` and `DEV_PASSWORD_ONLY_LOGIN=true` in `.env` to enable it. It is denied in production and test environments. Protected requests re-check the account's active status and role in SQL Server. Phase 3 will add email-based two-factor authentication; this phase does not send or verify OTP codes. Role dashboard pages are placeholders until their later phases.

## Current starter status
This repository contains the project foundation and Phase 2 development-only authentication. Email 2FA, role dashboard features, CRUD modules, document upload, and Document AI workflows are implemented phase by phase.

## Recommended workflow with Codex
Start with the content of `CODEX_START_PROMPT.md`.

Use one phase at a time, test it, then commit it before moving to the next phase.

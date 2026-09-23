# ARKTIESIIS Codex Instructions

## Project
ARKTIESIIS is a thesis project for Ark Technological Institute Education System Incorporated - Lucena Branch.

It is a web-based information management system with AI-assisted document validation.

## Fixed stack
- Node.js 20+
- Express.js
- EJS + HTML/CSS/JavaScript
- Microsoft SQL Server
- Google Document AI
- Email-based two-factor authentication

Do not replace the stack unless the user explicitly approves it.

## Main roles
- `database_admin`
- `registrar`
- `finance`
- `student`

Enforce authorization on the server. Hiding UI buttons is never enough.

## AI scope - very important
The AI feature is limited to:
- OCR / text extraction
- required-field checks
- completeness validation
- configured format/compliance checks

It MUST NOT claim to:
- prove document authenticity
- detect forged documents
- verify signatures
- verify seals
- perform forensic document analysis

Human review remains part of document acceptance when needed.

## Document access rules
- Students may only access their own permitted documents.
- Students may upload Good Moral Certificates and report cards.
- Form 137 is restricted to authorized staff such as registrar/database admin.
- Database admin may oversee stored documents and validation results.
- Registrar may manage academic records and review permitted documents.
- Finance users may only access finance-related data required by their role.

## Security rules
- Never hard-code credentials or API keys.
- Use `.env` for secrets.
- Use bcrypt for passwords.
- Use parameterized SQL queries.
- Validate all input server-side.
- Validate upload MIME type, file size, and extension.
- Store uploaded files outside public web access when implementation begins.
- Regenerate sessions after successful authentication.
- Apply rate limiting to login and 2FA endpoints.
- Log important admin/registrar/finance actions.
- Do not expose raw database errors in production.

## Database baseline and migrations
- `database/schema.sql` is a one-time baseline for a fresh database and records version `001` in `dbo.schema_migrations`.
- Apply later schema changes through new, numbered, forward-only migration scripts. Do not edit or rerun the baseline to update an initialized database, and do not rewrite migrations that have already been applied.
- The schema allows the `psa_birth_certificate` document type, but server routes must restrict it to registrar and database administrator users.

## Development workflow
For every requested phase:
1. Read the related docs and existing code first.
2. Inspect only the files needed for the task where possible.
3. Make a short implementation plan.
4. Implement the requested scope only.
5. Run checks/tests.
6. Fix errors caused by the change.
7. Review changed files for security and role access.
8. Update relevant docs if behavior changed.
9. Do not start the next phase without being asked.

## Git
- Keep changes small and reviewable.
- Do not rewrite unrelated working code.
- Do not make destructive database changes without explaining them first.
- Prefer a commit after a meaningful milestone passes tests.

## Coding style
- Keep modules small.
- Use clear names.
- Avoid unnecessary abstractions.
- Add comments only where logic is not obvious.
- Prefer simple thesis-friendly code that the proponents can explain during defense.

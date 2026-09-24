# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- `student`: accesses their own permitted school records and documents.
- `registrar`: manages academic records and reviews permitted documents.
- `finance`: accesses finance-related information required by the role.
- `database_admin`: oversees stored records, documents, and validation results.

The application also has a `database_admin` bootstrap flow for the first administrator.

## Product Purpose

ARKTIESIIS is a web-based information management system for Ark Technological Institute Education System Incorporated, Lucena Branch. It supports school information workflows and AI-assisted document validation.

## Positioning

The project materials do not establish a market position or competitor comparison. Do not imply one.

## Operating Context

This is a thesis project. The current application implements authentication, database administration, student and academic records, finance account management, document management, and a background local OCR workflow. Real native-tool runtime acceptance is pending; institution-approved validation rules and reporting remain future work. Interfaces must distinguish working features from planned behavior.

## Capabilities and Constraints

- The fixed stack is Node.js, Express, EJS, HTML, CSS, JavaScript, and Microsoft SQL Server, with local Tesseract OCR and Poppler PDF utilities for document text extraction.
- Authentication uses bcrypt passwords, sessions, CSRF checks, role authorization, and email two-factor authentication outside the explicitly enabled development password bypass.
- Students may access only their permitted documents. Form 137 is restricted to authorized staff. Finance access is limited to the role's required data.
- Registrars may set a student number when creating a profile but cannot change it on an existing profile. Database administrators may correct existing student numbers.
- AI scope is OCR/text extraction, required-field checks, completeness validation, and configured format/compliance checks. It does not establish authenticity, detect forgery, or verify signatures or seals. Human review remains part of acceptance when needed.
- Keep protected-route authorization on the server. Use parameterized SQL, validate inputs, and keep secrets in environment variables.

## Brand Commitments

- Use the official school logo supplied for this interface.
- The interface uses restrained red accents with ink text and white or cool-neutral surfaces; avoid a colorful palette.
- Preserve the ARKTIESIIS name and the school's full name when identifying the institution.

## Evidence on Hand

- Official school logo supplied at `/tmp/codex-clipboard-9656fa44-a3ab-4742-9797-8cce668294f1.png`; copy it unchanged into the public assets used by the web interface.
- No customer stories, performance claims, sample metrics, or deployed-system evidence are established by the project materials.

## Product Principles

- Enforce each role's access in server routes.
- Describe only functionality that exists and clearly label remaining planned workflows.
- Treat automated document checks as completeness and configured-format assistance, not forensic verification.

## Accessibility & Inclusion

Keep contrast readable, support visible keyboard focus and keyboard operation, label forms clearly, and adapt layouts to narrow screens.

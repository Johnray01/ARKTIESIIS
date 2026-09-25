# OCR-Assisted Document Validation

## Intended flow

1. The uploader selects the document type; OCR does not classify it.
2. The server checks the role, file type, and size, then saves the immutable submission privately as `pending`.
3. A background worker atomically claims pending submissions from SQL Server and changes them to `processing`.
4. Installed local Tesseract and Poppler command-line tools extract text from JPEG/PNG uploads and PDFs.
5. ARKTIESIIS records advisory OCR suggestions for linked student-name text and possible school-name lines, depending on the selected digital document type.
6. The OCR result and suggestions are attached to that immutable submission and shown only to registrar/database administrator users. Staff inspect the source file and manually verify, request correction, or reject it.

## Local tools and runtime configuration

Install Tesseract OCR with the English language data and Poppler utilities that provide `pdfinfo` and `pdftoppm`. See the [official Tesseract installation guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Installation.md). On Windows, Tesseract's executable path may include spaces; the application passes configured executable paths and arguments directly to `execFile` without a shell. Set `TESSERACT_PATH`, `PDFINFO_PATH`, and `PDFTOPPM_PATH` in the private runtime `.env` when the tools are not available on `PATH`. `OCR_LANGUAGE` defaults to `eng`.

`OCR_TIMEOUT_MS` defaults to 60 seconds and accepts 1–120 seconds. The timeout aborts the active subprocess. `OCR_CONCURRENCY` defaults to two workers and accepts one through four. `OCR_MAX_PDF_PAGES` defaults to 20 and accepts 1–20. Poppler renders one page at a time at no more than 1,800 pixels on its longest side, and each rendered page is removed after OCR. OCR output is limited to 4 MiB per submission. The Phase 8 upload size remains configurable with a 10 MB default through `MAX_UPLOAD_MB`.

Uploads remain private. OCR first copies a verified regular file to a private temporary directory, invokes local tools with argument arrays, and removes the temporary directory on success or failure. PDF pages are processed in page order. If any page cannot render or OCR, the submission fails as a whole; partial text is not saved as a completed result. Missing tools, malformed or encrypted PDFs, page-limit violations, timeouts, output-limit violations, and processing errors receive fixed safe status messages. Raw command output and SQL errors are not logged or shown.

## Advisory OCR suggestions

The current capstone leader-directed implementation suggestions check for these OCR-readable clues:

- Report card: linked student name and up to three possible school-name lines.
- Good Moral Certificate: linked student name and up to three possible school-name lines.
- PSA birth certificate: linked student name.

Candidate lines are bounded and HTML-escaped. “Possible” is intentional: an OCR suggestion does not confirm an institution name or document requirement. There is no school-name whitelist, grade threshold, completeness check, format rule, or automatic acceptance. Each digital submission requires staff source inspection and a manual decision. A reason is required to verify despite a failed OCR result or a missed advisory check. Only the manual `verified` decision sets `documents.status` to `valid`.

These advisory checks and decision controls are capstone leader implementation choices, not institutional policy. School approval is still required for any policy-dependent Phase 10 acceptance checks. No document is accepted automatically.

Automated tests assert the SQL row-lock hints and guarded status updates and simulate OCR/manual-decision races. They do not exercise simultaneous SQL Server sessions; verify database-level concurrency in an integration environment after migration deployment.

## Status meanings

- `valid`: a registrar or database administrator inspected the digital source file and manually verified it.
- `needs_review`: OCR completed and the digital submission awaits staff source inspection, or staff requested a correction.
- `failed`: OCR processing failed or required checks could not be satisfied.
- `pending` and `processing`: background work has not finished.

Form 137 status is separate from digital document status. Staff append `pending`, `received`, `verified`, `correction`, or `rejected` events for the physical document. If no staff status has been recorded, the student view says “Not recorded.” This workflow does not upload or OCR Form 137; historical Form 137 files are staff-only.

## Phase 8 document management boundary

Digital document submissions are stored privately and begin with `pending` status. Students may upload Good Moral Certificates and report cards for their own linked student record. Registrars and database administrators may upload those types and PSA birth certificates for student records. Students may view or download a PSA file uploaded by staff for their own record. Form 137 uses a staff-recorded physical status history with no new file upload or OCR; existing Form 137 files remain staff-only. Finance users have no document access. Each corrected digital upload is a new submission linked to the earlier one; OCR records, review decisions, and correction instructions remain in append-only history. Students see status and correction instructions, not OCR output or staff-only override notes. The upload limit defaults to 10 MB as a technical setting and is configurable with `MAX_UPLOAD_MB`; no school retention period or automatic deletion behavior is set.

## Phase 9 local OCR boundary

The upload response does not wait for OCR. The application schedules a pending-queue scan, and a database-backed worker also scans at startup and periodically. Pending rows are claimed atomically under SQL Server read-committed locking, so concurrent workers cannot process the same immutable submission. A bounded number of jobs run per server process. A timestamped processing lease supports recovery after a worker stops; startup and periodic recovery mark stale jobs `failed` with a safe result after the configured timeout plus a 30-second grace period.

Successful nonempty OCR and empty OCR are recorded as `needs_review`; malformed/encrypted PDFs, unavailable tools, file access failures, page-limit/output-limit violations, timeouts, and utility errors are recorded as `failed`. Each validation record is labeled `Tesseract OCR`. Advisory checks do not change that status to `valid`. Form 137 files are excluded from OCR claim and recovery queues. Migration `005_local_ocr_processor_default.sql` changes the database default for new validation rows while preserving the labels on existing rows.

OCR text, candidate lines, and advisory details are available only to registrars and database administrators. Students receive their permitted document status and correction instructions without extracted text or staff-only decision notes. OCR is untrusted text and is rendered with escaping. Phase 9 does not classify documents, prove authenticity, or apply institution-approved required-field, completeness, or format/compliance checks. Digital documents can become `valid` only through manual source inspection and staff verification.

Automated tests cover the local adapter and queue behavior. Run `npm run ocr:smoke` to check installed binaries and English data against synthetic JPEG, PNG, and two-page PDF samples, including page order and temporary-file cleanup. The live runtime acceptance gate remains pending until the native Tesseract/Poppler binaries and English trained data are installed and the smoke command passes on Windows with the configured paths, including paths containing spaces. Timeout and failure handling are covered by automated tests.

Tesseract provides OCR/text extraction; Poppler renders PDF pages. Node.js handles queueing, private storage, status normalization, access control, and later validation rules. No cloud document-processing API, custom model, or forensic analysis is in scope.

## SSHS E-Class Record grade import

The registrar-only grade import accepts the corrected SSHS E-Class Record for SY 2026–2027. It reads cached Term 1, Term 2, Term 3, and Final Grade values from the workbook and does not recalculate formulas. Blank formula caches make the affected learner row ineligible; recalculate and save the workbook in Excel before uploading it again. The parser uses the workbook in memory, clears the upload buffer after preview creation, and never stores the workbook file.

Before upload, a registrar chooses an existing 2026–2027 school-year, grade-level, section, and subject context. The preview compares this selection with the workbook context and matches learners by a unique 12-digit LRN to active students and exactly one existing enrollment and assigned subject. Missing/ambiguous matches, incomplete cached grades, duplicate workbook LRNs, and context mismatches are excluded for roster correction and reupload. The preview shows student number and database name; an LRN match with a name difference requires a registrar review checkbox and reason. Every row must be explicitly included. Different existing grades are kept unless the registrar chooses replacement with a reason; equal values are left unchanged.

Preview data is private and tied to the uploader's session. It becomes inaccessible after 30 minutes and is deleted when confirmation completes; expired rows are removed opportunistically on the next grade-import request. No timed SQL cleanup job is configured. Confirmation rechecks the active registrar role, student identity, enrollment, assignment, and existing grade state in a serializable SQL Server transaction. The audit record contains counts and recorded review reasons, not raw LRNs or grade values. Migration `007_student_lrn.sql` adds nullable unique LRNs for existing rows; new student records require an LRN. Registrars may backfill a blank LRN, while only database administrators may change a recorded value.

This import's fixed 0–100 range and four period names are implementation constraints for the approved workbook, not an institution-wide grading policy. The Phase 10 school-policy gate remains open; policy-dependent validation and Phase 10 completion still require institutional approval.

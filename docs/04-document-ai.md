# OCR-Assisted Document Validation

## Intended flow

1. The uploader selects the document type; OCR does not classify it.
2. The server checks the role, file type, and size, then saves the immutable submission privately as `pending`.
3. A background worker atomically claims pending submissions from SQL Server and changes them to `processing`.
4. Installed local Tesseract and Poppler command-line tools extract text from JPEG/PNG uploads and PDFs.
5. ARKTIESIIS may apply required-field, completeness, and configured format/compliance checks after the institution supplies approved rules.
6. The normalized OCR result is attached to that submission and shown only to authorized staff; human review handles cases that need judgment.

## Local tools and runtime configuration

Install Tesseract OCR with the English language data and Poppler utilities that provide `pdfinfo` and `pdftoppm`. See the [official Tesseract installation guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Installation.md). On Windows, Tesseract's executable path may include spaces; the application passes configured executable paths and arguments directly to `execFile` without a shell. Set `TESSERACT_PATH`, `PDFINFO_PATH`, and `PDFTOPPM_PATH` in the private runtime `.env` when the tools are not available on `PATH`. `OCR_LANGUAGE` defaults to `eng`.

`OCR_TIMEOUT_MS` defaults to 60 seconds and accepts 1–120 seconds. The timeout aborts the active subprocess. `OCR_CONCURRENCY` defaults to two workers and accepts one through four. `OCR_MAX_PDF_PAGES` defaults to 20 and accepts 1–20. Poppler renders one page at a time at no more than 1,800 pixels on its longest side, and each rendered page is removed after OCR. OCR output is limited to 4 MiB per submission. The Phase 8 upload size remains configurable with a 10 MB default through `MAX_UPLOAD_MB`.

Uploads remain private. OCR first copies a verified regular file to a private temporary directory, invokes local tools with argument arrays, and removes the temporary directory on success or failure. PDF pages are processed in page order. If any page cannot render or OCR, the submission fails as a whole; partial text is not saved as a completed result. Missing tools, malformed or encrypted PDFs, page-limit violations, timeouts, output-limit violations, and processing errors receive fixed safe status messages. Raw command output and SQL errors are not logged or shown.

## Example validation

For a report card, configured rules may check for values such as:

- student name
- school name
- school year
- grade level
- grading information

The exact fields must be confirmed with the institution before implementation. No document is marked `valid` until approved rules exist.

## Status meanings

- `valid`: configured completeness/format rules passed.
- `needs_review`: OCR returned text, no readable text was found, or a check needs human review.
- `failed`: OCR processing failed or required checks could not be satisfied.
- `pending` and `processing`: background work has not finished.

## Phase 8 document management boundary

Document submissions are stored privately and begin with `pending` status. Students may upload Good Moral Certificates and report cards for their own linked student record. Registrars and database administrators may manage all four document types for student records; finance users have no document access. Each corrected upload is stored as a new submission linked to the earlier one, while review handoffs and correction instructions are retained on the submission that prompted them. Students see status and correction instructions, not OCR output. The upload limit defaults to 10 MB as a technical setting and is configurable with `MAX_UPLOAD_MB`; no school retention period or automatic deletion behavior is set.

## Phase 9 local OCR boundary

The upload response does not wait for OCR. The application schedules a pending-queue scan, and a database-backed worker also scans at startup and periodically. Pending rows are claimed atomically under SQL Server read-committed locking, so concurrent workers cannot process the same immutable submission. A bounded number of jobs run per server process. A timestamped processing lease supports recovery after a worker stops; startup and periodic recovery mark stale jobs `failed` with a safe result after the configured timeout plus a 30-second grace period.

Successful nonempty OCR and empty OCR are recorded as `needs_review`; malformed/encrypted PDFs, unavailable tools, file access failures, page-limit/output-limit violations, timeouts, and utility errors are recorded as `failed`. Each validation record is labeled `Tesseract OCR`. Migration `005_local_ocr_processor_default.sql` changes the database default for new validation rows while preserving the labels on existing rows.

OCR text and result details are available only to registrars and database administrators. Students receive their permitted document status and review instructions without extracted text. OCR is untrusted text and is rendered with escaping. Phase 9 does not classify documents, prove authenticity, or run required-field, completeness, or format/compliance checks. No document is marked `valid` until Phase 10 has institution-approved rules.

Automated tests cover the local adapter and queue behavior. Run `npm run ocr:smoke` to check installed binaries and English data against synthetic JPEG, PNG, and two-page PDF samples, including page order and temporary-file cleanup. The live runtime acceptance gate remains pending until the native Tesseract/Poppler binaries and English trained data are installed and the smoke command passes on Windows with the configured paths, including paths containing spaces. Timeout and failure handling are covered by automated tests.

Tesseract provides OCR/text extraction; Poppler renders PDF pages. Node.js handles queueing, private storage, status normalization, access control, and later validation rules. No cloud document-processing API, custom model, or forensic analysis is in scope.

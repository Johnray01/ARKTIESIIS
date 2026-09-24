# AI-Assisted Document Validation

## Intended flow
1. Uploader selects the document type before upload; AI does not classify it.
2. Server checks role permission, file type, and size.
3. File is stored securely and marked `processing`.
4. Server sends the document to Google Document AI for OCR/text extraction.
5. ARKTIESIIS applies required-field, completeness, and configured format/compliance checks for the uploader-selected type.
6. System stores the result and shows it to authorized users.
7. Documents that need judgment are sent to human review.

## Example validation
For a report card, configured rules may check for values such as:
- student name
- school name
- school year
- grade level
- grading information

The exact fields must be confirmed with the institution before final implementation.

## Status meanings
- `valid`: configured completeness/format rules passed.
- `needs_review`: OCR result is uncertain or one or more checks need human review.
- `failed`: processing failed or required checks could not be satisfied.

## Not included
- Forgery detection.
- Signature authentication.
- Seal authentication.
- Paper/material authenticity.
- Forensic examination.
- Training a new machine-learning model.
- Classifying a document or claiming it is authentic.

## Phase 8 document management boundary

Document submissions are stored privately and begin with `pending` status. Students may upload Good Moral Certificates and report cards for their own linked student record. Registrars and database administrators may manage all four document types for student records; finance users have no document access. Each corrected upload is stored as a new submission linked to the earlier one, while review handoffs and correction instructions are retained on the submission that prompted them. Students see status and correction instructions, not OCR output. The upload limit defaults to 10 MB as a technical setting and is configurable with `MAX_UPLOAD_MB`; no school retention period or automatic deletion behavior is set.

## Phase 9 OCR integration boundary

Each securely stored initial upload or linked corrected submission is submitted to the configured Google Document AI processor for OCR. The project ID, location, processor ID, Google credentials, and `DOCUMENT_AI_TIMEOUT_MS` are runtime configuration; the timeout defaults to 30 seconds and is constrained to 1–120 seconds. Provider calls do not retry automatically. A successful nonempty or empty response is recorded as `needs_review`; missing configuration, an unreadable provider response, file access failure, timeout, or provider error is recorded as `failed`. The validation record is attached to that immutable submission. A database failure during finalization leaves a timestamped processing lease; startup and periodic recovery mark leases older than the provider timeout plus a 30-second grace period `failed` with a safe recovery result. Provider and database error details are not shown to users.

OCR text and result details are available only to registrars and database administrators. Students receive their permitted document status and review instructions without extracted text. OCR is untrusted text and is rendered with escaping. Phase 9 does not classify documents, prove authenticity, or run required-field, completeness, or format/compliance checks. No document is marked `valid` until Phase 10 has institution-approved rules. No school retention period or automatic deletion behavior is set.

Local provider acceptance remains pending until the school supplies an authorized processor and runtime credentials; mocked tests do not verify a live Google Document AI request.

Google Document AI provides OCR/text extraction. Node.js handles application logic, API calls, storage, and validation rules. No custom model or forensic analysis is in scope.
